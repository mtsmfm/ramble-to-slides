/** Main-thread client for asr.worker.ts. Serializes transcribe() calls in arrival order. */
import type { AsrProgress, LoadOptions, Transcriber, TranscribeOptions, WhisperModel } from "./types";

export function createTranscriber(): Transcriber {
  let loadPromise: Promise<void> | null = null;
  let loadedModel: WhisperModel | null = null; // model the current loadPromise belongs to
  let currentModel: WhisperModel = "turbo";
  let backend: "webgpu" | "wasm" | null = null;
  let pending = 0;
  let nextId = 1;
  const waiters = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
  let onProgress: ((p: AsrProgress) => void) | null = null;
  let loadResolve: (() => void) | null = null;
  let loadReject: ((e: Error) => void) | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const spawn = () => {
    const w = new Worker(new URL("./asr.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = onmessage;
    w.onerror = onerror;
    return w;
  };

  const onmessage = (ev: MessageEvent) => {
    const m = ev.data;
    switch (m.type) {
      case "progress":
        onProgress?.({ status: "loading", code: m.code, params: m.params ?? {}, message: m.message, progress: m.progress });
        break;
      case "loaded":
        backend = m.backend;
        onProgress?.({
          status: "ready",
          code: "ready",
          params: { backend: backend ?? "" },
          message: backend === "webgpu" ? "Ready (WebGPU)" : "Ready (WASM, slow)",
        });
        loadResolve?.();
        break;
      case "retry":
        // A backend attempt failed; the worker's module state is unusable for the next one (see asr.worker.ts).
        console.warn(`[asr] backend attempt failed (${m.message}); retrying in a fresh worker`);
        worker.terminate();
        worker = spawn();
        worker.postMessage({ type: "load", model: loadedModel, startAttempt: m.nextAttempt });
        break;
      case "result":
        waiters.get(m.id)?.resolve(m.text);
        waiters.delete(m.id);
        break;
      case "error": {
        const err = new Error(m.message);
        if (m.id != null) {
          waiters.get(m.id)?.reject(err);
          waiters.delete(m.id);
        } else {
          onProgress?.({ status: "error", code: "error", params: { message: m.message }, message: `Failed to load the model: ${m.message}` });
          loadReject?.(err);
        }
      }
    }
  };
  const onerror = (e: ErrorEvent) => {
    onProgress?.({ status: "error", code: "error", params: { message: e.message }, message: `ASR worker error: ${e.message}` });
    loadReject?.(new Error(e.message));
  };
  let worker = spawn();

  return {
    get pending() {
      return pending;
    },
    get backend() {
      return backend;
    },
    get model() {
      return currentModel;
    },
    load(cb, opts?: LoadOptions) {
      onProgress = cb;
      const model = opts?.model === "small" || opts?.model === "turbo" ? opts.model : currentModel;
      if (!loadPromise || loadedModel !== model) {
        currentModel = model;
        loadedModel = model;
        backend = null;
        loadPromise = new Promise<void>((resolve, reject) => {
          loadResolve = resolve;
          loadReject = reject;
          worker.postMessage({ type: "load", model });
        });
      }
      return loadPromise;
    },
    setModel(model: WhisperModel) {
      if (model === currentModel && loadPromise) return loadPromise;
      if (!onProgress) {
        currentModel = model;
        return Promise.resolve();
      }
      return this.load(onProgress, { model });
    },
    transcribe(audio: Float32Array, opts: TranscribeOptions) {
      pending++;
      const id = nextId++;
      const p = new Promise<string>((resolve, reject) => waiters.set(id, { resolve, reject }));
      // Post only once the model is ready: the worker may be replaced while loading, and the audio buffer is transferred.
      const run = queue
        .then(async () => {
          await loadPromise?.catch(() => undefined);
          worker.postMessage({ type: "transcribe", id, audio, glossary: opts.glossary, language: opts.language ?? "ja" }, [audio.buffer]);
          return p;
        })
        .finally(() => pending--);
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      worker.terminate();
      for (const w of waiters.values()) w.reject(new Error("transcriber disposed"));
      waiters.clear();
    },
  };
}
