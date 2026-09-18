/// <reference lib="webworker" />
/**
 * Web Worker running whisper-large-v3-turbo with transformers.js (WebGPU, WASM fallback).
 * Messages in:  {type:"load", model, startAttempt?} | {type:"transcribe", id, audio:Float32Array, glossary:string[]}
 * Messages out: {type:"progress", status, message, progress?} | {type:"loaded", backend}
 *               | {type:"retry", nextAttempt, message}  (spawn a fresh worker and load with startAttempt)
 *               | {type:"result", id, text} | {type:"error", id?, message}
 */
import {
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  env,
  type PreTrainedTokenizer,
  type Processor,
} from "@huggingface/transformers";

env.allowLocalModels = false;

const MODEL_IDS = {
  turbo: "onnx-community/whisper-large-v3-turbo",
  small: "onnx-community/whisper-small",
} as const;
type ModelKey = keyof typeof MODEL_IDS;
let modelKey: ModelKey = "turbo";
let MODEL_ID: string = MODEL_IDS.turbo;
const SAMPLE_RATE = 16000;
const CHUNK_S = 30; // whisper window
const DEFAULT_REPETITION_PENALTY = 1.1;
type Language = "ja" | "en";
// Whisper special token ids; large-v3 and older vocabularies differ, so read them from the tokenizer after load.
let SOT = 50258, TRANSCRIBE = 50360, NO_TIMESTAMPS = 50364, PREV_SOT = 50362;
let LANG_TOKEN: Record<Language, number> = { ja: 50266, en: 50259 };
const HALLUCINATIONS: Record<Language, string[]> = {
  ja: ["ご視聴ありがとうございました", "チャンネル登録", "ご覧いただきありがとうございます", "最後までご視聴", "おやすみなさい", "ありがとうございました"],
  en: ["Thank you for watching", "Thanks for watching", "Subscribe to", "Please subscribe", "See you in the next video"],
};

let model: WhisperForConditionalGeneration;
let processor: Processor;
let tokenizer: PreTrainedTokenizer;
let backend: "webgpu" | "wasm" = "wasm";
let loading: Promise<boolean> | null = null;

function post(msg: unknown) {
  self.postMessage(msg);
}

/**
 * Loads the model, trying the backends in `attempts` from `startAttempt` on. Returns false when an
 * attempt failed and the main thread must spawn a fresh worker for the next one: transformers.js 4.2
 * chains session creation on a module-level promise that stays rejected after a failure, so a second
 * attempt in the same worker would only replay the first error ("no available backend found").
 */
async function load(startAttempt = 0): Promise<boolean> {
  const progress = (code: string, params: Record<string, string | number>, message: string, progress?: number) =>
    post({ type: "progress", status: "loading", code, params, message, progress });
  const files = new Map<string, { loaded: number; total: number }>();
  // transformers.js fires "download" even on a Cache API hit, so ask the cache directly.
  const cached = new Set<string>();
  try {
    const cache = await caches.open("transformers-cache");
    for (const req of await cache.keys()) cached.add(req.url);
  } catch (e) {
    console.warn("[asr] Cache API unavailable:", e);
  }
  const isCached = (file: string) => cached.has(`https://huggingface.co/${MODEL_ID}/resolve/main/${file}`);
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "download" && p.file && !isCached(p.file)) console.info(`[asr] downloading ${p.file} (not in cache)`);
    if (p.status === "progress" && p.file && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0, total = 0, fromNet = 0;
      for (const [name, f] of files) { loaded += f.loaded; total += f.total; if (!isCached(name)) fromNet += 1; }
      const verb = fromNet > 0 ? "Downloading model" : "Loading model from cache";
      const loadedMB = Number((loaded / 1e6).toFixed(0)), totalMB = Number((total / 1e6).toFixed(0));
      progress(fromNet > 0 ? "downloading" : "cache", { loadedMB, totalMB }, `${verb} (${loadedMB} / ${totalMB} MB)`, total ? loaded / total : undefined);
    }
  };
  type Dtype = Record<string, "fp32" | "fp16" | "q8" | "q4">;
  // onnxruntime 1.25–1.29 fails to create a session for the q8 whisper decoders ("TransposeDQWeightsForMatMulNBits
  // Missing required scale ... embed_tokens"): the extended-level MatMulNBits fusion trips over the tied embedding.
  // "basic" skips that fusion. Fixed upstream; drop this once transformers.js ships the fixed runtime (>= 4.3.0).
  // https://github.com/microsoft/onnxruntime/issues/28306  https://github.com/huggingface/transformers.js/issues/1707
  const WASM_SESSION_OPTIONS = { graphOptimizationLevel: "basic" } as const;
  const tryLoad = async (device: "webgpu" | "wasm", dtype: Dtype, label: string) => {
    progress("preparing", { label }, `Preparing model (${label})…`);
    const session_options = device === "wasm" ? WASM_SESSION_OPTIONS : undefined;
    const m = await WhisperForConditionalGeneration.from_pretrained(MODEL_ID, { device, dtype, progress_callback, session_options });
    return m as WhisperForConditionalGeneration;
  };
  const hasWebGPU = typeof (self as { navigator?: { gpu?: unknown } }).navigator?.gpu !== "undefined";
  // Preference order: WebGPU fp16 encoder → WebGPU fp32 encoder (GPUs without shader-f16) → WASM q8.
  const attempts: [device: "webgpu" | "wasm", dtype: Dtype, label: string][] = [
    ["webgpu", { encoder_model: "fp16", decoder_model_merged: "q4" }, "WebGPU"],
    ["webgpu", { encoder_model: "fp32", decoder_model_merged: "q4" }, "WebGPU fp32"],
    ["wasm", { encoder_model: "q8", decoder_model_merged: "q8" }, "WASM (slow)"],
  ];
  // navigator.gpu can exist while no adapter is available (blocklisted / integrated GPUs, e.g. Intel HD 615);
  // ask up front instead of letting the session creation fail.
  let webgpuOk = hasWebGPU;
  if (webgpuOk) {
    try {
      const gpu = (self as { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } }).navigator?.gpu;
      webgpuOk = !!(await gpu?.requestAdapter());
    } catch {
      webgpuOk = false;
    }
    if (!webgpuOk) console.info("[asr] WebGPU adapter unavailable; using WASM");
  }
  let loaded = false;
  for (let i = startAttempt; i < attempts.length; i++) {
    const [device, dtype, label] = attempts[i];
    if (device === "webgpu" && !webgpuOk) continue;
    try {
      model = await tryLoad(device, dtype, label);
      backend = device;
      console.info(`[asr] loaded with ${label}; ${[...files.keys()].filter((f) => !isCached(f)).length} file(s) downloaded, ${[...files.keys()].filter(isCached).length} from cache`);
      loaded = true;
      break;
    } catch (e) {
      console.warn(`load failed (${label}):`, e);
      const message = e instanceof Error ? e.message : String(e);
      const next = attempts.findIndex(([d], j) => j > i && (d !== "webgpu" || webgpuOk));
      if (next < 0) throw e;
      post({ type: "retry", nextAttempt: next, message });
      return false;
    }
  }
  if (!loaded) throw new Error("no usable backend");
  processor = await AutoProcessor.from_pretrained(MODEL_ID, {});
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const tok = (t: string) => {
    const id = tokenizer.convert_tokens_to_ids(t);
    if (typeof id !== "number") throw new Error(`tokenizer has no ${t}`);
    return id;
  };
  SOT = tok("<|startoftranscript|>");
  TRANSCRIBE = tok("<|transcribe|>");
  NO_TIMESTAMPS = tok("<|notimestamps|>");
  PREV_SOT = tok("<|startofprev|>");
  LANG_TOKEN = { ja: tok("<|ja|>"), en: tok("<|en|>") };
  // Warm up (compiles WebGPU shaders) with half a second of silence.
  progress("warmup", {}, "Warming up…");
  await run(new Float32Array(SAMPLE_RATE / 2), [], "ja");
  post({ type: "loaded", backend, model: modelKey });
  return true;
}

function promptIds(glossary: string[], language: Language): number[] {
  const init = [SOT, LANG_TOKEN[language], TRANSCRIBE, NO_TIMESTAMPS];
  if (glossary.length === 0) return init;
  const text = language === "ja" ? glossary.join("、") + "。" : glossary.join(", ") + ".";
  const ids = tokenizer.encode(text, { add_special_tokens: false });
  // Whisper allows at most 224 prompt tokens.
  return [PREV_SOT, ...ids.slice(-224), ...init];
}

interface GenOpts {
  repetitionPenalty?: number;
}

async function generateChunk(audio: Float32Array, decoder_input_ids: number[], opts: GenOpts = {}): Promise<string> {
  const inputs = await processor(audio);
  const out = (await model.generate({
    ...inputs,
    decoder_input_ids,
    max_new_tokens: 440 - decoder_input_ids.length,
    num_beams: 1,
    do_sample: false,
    // Mild always-on penalty makes decoder loops rare; robustRun escalates it when one still happens.
    repetition_penalty: opts.repetitionPenalty ?? DEFAULT_REPETITION_PENALTY,
  } as Parameters<typeof model.generate>[0])) as { tolist(): number[][] };
  const ids = out.tolist()[0].slice(decoder_input_ids.length);
  return tokenizer.decode(ids, { skip_special_tokens: true }).trim();
}

async function run(audio: Float32Array, glossary: string[], language: Language, opts: GenOpts = {}): Promise<string> {
  const ids = promptIds(glossary, language);
  const parts: string[] = [];
  for (let off = 0; off < audio.length; off += CHUNK_S * SAMPLE_RATE) {
    parts.push(await generateChunk(audio.subarray(off, off + CHUNK_S * SAMPLE_RATE), ids, opts));
  }
  return language === "ja" ? parts.join("") : parts.join(" ");
}

/** Whisper sometimes loops ("LX、LX、LX…", the same phrase over and over). Detect it by 3-gram diversity. */
function isDegenerate(text: string): boolean {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length < 24) return false;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= chars.length; i++) grams.add(chars.slice(i, i + 3).join(""));
  const diversity = grams.size / (chars.length - 2);
  return diversity < 0.45;
}

/** Last resort: cut the text where a phrase of 2+ chars starts repeating back to back. */
function collapseRepeats(text: string): string {
  const chars = [...text];
  for (let len = 2; len <= 40; len++) {
    for (let i = 0; i + len * 3 <= chars.length; i++) {
      const unit = chars.slice(i, i + len).join("");
      if (unit === chars.slice(i + len, i + 2 * len).join("") && unit === chars.slice(i + 2 * len, i + 3 * len).join("")) {
        return chars.slice(0, i + len).join("");
      }
    }
  }
  return text;
}

/**
 * Transcribe with escalating fallbacks:
 *  1. glossary prompt  2. no prompt  3. repetition penalty  4. split the audio in half and recurse.
 */
async function robustRun(audio: Float32Array, glossary: string[], language: Language, depth = 0): Promise<string> {
  const seconds = audio.length / SAMPLE_RATE;
  let text = await run(audio, glossary, language);
  const bad = (t: string) => isDegenerate(t) || (glossary.length > 0 && looksTruncated(t, seconds, language));
  if (!bad(text)) return text;
  console.warn("[asr] degenerate/truncated output, retrying without prompt:", text.slice(0, 60));
  const plain = await run(audio, [], language);
  if (!isDegenerate(plain)) return plain.length >= text.length || isDegenerate(text) ? plain : text;
  const penalized = await run(audio, [], language, { repetitionPenalty: 1.3 });
  if (!isDegenerate(penalized)) return penalized;
  if (depth < 2 && seconds > 6) {
    console.warn("[asr] still degenerate, splitting audio");
    const mid = Math.floor(audio.length / 2);
    const a = await robustRun(audio.subarray(0, mid), glossary, language, depth + 1);
    const b = await robustRun(audio.subarray(mid), glossary, language, depth + 1);
    return language === "ja" ? a + b : `${a} ${b}`.trim();
  }
  return collapseRepeats(penalized);
}

function looksTruncated(text: string, seconds: number, language: Language): boolean {
  // Japanese speech is ~4-8 chars/s, English ~10-15 chars/s; far fewer suggests the glossary prompt made whisper drop text.
  return seconds > 2 && text.length / seconds < (language === "ja" ? 2.5 : 5);
}

function clean(text: string, language: Language): string {
  const t = text.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (t.length < 40 && HALLUCINATIONS[language].some((h) => lower.includes(h.toLowerCase()))) return "";
  return t;
}

async function transcribe(audio: Float32Array, glossary: string[], language: Language): Promise<string> {
  return clean(await robustRun(audio, glossary, language), language);
}

// Handle messages strictly one at a time (generate() must not run concurrently).
let chain: Promise<void> = Promise.resolve();
self.onmessage = (ev: MessageEvent) => {
  chain = chain.then(() => handle(ev.data));
};

async function handle(msg: { type: string; id?: number; audio?: Float32Array; glossary?: string[]; language?: Language; model?: string; startAttempt?: number }) {
  try {
    if (msg.type === "load") {
      const want: ModelKey = msg.model === "small" ? "small" : "turbo";
      if (want !== modelKey || !loading) {
        if (loading) {
          try { await loading; } catch { /* previous load failed; retry below */ }
          try { await (model as unknown as { dispose?: () => Promise<void> })?.dispose?.(); } catch { /* ignore */ }
        }
        modelKey = want;
        MODEL_ID = MODEL_IDS[want];
        loading = load(msg.startAttempt ?? 0);
      }
      await loading;
    } else if (msg.type === "transcribe") {
      if (!(await (loading ??= load()))) throw new Error("model is being reloaded on another backend");
      const text = await transcribe(msg.audio!, msg.glossary ?? [], msg.language === "en" ? "en" : "ja");
      post({ type: "result", id: msg.id, text });
    }
  } catch (e) {
    post({ type: "error", id: msg.id, message: e instanceof Error ? e.message : String(e) });
  }
}
