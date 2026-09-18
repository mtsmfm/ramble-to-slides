/**
 * SpeechEngine factory. The whisper engine wraps the worker-backed Transcriber (audio in, text
 * out, one utterance at a time); the Web Speech engine lives in webspeech.ts.
 */
import { createTranscriber } from "./transcriber";
import { createWebSpeechEngine } from "./webspeech";
import { isWhisperModel, type AsrModel, type EngineCallbacks, type SpeechEngine, type WhisperModel } from "./types";

export function engineKindOf(model: AsrModel): SpeechEngine["kind"] {
  return isWhisperModel(model) ? "whisper" : "webspeech";
}

/** True when `engine` can serve `model` without being replaced. */
export function engineServes(engine: SpeechEngine, model: AsrModel): boolean {
  return engine.kind === "whisper" ? isWhisperModel(model) : engine.model === model;
}

export function createSpeechEngine(model: AsrModel): SpeechEngine {
  return isWhisperModel(model) ? createWhisperEngine(model) : createWebSpeechEngine(model);
}

function createWhisperEngine(initial: WhisperModel): SpeechEngine {
  const transcriber = createTranscriber();
  let cb: EngineCallbacks | null = null;
  let inFlight = 0;
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  return {
    kind: "whisper",
    get model() {
      return transcriber.model;
    },
    get backend() {
      return transcriber.backend;
    },
    get pending() {
      return inFlight;
    },
    load(onProgress, opts) {
      const model = opts.model !== undefined && isWhisperModel(opts.model) ? opts.model : initial;
      return transcriber.load(onProgress, { model });
    },
    setModel(model) {
      if (!isWhisperModel(model)) return Promise.reject(new Error("not a whisper model"));
      return transcriber.setModel(model);
    },
    async start(callbacks) {
      cb = callbacks;
    },
    onSpeechStart() {
      /* whisper only needs the finished utterance */
    },
    feed(audio, t0, t1, opts) {
      inFlight += 1;
      transcriber
        .transcribe(audio, opts)
        .then((text) => {
          const trimmed = text.trim();
          if (trimmed) cb?.onSegment(t0, t1, trimmed);
        })
        .catch((e: unknown) => {
          console.warn("transcribe failed", e);
          cb?.onError(message(e));
        })
        .finally(() => {
          inFlight -= 1;
        });
    },
    async stop() {
      /* queued utterances still finish; the session waits on `pending` */
    },
    dispose() {
      transcriber.dispose();
      cb = null;
    },
  };
}
