/**
 * SpeechEngine on top of the browser's Web Speech API (SpeechRecognition).
 *
 * The recorder still owns the microphone, the VAD and audio.wav; the recognizer opens the mic a
 * second time on its own. It returns text without timestamps, so segments get their time range
 * from the VAD: t0 is where the VAD last saw speech begin (after the previous segment), t1 is where
 * the VAD saw that utterance end, or "now" when the final result arrives mid-utterance.
 *
 * "webspeech-local" asks for on-device recognition (Chrome 139+, `processLocally`) and refuses to
 * fall back to the cloud; "webspeech-cloud" is the browser's default path (Chrome sends the audio
 * to Google, Edge to Microsoft). The glossary becomes contextual-biasing phrases where supported
 * (on-device Chrome only).
 */
import type { AsrBackend, AsrModel, AsrProgress, EngineCallbacks, LoadOptions, SpeechEngine, SpeechLanguage, TranscribeOptions } from "./types";

// Minimal shapes of the Web Speech API (lib.dom lacks the on-device additions).
type Availability = "unavailable" | "downloadable" | "downloading" | "available";
interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent {
  error: string;
  message?: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface AvailabilityOptions {
  langs: string[];
  processLocally?: boolean;
}
interface RecognitionCtor {
  new (): Recognition;
  available?(opts: AvailabilityOptions): Promise<Availability>;
  install?(opts: AvailabilityOptions): Promise<boolean>;
}
interface PhraseCtor {
  new (phrase: string, boost?: number): unknown;
}

function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
function phraseCtor(): PhraseCtor | null {
  return (globalThis as { SpeechRecognitionPhrase?: PhraseCtor }).SpeechRecognitionPhrase ?? null;
}

const LANG_TAG: Record<SpeechLanguage, string> = { ja: "ja-JP", en: "en-US" };
/** Boost for glossary phrases (Chrome accepts 0–10; 1 is neutral). */
const PHRASE_BOOST = 2;
/** An utterance the recognizer never answered stops counting as pending after this long. */
const PENDING_TIMEOUT_MS = 3000;
/** Delay before restarting a recognizer that ended on its own (Chrome stops after silence / ~1 min). */
const RESTART_DELAY_MS = 150;
/** How long stop() waits for the recognizer's final results. */
const STOP_GRACE_MS = 2500;
/** How long to wait for the on-device language pack. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;

export function isWebSpeechSupported(): boolean {
  return recognitionCtor() !== null;
}

export function createWebSpeechEngine(model: "webspeech-local" | "webspeech-cloud"): SpeechEngine {
  const local = model === "webspeech-local";
  let loadedLanguage: SpeechLanguage | null = null;
  let backend: AsrBackend | null = null;

  // Live state while recording
  let active = false;
  let recognition: Recognition | null = null;
  let cb: EngineCallbacks | null = null;
  let clock: () => number = () => 0;
  let currentOpts: TranscribeOptions | null = null;
  let restartTimer: number | null = null;
  let endWaiter: (() => void) | null = null;

  // Timing bookkeeping (recorder seconds)
  let speechStart: number | null = null; // first VAD speech start since the last delivered segment
  let utteranceEnd: number | null = null; // end of the last VAD utterance since the last delivered segment
  let lastSegmentEnd = 0;
  let awaiting = false; // an utterance ended and no final result came yet
  let awaitingTimer: number | null = null;

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function ensureLanguage(language: SpeechLanguage, onProgress?: (p: AsrProgress) => void): Promise<void> {
    const C = recognitionCtor();
    if (!C) throw new Error("this browser has no Web Speech API (SpeechRecognition); use Chrome, Edge or Safari, or a whisper model");
    if (!local) {
      loadedLanguage = language;
      backend = "browser-cloud";
      return;
    }
    if (typeof C.available !== "function" || typeof C.install !== "function") {
      throw new Error("this browser cannot do on-device speech recognition (needs Chrome 139 or newer); choose the cloud variant or a whisper model");
    }
    const opts: AvailabilityOptions = { langs: [LANG_TAG[language]], processLocally: true };
    let status = await C.available(opts);
    if (status === "unavailable") {
      throw new Error(`on-device speech recognition is not available for ${LANG_TAG[language]} in this browser`);
    }
    if (status !== "available") {
      onProgress?.({ status: "loading", code: "installing", params: {}, message: "Installing the on-device language pack…" });
      const ok = await C.install(opts);
      if (!ok) throw new Error("the browser refused to install the on-device language pack (try choosing the model again from the settings dialog)");
      const deadline = Date.now() + INSTALL_TIMEOUT_MS;
      while ((status = await C.available(opts)) !== "available") {
        if (status === "unavailable" || Date.now() > deadline) throw new Error("the on-device language pack did not become available");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    loadedLanguage = language;
    backend = "browser-local";
  }

  function clearAwaiting(): void {
    awaiting = false;
    if (awaitingTimer !== null) {
      clearTimeout(awaitingTimer);
      awaitingTimer = null;
    }
  }

  function deliver(text: string): void {
    const now = clock();
    let t0 = speechStart ?? lastSegmentEnd;
    let t1 = utteranceEnd !== null && utteranceEnd > t0 ? utteranceEnd : now;
    if (t1 <= t0) t1 = t0 + 0.1;
    if (t1 > now + 0.05) t1 = Math.max(now, t0 + 0.1);
    lastSegmentEnd = t1;
    speechStart = null;
    utteranceEnd = null;
    clearAwaiting();
    cb?.onSegment(t0, t1, text);
  }

  function makeRecognition(opts: TranscribeOptions): Recognition {
    const C = recognitionCtor();
    if (!C) throw new Error("SpeechRecognition unavailable");
    const r = new C();
    r.lang = LANG_TAG[opts.language ?? "ja"];
    r.continuous = true;
    r.interimResults = false;
    r.maxAlternatives = 1;
    if (local) {
      r.processLocally = true;
      const P = phraseCtor();
      if (P && opts.glossary.length > 0) {
        try {
          r.phrases = opts.glossary.map((g) => new P(g, PHRASE_BOOST));
        } catch (e) {
          console.warn("[webspeech] phrases not accepted:", e);
        }
      }
    }
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res.isFinal) continue;
        const text = res[0]?.transcript.trim() ?? "";
        if (text) deliver(text);
      }
    };
    r.onerror = (e) => {
      // "no-speech" and "aborted" are routine (the recognizer times out); onend restarts it.
      if (e.error === "no-speech" || e.error === "aborted") return;
      console.warn("[webspeech] error:", e.error, e.message);
      const fatal = ["not-allowed", "service-not-allowed", "language-not-supported", "audio-capture", "network"].includes(e.error);
      cb?.onError(e.error === "network" ? "speech service unreachable (network); this browser may not support cloud recognition" : `${e.error}${e.message ? `: ${e.message}` : ""}`);
      if (fatal) active = false;
    };
    r.onend = () => {
      if (recognition === r) recognition = null;
      endWaiter?.();
      endWaiter = null;
      if (active && currentOpts) scheduleRestart();
    };
    return r;
  }

  function scheduleRestart(): void {
    if (restartTimer !== null) return;
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      if (!active || !currentOpts) return;
      try {
        recognition = makeRecognition(currentOpts);
        recognition.start();
      } catch (e) {
        recognition = null;
        cb?.onError(message(e));
      }
    }, RESTART_DELAY_MS);
  }

  function stopRecognition(): Promise<void> {
    const r = recognition;
    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    if (!r) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => {
        endWaiter = null;
        try {
          r.abort();
        } catch {
          /* already gone */
        }
        resolve();
      }, STOP_GRACE_MS);
      endWaiter = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        r.stop();
      } catch {
        clearTimeout(timer);
        endWaiter = null;
        resolve();
      }
    });
  }

  return {
    kind: "webspeech",
    model,
    get backend() {
      return backend;
    },
    get pending() {
      return awaiting ? 1 : 0;
    },
    async load(onProgress, opts) {
      const language = opts.language ?? "ja";
      try {
        await ensureLanguage(language, onProgress);
      } catch (e) {
        backend = null;
        onProgress({ status: "error", code: "error", params: { message: message(e) }, message: `Speech recognition unavailable: ${message(e)}` });
        throw e;
      }
      onProgress({ status: "ready", code: "ready", params: { backend: backend ?? "" }, message: `Ready (${backend})` });
    },
    async setModel(m) {
      if (m !== model) throw new Error("a Web Speech engine cannot switch to another kind of model");
    },
    async start(callbacks, opts, clockFn) {
      cb = callbacks;
      clock = clockFn;
      currentOpts = opts;
      const language = opts.language ?? "ja";
      if (loadedLanguage !== language) await ensureLanguage(language);
      speechStart = null;
      utteranceEnd = null;
      lastSegmentEnd = clock();
      clearAwaiting();
      active = true;
      recognition = makeRecognition(opts);
      recognition.start();
    },
    onSpeechStart(t) {
      if (speechStart === null) {
        speechStart = t;
        utteranceEnd = null;
      }
    },
    feed(_audio, t0, t1, opts) {
      if (speechStart === null) speechStart = t0;
      utteranceEnd = t1;
      awaiting = true;
      if (awaitingTimer !== null) clearTimeout(awaitingTimer);
      awaitingTimer = window.setTimeout(() => {
        awaitingTimer = null;
        awaiting = false;
      }, PENDING_TIMEOUT_MS);
      // Language or glossary changed mid-recording: the recognizer takes them at (re)start.
      if (active && currentOpts && recognition && (currentOpts.language !== opts.language || currentOpts.glossary.join("\n") !== opts.glossary.join("\n"))) {
        currentOpts = opts;
        void stopRecognition().then(() => {
          if (active) scheduleRestart();
        });
      } else {
        currentOpts = opts;
      }
    },
    async stop() {
      active = false;
      await stopRecognition();
      clearAwaiting();
      currentOpts = null;
    },
    dispose() {
      active = false;
      if (restartTimer !== null) clearTimeout(restartTimer);
      restartTimer = null;
      clearAwaiting();
      try {
        recognition?.abort();
      } catch {
        /* ignore */
      }
      recognition = null;
      cb = null;
    },
  };
}
