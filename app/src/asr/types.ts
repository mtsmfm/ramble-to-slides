/** Browser-side speech recognition (WebGPU whisper in a Web Worker). Implemented in asr/transcriber.ts. */
export type AsrProgressCode =
  | "downloading" // params: loadedMB, totalMB
  | "cache" // reading from the browser cache; params: loadedMB, totalMB
  | "preparing" // params: label ("WebGPU" | "WebGPU fp32" | "WASM")
  | "warmup"
  | "installing" // the browser downloads its on-device language pack (no progress figure)
  | "ready" // params: backend
  | "error"; // params: message

export interface AsrProgress {
  /** "loading" while the model downloads/initializes, "ready" once usable, "error" on failure. */
  status: "loading" | "ready" | "error";
  /** Machine-readable step, for localized status text. */
  code: AsrProgressCode;
  /** Values to interpolate into the localized text. */
  params: Record<string, string | number>;
  /** Fallback human-readable message (Japanese). */
  message: string;
  /** 0..1 while loading, when known. */
  progress?: number;
}

export type SpeechLanguage = "ja" | "en";

/**
 * "turbo": whisper-large-v3-turbo (accurate, ~1.5 GB, needs a real GPU). "small": whisper-small (~0.4 GB, runs on weak GPUs).
 * "webspeech-local": the browser's own recognizer, on-device (Chrome 139+; nothing leaves the machine).
 * "webspeech-cloud": the browser's own recognizer through its vendor's servers (Chrome → Google, Edge → Microsoft).
 */
export type AsrModel = "turbo" | "small" | "webspeech-local" | "webspeech-cloud";
export type WhisperModel = "turbo" | "small";

export const ASR_MODELS: readonly AsrModel[] = ["turbo", "small", "webspeech-local", "webspeech-cloud"];
export function isAsrModel(v: unknown): v is AsrModel {
  return typeof v === "string" && (ASR_MODELS as readonly string[]).includes(v);
}
export function isWhisperModel(m: AsrModel): m is WhisperModel {
  return m === "turbo" || m === "small";
}

/** What actually does the recognition, once an engine is loaded. */
export type AsrBackend = "webgpu" | "wasm" | "browser-local" | "browser-cloud";

export interface LoadOptions {
  model?: AsrModel;
  /** Needed by the browser recognizer (its on-device language packs are per language). */
  language?: SpeechLanguage;
}

export interface TranscribeOptions {
  /** Proper nouns / vocabulary the speaker is likely to use (biases recognition). */
  glossary: string[];
  /** Spoken language. Default "ja". */
  language?: SpeechLanguage;
}

export interface EngineCallbacks {
  /** One recognized segment; t0/t1 in seconds since recording start (the recorder's clock). */
  onSegment(t0: number, t1: number, text: string): void;
  /** A recognition failure that does not end the recording (shown on the status line). */
  onError(message: string): void;
}

/**
 * One way of turning speech into segments. The recorder (mic, VAD, audio.wav, pauses) and everything
 * downstream stay the same; only this layer differs between whisper and the browser's recognizer.
 * Implemented in asr/engine.ts (whisper, on top of Transcriber) and asr/webspeech.ts.
 */
export interface SpeechEngine {
  readonly kind: "whisper" | "webspeech";
  readonly model: AsrModel;
  /** Prepare (download / install / check support). Resolves when ready; rejects with a message for the status line. */
  load(onProgress: (p: AsrProgress) => void, opts: LoadOptions): Promise<void>;
  /** Switch models within this engine kind (whisper only; other kinds are replaced by the session). */
  setModel(model: AsrModel, opts: LoadOptions): Promise<void>;
  /** Recording started. `clock` returns the recorder's elapsed seconds. */
  start(cb: EngineCallbacks, opts: TranscribeOptions, clock: () => number): Promise<void>;
  /** VAD saw speech begin. */
  onSpeechStart(t: number): void;
  /** One finished utterance from the VAD (Float32 PCM mono 16 kHz) with its time range. */
  feed(audio: Float32Array, t0: number, t1: number, opts: TranscribeOptions): void;
  /** Recording stopped; flush what can still be delivered. */
  stop(): Promise<void>;
  /** Utterances whose text has not been delivered yet (pauses and the end wait for 0). */
  readonly pending: number;
  readonly backend: AsrBackend | null;
  dispose(): void;
}

export interface Transcriber {
  /** Download + initialize the model. Resolves when ready. Calling again with the same model returns the same promise. */
  load(onProgress: (p: AsrProgress) => void, opts?: LoadOptions): Promise<void>;
  /** Switch models. Pending transcriptions finish on the old model; the new one loads (progress via the load callback). */
  setModel(model: WhisperModel): Promise<void>;
  /** The model currently loaded or loading. */
  readonly model: WhisperModel;
  /** Transcribe one utterance (Float32 PCM, mono, 16 kHz). Returns "" for silence / hallucinations. Calls are serialized internally. */
  transcribe(audio: Float32Array, opts: TranscribeOptions): Promise<string>;
  /** Number of transcribe() calls not yet finished. */
  readonly pending: number;
  /** Whether WebGPU was actually used (false = WASM fallback, much slower). Available after load(). */
  readonly backend: "webgpu" | "wasm" | null;
  /** Terminate the worker. */
  dispose(): void;
}
