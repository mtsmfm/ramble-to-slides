/**
 * Central state of one ramble: recorder → speech engine → segments, the questions the
 * agent asks, the outline / slides it writes, the practice timer, the memo, and the
 * event queue that wait_for_event drains.
 * The UI (main.ts) and the WebMCP tools (mcp/tools.ts) both talk only to this.
 */
import type { AsrBackend, AsrModel, AsrProgressCode, SpeechEngine, SpeechLanguage } from "./asr/types";
import { detectAsrModel, rememberAsrModel, rememberedAsrModel } from "./asr/default-model";
import { createSpeechEngine, engineServes } from "./asr/engine";
import type { Recorder } from "./audio/types";
import { createRecorder } from "./audio/recorder";
import type {
  AgentEvent,
  AgentEventResult,
  AnswerSource,
  ProjectEvent,
  ProjectEventType,
  Question,
  Segment,
  ToolError,
} from "./types";
import { t, type MessageKey, type Params } from "./i18n";
import {
  fileSystemAccessAvailable,
  lastProjectName,
  pickProject,
  reopenLastProject,
  unavailableReason,
  type HistoryDoc,
  type HistoryEntry,
  type HistorySource,
  type Project,
} from "./store/project";

export type { HistoryDoc, HistoryEntry, HistorySource } from "./store/project";
export type { AsrModel, SpeechLanguage } from "./asr/types";

const DEFAULT_WAIT_S = 45;
const MAX_WAIT_S = 90;
/** How long a pause may be held back waiting for the speech engine to catch up. */
const PAUSE_DEFER_LIMIT_MS = 20_000;
const PAUSE_RECHECK_MS = 250;
const GLOSSARY_SAVE_MS = 800;
const NOTES_SAVE_MS = 800;
/** How long the user must stop typing in the memo before the edit becomes a generation. */
const NOTES_HISTORY_MS = 3000;
/** Upper bound for waiting on the speech engine once recording has stopped. */
const DRAIN_LIMIT_MS = 120_000;

export type SessionEventName =
  | "agent"
  | "transcript"
  | "questions"
  | "status"
  | "speaking"
  | "outline"
  | "slides"
  | "project"
  | "glossary"
  | "notes"
  | "timer"
  | "history"
  | "language"
  | "asrModel"
  | "state";

export interface StatusView {
  text: string;
  error: boolean;
}

export interface TranscriptView {
  segments: Segment[];
  questions: Question[];
  glossary: string[];
  notes: string;
  /** Language whisper is transcribing in. */
  language: SpeechLanguage;
  recording: boolean;
  ended: boolean;
  elapsed_s: number;
}

/** One entry of correct_segments: the segment's t0 plus the fixed-up text. */
export interface SegmentCorrection {
  t0: number;
  text: string;
}

export interface CorrectionResult {
  ok: true;
  /** How many segments were changed. */
  updated: number;
  /** t0 values (rounded to 0.1 s) that matched no segment. */
  unmatched: number[];
}

/** What restore_history / the history dropdown get back. */
export interface RestoreResult {
  ok: true;
  doc: HistoryDoc;
  /** The `at` of the generation that was restored. */
  at: string;
}

export interface StatusReport {
  project_open: boolean;
  project_name: string | null;
  recording: boolean;
  ended: boolean;
  total_segments: number;
  elapsed_s: number;
  pending_question: string | null;
  pending_question_id: string | null;
  asr_backend: AsrBackend | null;
  asr_status: string;
  timer_running: boolean;
  timer_s: number;
  language: SpeechLanguage;
  /** null: no WebGPU and nothing chosen yet — the user (or set_asr_model) has to pick. */
  asr_model: AsrModel | null;
}

export interface Session {
  on(name: SessionEventName, fn: () => void): void;

  readonly segments: readonly Segment[];
  readonly questions: readonly Question[];
  readonly pendingQuestion: Question | null;
  readonly recording: boolean;
  readonly ended: boolean;
  readonly started: boolean;
  readonly finishing: boolean;
  /**
   * "ready" once the speech model is loaded and warmed up, "failed" after a load error (Start retries),
   * "unset" while no model is chosen (no WebGPU: the user must pick one), else "loading".
   */
  readonly asrReadiness: "loading" | "ready" | "failed" | "unset";
  /** True while the agent has a wait_for_event call pending (it is "listening"). */
  readonly agentListening: boolean;
  /** Date.now() of the last WebMCP tool call from the agent, or null. */
  readonly lastAgentCallAt: number | null;
  /** Called by every tool so the UI can show the agent is alive. */
  touchAgent(): void;
  readonly speaking: boolean;
  readonly elapsed: number;
  readonly status: StatusView;
  readonly asrStatus: string;
  readonly asrBackend: AsrBackend | null;
  readonly projectOpen: boolean;
  readonly projectName: string | null;
  readonly outlineMd: string;
  readonly slidesMd: string;
  readonly glossaryText: string;
  readonly notesText: string;
  /** Bumped whenever existing segments changed in place, so the UI redraws them all. */
  readonly transcriptRevision: number;
  readonly timerRunning: boolean;
  /** Practice timer, in seconds (live while running). */
  readonly timerSeconds: number;
  /** Language whisper transcribes in; persisted per project in project.json. */
  readonly language: SpeechLanguage;
  /** Switch the speech language (takes effect on the next utterance). */
  setLanguage(language: SpeechLanguage): { ok: true; language: SpeechLanguage };
  /** Speech model / recognizer in use; persisted per project in project.json. null until chosen (no WebGPU). */
  readonly asrModel: AsrModel | null;
  /** Switch the speech model (the new one loads; pending utterances finish on the old one). */
  setAsrModel(model: AsrModel): { ok: true; model: AsrModel };

  /** Is the File System Access API usable at all? */
  readonly canUseFileSystem: boolean;
  readonly fileSystemProblem: string;

  lastProjectName(): Promise<string | null>;
  openProject(): Promise<void>;
  openLastProject(): Promise<void>;
  preloadAsr(): void;
  start(): Promise<void>;
  askNow(): void;
  end(): Promise<void>;
  answerTyped(text: string): void;
  setGlossary(text: string): void;
  /** Append terms not already present; returns the resulting glossary list. */
  addGlossary(words: string[]): string[];
  /** Agent path (set_notes): replaces the memo and records a generation right away. */
  setNotes(markdown: string): void;
  /** User path (typing in the textarea): records a generation once typing stops. */
  editNotes(text: string): void;
  /** Record the pending user edit now (the textarea lost focus). No-op when nothing is pending. */
  flushNotesEdit(): void;
  /** Append one line (prefixed with the timer position while it runs); returns the whole memo. */
  appendNote(text: string): string;
  /** Generations of one document, newest first. Empty while no project is open. */
  listHistory(doc: HistoryDoc): Promise<HistoryEntry[]>;
  /** Make one generation the current document again (recording the current state first). */
  restoreHistory(doc: HistoryDoc, file: string): Promise<RestoreResult | ToolError>;
  /** Reset to 0 and run. */
  startTimer(): { ok: true };
  stopTimer(): { ok: true; elapsed_s: number } | ToolError;
  resetTimer(): { ok: true };

  // --- agent facing (see mcp/tools.ts) ---
  waitForEvent(maxWaitS?: number): Promise<AgentEventResult | ToolError>;
  getNewSegments(): { new_segments: Segment[]; total_segments: number } | ToolError;
  getTranscript(): TranscriptView;
  showQuestion(text: string): { ok: true; question_id: string } | ToolError;
  resolveQuestion(id: string, answer: string, source: AnswerSource): { ok: true } | ToolError;
  correctSegments(corrections: readonly SegmentCorrection[]): CorrectionResult;
  setOutline(markdown: string): { ok: true } | ToolError;
  setSlides(markdown: string): { ok: true } | ToolError;
  getStatus(): StatusReport;
}

/** Split the proper-noun field into words. */
export function parseGlossary(text: string): string[] {
  return text
    .split(/[,、，\n\r\t]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Localized text for every step the ASR worker reports. */
const ASR_MESSAGE: Record<AsrProgressCode, MessageKey> = {
  downloading: "asr.downloading",
  cache: "asr.cache",
  preparing: "asr.preparing",
  warmup: "asr.warmup",
  installing: "asr.installing",
  ready: "asr.ready",
  error: "asr.error",
};

/** ja / en from the browser, used until a project says otherwise. */
export function defaultSpeechLanguage(): SpeechLanguage {
  const tag = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return tag.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** Seconds → mm:ss. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function createSession(): Session {
  // ---------------------------------------------------------------- state
  const segments: Segment[] = [];
  const questions: Question[] = [];
  const events: ProjectEvent[] = [];
  let project: Project | null = null;
  let recording = false;
  let ended = false;
  let started = false;
  let finishing = false;
  let speaking = false;
  let pendingId: string | null = null;
  let questionSeq = 0;
  let segCursor = 0;
  let outlineMd = "";
  let slidesMd = "";
  let glossaryText = "";
  let glossarySaveTimer: number | null = null;
  let notesText = "";
  let notesSaveTimer: number | null = null;
  let notesHistoryTimer: number | null = null;
  let transcriptRevision = 0;
  // Practice timer (independent of recording)
  let timerRunning = false;
  let timerStartedAt = 0;
  let timerAccumMs = 0;
  let status: { key: MessageKey; params?: Params; error: boolean } = { key: "status.idle", error: false };
  let asrState: { key: MessageKey; params?: Params } = { key: "asr.idle" };
  let asrReadiness: "loading" | "ready" | "failed" | "unset" = "loading";
  let speechLanguage: SpeechLanguage = defaultSpeechLanguage();
  /** True once the user / the agent picked a language, so opening a project keeps that choice. */
  let languageChosen = false;
  /**
   * Model for projects whose project.json says nothing: remembered on this device, else guessed from
   * the hardware. null (no WebGPU) means the user must choose before recording can start.
   */
  let asrModel: AsrModel | null = rememberedAsrModel();
  /** True once the user / the agent picked a model, so opening a project keeps that choice. */
  let asrModelChosen = rememberedAsrModel() !== null;
  const asrModelDetected = asrModelChosen
    ? Promise.resolve()
    : detectAsrModel().then((m) => {
        if (asrModelChosen || project) return; // a choice or a project.json beat the probe
        asrModel = m;
        emit("asrModel");
      });
  let frozenElapsed = 0;
  /** Seconds recorded in earlier runs of this project; added to every recorder timestamp. */
  let timeOffset = 0;

  let recorder: Recorder | null = null;
  let engine: SpeechEngine | null = null;
  let engineError: string | null = null;
  let asrLoad: Promise<void> | null = null;

  const listeners = new Map<SessionEventName, Array<() => void>>();
  const eventQueue: AgentEvent[] = [];
  let waiter: { resolve: (r: AgentEventResult) => void; timer: number } | null = null;
  let lastAgentCallAt: number | null = null;

  function setWaiter(w: typeof waiter): void {
    waiter = w;
    emit("agent");
  }
  let pausePending: { silenceS: number; since: number } | null = null;
  let pauseTimer: number | null = null;

  // ---------------------------------------------------------------- plumbing
  function emit(name: SessionEventName): void {
    for (const fn of listeners.get(name) ?? []) {
      try {
        fn();
      } catch (e) {
        console.warn("listener failed", name, e);
      }
    }
  }

  function setStatus(key: MessageKey, params?: Params, error = false): void {
    status = { key, params, error };
    emit("status");
  }

  /** Rendered here (not stored), so a UI language switch re-localizes the current line. */
  function statusView(): StatusView {
    return { text: t(status.key, status.params), error: status.error };
  }

  function setAsrState(key: MessageKey, params?: Params): void {
    asrState = { key, params };
  }

  function elapsed(): number {
    if (recorder && recorder.recording) return round1(recorder.elapsed + timeOffset);
    return round1(frozenElapsed);
  }

  function pending(): Question | null {
    if (!pendingId) return null;
    return questions.find((q) => q.id === pendingId) ?? null;
  }

  function record(type: ProjectEventType, detail?: Record<string, unknown>): void {
    const ev: ProjectEvent = { at: new Date().toISOString(), t: elapsed(), type, detail };
    events.push(ev);
    project?.saveEvents(events);
  }

  function buildResult(ev: AgentEvent): AgentEventResult {
    const fresh = segments.slice(segCursor).map((s) => ({ ...s }));
    segCursor = segments.length;
    const q = pending();
    return {
      ...ev,
      new_segments: fresh,
      total_segments: segments.length,
      recording,
      ended,
      pending_question: q ? q.text : null,
      pending_question_id: q ? q.id : null,
      elapsed_s: elapsed(),
    };
  }

  function emitAgentEvent(ev: AgentEvent): void {
    if (waiter) {
      const w = waiter;
      setWaiter(null);
      clearTimeout(w.timer);
      w.resolve(buildResult(ev));
    } else {
      eventQueue.push(ev);
    }
  }

  // ---------------------------------------------------------------- transcript
  function addSegment(seg: Segment): void {
    segments.push(seg);
    project?.saveTranscript(segments);
    emit("transcript");
  }

  function saveQuestions(): void {
    project?.saveQuestions(questions);
    emit("questions");
  }

  /** The status line shows state only: "recording" while recording, whatever came before otherwise. */
  function transcribingStatus(): void {
    if (!recording) return;
    setStatus("status.recording");
  }

  function schedulePauseRecheck(): void {
    if (pauseTimer !== null) return;
    pauseTimer = window.setTimeout(() => {
      pauseTimer = null;
      flushPause();
    }, PAUSE_RECHECK_MS);
  }

  /** Deliver the queued pause only once the speech engine has caught up. */
  function flushPause(): void {
    if (!pausePending) return;
    const drained = engine === null || engine.pending === 0;
    const expired = Date.now() - pausePending.since > PAUSE_DEFER_LIMIT_MS;
    if (!drained && !expired) {
      schedulePauseRecheck();
      return;
    }
    const p = pausePending;
    pausePending = null;
    if (pauseTimer !== null) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    record("pause", { silence_s: round1(p.silenceS) });
    emitAgentEvent({ event: "pause", silence_s: round1(p.silenceS) });
  }

  const transcribeOptions = () => ({ glossary: parseGlossary(glossaryText), language: speechLanguage });

  function onUtterance(audio: Float32Array, t0: number, t1: number): void {
    engine?.feed(audio, t0, t1, transcribeOptions());
    transcribingStatus();
  }

  /** What the engine calls back with while recording. */
  const engineCallbacks = {
    onSegment(t0: number, t1: number, text: string) {
      addSegment({ t0: round1(t0 + timeOffset), t1: round1(t1 + timeOffset), text });
      transcribingStatus();
      flushPause();
    },
    onError(message: string) {
      setStatus("status.transcribeFailed", { message }, true);
      flushPause();
    },
  };

  // ---------------------------------------------------------------- ASR
  /** The engine for the chosen model, created (or replaced) on demand. null while no model is chosen or creation failed. */
  function ensureEngine(): SpeechEngine | null {
    if (asrModel === null) {
      asrReadiness = "unset";
      setAsrState("asr.chooseModel");
      setStatus("status.chooseModel", undefined, true);
      emit("state");
      return null;
    }
    if (engine && engineServes(engine, asrModel)) return engine;
    if (engineError) return null;
    if (engine) {
      engine.dispose();
      engine = null;
      asrLoad = null;
    }
    try {
      engine = createSpeechEngine(asrModel);
    } catch (e) {
      engineError = e instanceof Error ? e.message : String(e);
      setAsrState("status.asrInitFailed", { message: engineError });
      setStatus("status.asrInitFailed", { message: engineError }, true);
      asrReadiness = "failed";
      emit("state");
    }
    return engine;
  }

  function preloadAsr(): void {
    const asr = ensureEngine();
    if (!asr) return;
    if (asrLoad) return;
    setAsrState("status.modelLoading");
    setStatus("status.modelLoading");
    asrReadiness = "loading";
    emit("state");
    asrLoad = asr
      .load(
        (p) => {
          const key = ASR_MESSAGE[p.code] ?? "asr.idle";
          setAsrState(key, p.params);
          setStatus(key, p.params, p.status === "error");
          asrReadiness = p.status === "ready" ? "ready" : p.status === "error" ? "failed" : "loading";
          emit("state");
        },
        { model: asrModel ?? undefined, language: speechLanguage },
      )
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e);
        setAsrState("status.modelLoadFailed", { message });
        setStatus("status.modelLoadFailed", { message }, true);
        asrLoad = null;
        asrReadiness = "failed";
        emit("state");
        throw e;
      });
    // Keep a preload nobody awaits from turning into an unhandledrejection
    asrLoad.catch(() => undefined);
  }

  /**
   * Push the current model into the engine. Within whisper this is a model switch (the load
   * callback registered by preloadAsr keeps reporting progress, so the status line shows the
   * download again; utterances already being transcribed finish on the old model). Across engine
   * kinds the engine is replaced and loaded afresh.
   */
  function applyAsrModel(): void {
    const asr = engine;
    if (asrModel === null) return;
    if (!asr) {
      if (project && asrLoad === null) preloadAsr(); // e.g. the first choice on a machine without WebGPU
      return;
    }
    if (asr.model === asrModel) return;
    if (asrLoad === null) return; // never loaded (or the load failed): the next preloadAsr picks up the new model
    if (!engineServes(asr, asrModel)) {
      if (recording || finishing) {
        // The running engine keeps this recording; the next start() switches
        setStatus("status.modelNextRecording");
        return;
      }
      engineError = null;
      asr.dispose();
      engine = null;
      asrLoad = null;
      if (project) preloadAsr();
      return;
    }
    setAsrState("status.modelLoading");
    setStatus("status.modelLoading");
    asrReadiness = "loading";
    emit("state");
    asrLoad = asr.setModel(asrModel, { language: speechLanguage }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      setAsrState("status.modelLoadFailed", { message });
      setStatus("status.modelLoadFailed", { message }, true);
      asrLoad = null;
      asrReadiness = "failed";
      emit("state");
      throw e;
    });
    asrLoad.catch(() => undefined);
  }

  // ---------------------------------------------------------------- project
  function adoptProject(p: Project): void {
    project = p;
    p.onError = (key, params) => setStatus(key, params, true);
    cancelNotesHistory(); // do not carry an edit meant for the previous project over

    segments.length = 0;
    segments.push(...p.snapshot.segments);
    questions.length = 0;
    questions.push(...p.snapshot.questions);
    events.length = 0;
    events.push(...p.snapshot.events);
    segCursor = segments.length; // an existing transcript is not handed over as "new"
    pendingId = null;
    questionSeq = questions.reduce((max, q) => {
      const m = /^q(\d+)$/.exec(q.id);
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    // project.json wins; otherwise keep an explicit choice, else the browser default
    speechLanguage = p.snapshot.language ?? (languageChosen ? speechLanguage : defaultSpeechLanguage());
    if (p.snapshot.language === null) p.saveMeta({ language: speechLanguage }); // from now on project.json owns it
    asrModel = p.snapshot.asrModel ?? asrModel; // otherwise the device default (see asrModelDetected)
    if (p.snapshot.asrModel === null && asrModel !== null) p.saveMeta({ asrModel });
    outlineMd = p.snapshot.outlineMd;
    slidesMd = p.snapshot.slidesMd;
    glossaryText = p.snapshot.glossary;
    notesText = p.snapshot.notes;
    transcriptRevision += 1;

    // A project that already has audio (audio.wav) can be continued with "resume"
    recording = false;
    started = p.snapshot.hasAudio || segments.length > 0;
    ended = p.snapshot.hasAudio;
    timeOffset = 0;
    frozenElapsed = p.snapshot.elapsedS ?? (segments.length ? segments[segments.length - 1].t1 : 0);

    // "project" comes last (the UI picks the active tab on it)
    emit("transcript");
    emit("questions");
    emit("outline");
    emit("slides");
    emit("glossary");
    emit("notes");
    emit("timer");
    emit("history");
    emit("language");
    emit("asrModel");
    emit("state");
    emit("project");
    // The project name is shown in the header, so the status line goes back to state only
    setStatus("status.idle");
    // Reload the model when the project opened uses a different one (the status line reports that progress)
    applyAsrModel();
  }

  // ---------------------------------------------------------------- actions
  async function start(): Promise<void> {
    if (!project) {
      setStatus("status.needProject", undefined, true);
      return;
    }
    if (recording || finishing) return;
    const resuming = ended;

    engineError = null; // a failed engine creation is retried by Start
    const asr = ensureEngine();
    if (!asr) return;

    setStatus("status.modelPreparing");
    preloadAsr();
    try {
      await asrLoad;
    } catch {
      return; // preloadAsr already put the state on screen
    }

    setStatus("status.micPreparing");
    let rec: Recorder;
    try {
      rec = createRecorder();
      await rec.start({
        onSpeechStart: () => {
          speaking = true;
          emit("speaking");
        },
        onUtterance: (audio, t0, t1) => {
          speaking = false;
          emit("speaking");
          onUtterance(audio, t0, t1);
        },
        onPause: (_t, silenceS) => {
          speaking = false;
          emit("speaking");
          pausePending = { silenceS, since: Date.now() };
          flushPause();
        },
        onError: (message) => setStatus("status.recordError", { message }, true),
      });
    } catch (e) {
      setStatus("status.recordStartFailed", { message: e instanceof Error ? e.message : String(e) }, true);
      return;
    }
    try {
      await asr.start(engineCallbacks, transcribeOptions(), () => rec.elapsed);
    } catch (e) {
      setStatus("status.recordStartFailed", { message: e instanceof Error ? e.message : String(e) }, true);
      void rec.stop().catch(() => undefined);
      return;
    }

    recorder = rec;
    recording = true;
    started = true;
    ended = false;
    timeOffset = resuming ? frozenElapsed : 0;
    // A queued "ended" from the previous run must not reach the agent after resuming.
    for (let i = eventQueue.length - 1; i >= 0; i--) if (eventQueue[i].event === "ended") eventQueue.splice(i, 1);
    record(resuming ? "resumed" : "started");
    setStatus("status.recording");
    emit("state");
  }

  function askNow(): void {
    if (!recording) return;
    record("ask_now");
    emitAgentEvent({ event: "ask_now" });
  }

  async function end(): Promise<void> {
    if (!recording || finishing) return;
    finishing = true;
    recording = false;
    speaking = false;
    pausePending = null;
    if (pauseTimer !== null) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }
    emit("speaking");
    emit("state");
    setStatus("status.ending");

    const rec = recorder;
    recorder = null;
    if (rec) {
      frozenElapsed = round1(rec.elapsed + timeOffset);
      try {
        const wav = await rec.stop();
        setStatus("status.savingAudio");
        await project?.saveAudio(wav);
        project?.saveMeta({ elapsedS: frozenElapsed });
      } catch (e) {
        setStatus("status.saveAudioFailed", { message: e instanceof Error ? e.message : String(e) }, true);
      }
    }

    // Wait for the transcription still in flight (with a cap, in case it never finishes)
    setStatus("status.draining");
    const eng = engine;
    if (eng) {
      try {
        await eng.stop();
      } catch (e) {
        console.warn("engine stop failed", e);
      }
    }
    const deadline = Date.now() + DRAIN_LIMIT_MS;
    while (engine !== null && engine.pending > 0) {
      if (Date.now() > deadline) {
        setStatus("status.drainTimeout", undefined, true);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    ended = true;
    finishing = false;
    record("ended");
    emitAgentEvent({ event: "ended" });
    emit("state");
    setStatus("status.ended");
    await project?.flush();
  }

  function answerTyped(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const q = pending();
    if (q) {
      q.answer = trimmed;
      q.source = "typed";
      q.answeredT = elapsed();
      pendingId = null;
    } else {
      // An unprompted note, with no question pending
      questionSeq += 1;
      questions.push({
        id: `q${questionSeq}`,
        t: elapsed(),
        text: "",
        answer: trimmed,
        source: "typed",
        answeredT: elapsed(),
      });
    }
    saveQuestions();
    record("answered", { question_id: q ? q.id : null, source: "typed", text: trimmed });
    emitAgentEvent({
      event: "answered",
      answer: trimmed,
      question_id: q ? q.id : undefined,
      source: "typed",
    });
  }

  function addGlossary(words: string[]): string[] {
    const current = parseGlossary(glossaryText);
    const fresh = words.filter((w) => !current.includes(w));
    if (fresh.length > 0) {
      setGlossary([...current, ...fresh].join(", "));
      record("glossary_added", { words: fresh });
    }
    return parseGlossary(glossaryText);
  }

  function setGlossary(text: string): void {
    glossaryText = text;
    emit("glossary");
    if (glossarySaveTimer !== null) clearTimeout(glossarySaveTimer);
    glossarySaveTimer = window.setTimeout(() => {
      glossarySaveTimer = null;
      project?.saveGlossary(glossaryText);
    }, GLOSSARY_SAVE_MS);
  }

  // ---------------------------------------------------------------- history
  /** Save a generation in the background; the UI refreshes on the "history" event. */
  function keepHistory(doc: HistoryDoc, content: string, source: HistorySource, note?: string): void {
    const p = project;
    if (!p) return;
    void p
      .recordHistory(doc, content, source, note)
      .then((entry) => {
        if (entry) emit("history"); // null means the content was identical, so nothing changed
      })
      .catch((e: unknown) => console.warn("history write failed", doc, e));
  }

  function currentDoc(doc: HistoryDoc): string {
    if (doc === "slides") return slidesMd;
    if (doc === "outline") return outlineMd;
    return notesText;
  }

  function applyDoc(doc: HistoryDoc, content: string, source: HistorySource, note?: string): void {
    if (doc === "slides") applySlides(content, source, note);
    else if (doc === "outline") applyOutline(content, source, note);
    else applyNotes(content, source, note);
  }

  async function restoreHistory(doc: HistoryDoc, file: string): Promise<RestoreResult | ToolError> {
    const p = project;
    if (!p) return { error: "no project is open yet" };
    const entry = (await p.listHistory(doc)).find((e) => e.file === file);
    if (!entry) return { error: `unknown generation: ${file} (call list_history for the available files)` };
    const content = await p.readHistory(doc, file);
    if (content === null) return { error: `could not read the generation ${file}` };

    // The current content is kept as a generation before restoring, so nothing is lost by overwriting
    const current = currentDoc(doc);
    if (current !== content) await p.recordHistory(doc, current, "user", t("hist.beforeRestore"));
    applyDoc(doc, content, "restore", file);
    record("history_restored", { doc, file, at: entry.at });
    return { ok: true as const, doc, at: entry.at };
  }

  // ---------------------------------------------------------------- notes
  function scheduleNotesSave(): void {
    if (notesSaveTimer !== null) clearTimeout(notesSaveTimer);
    notesSaveTimer = window.setTimeout(() => {
      notesSaveTimer = null;
      project?.saveNotes(notesText);
    }, NOTES_SAVE_MS);
  }

  function cancelNotesHistory(): void {
    if (notesHistoryTimer === null) return;
    clearTimeout(notesHistoryTimer);
    notesHistoryTimer = null;
  }

  function applyNotes(text: string, source: HistorySource, note?: string): void {
    cancelNotesHistory();
    notesText = text;
    emit("notes");
    scheduleNotesSave();
    keepHistory("notes", text, source, note);
  }

  function setNotes(text: string): void {
    applyNotes(text, "agent");
  }

  /** The user typing: one generation once they stop for NOTES_HISTORY_MS (or blur the field). */
  function editNotes(text: string): void {
    notesText = text;
    emit("notes");
    scheduleNotesSave();
    cancelNotesHistory();
    notesHistoryTimer = window.setTimeout(() => {
      notesHistoryTimer = null;
      keepHistory("notes", notesText, "user");
    }, NOTES_HISTORY_MS);
  }

  function flushNotesEdit(): void {
    if (notesHistoryTimer === null) return;
    cancelNotesHistory();
    keepHistory("notes", notesText, "user");
  }

  function appendNote(text: string): string {
    const line = timerRunning ? `[${mmss(timerS())}] ${text}` : text;
    const base = notesText.length > 0 && !notesText.endsWith("\n") ? `${notesText}\n` : notesText;
    applyNotes(`${base}${line}\n`, "agent");
    return notesText;
  }

  // ---------------------------------------------------------------- outline / slides
  function applyOutline(markdown: string, source: HistorySource, note?: string): void {
    outlineMd = markdown;
    project?.saveOutline(markdown);
    record("outline_set");
    emit("outline");
    keepHistory("outline", markdown, source, note);
  }

  function applySlides(markdown: string, source: HistorySource, note?: string): void {
    slidesMd = markdown;
    project?.saveSlides(markdown);
    record("slides_set");
    emit("slides");
    keepHistory("slides", markdown, source, note);
  }

  // ---------------------------------------------------------------- practice timer
  function timerMs(): number {
    return timerAccumMs + (timerRunning ? Date.now() - timerStartedAt : 0);
  }

  function timerS(): number {
    return round1(timerMs() / 1000);
  }

  function startTimer(): { ok: true } {
    timerAccumMs = 0;
    timerStartedAt = Date.now();
    timerRunning = true;
    record("timer_started");
    emit("timer");
    return { ok: true as const };
  }

  function stopTimer(): { ok: true; elapsed_s: number } | ToolError {
    if (!timerRunning) return { error: "the practice timer is not running" };
    timerAccumMs = timerMs();
    timerRunning = false;
    const elapsedS = round1(timerAccumMs / 1000);
    record("timer_stopped", { elapsed_s: elapsedS });
    emit("timer");
    return { ok: true as const, elapsed_s: elapsedS };
  }

  function setLanguage(language: SpeechLanguage): { ok: true; language: SpeechLanguage } {
    languageChosen = true;
    if (language !== speechLanguage) {
      speechLanguage = language;
      project?.saveMeta({ language });
      record("language_set", { language });
      emit("language");
    }
    return { ok: true as const, language: speechLanguage };
  }

  function setAsrModel(model: AsrModel): { ok: true; model: AsrModel } {
    asrModelChosen = true;
    rememberAsrModel(model); // the default for new projects on this device from now on
    if (model !== asrModel) {
      asrModel = model;
      project?.saveMeta({ asrModel: model });
      record("asr_model_set", { model });
      emit("asrModel");
      applyAsrModel();
    }
    return { ok: true as const, model: asrModel };
  }

  function resetTimer(): { ok: true } {
    timerRunning = false;
    timerStartedAt = 0;
    timerAccumMs = 0;
    emit("timer");
    return { ok: true as const };
  }

  // ---------------------------------------------------------------- corrections
  function correctSegments(corrections: readonly SegmentCorrection[]): CorrectionResult {
    let updated = 0;
    const unmatched: number[] = [];
    for (const c of corrections) {
      const key = round1(c.t0);
      const seg = segments.find((s) => round1(s.t0) === key);
      if (!seg) {
        unmatched.push(key);
        continue;
      }
      const corrected = c.text.trim();
      // An empty string (or one identical to the original) clears the correction
      if (corrected === "" || corrected === seg.text) delete seg.corrected;
      else seg.corrected = corrected;
      updated += 1;
    }
    if (updated > 0) {
      project?.saveTranscript(segments);
      transcriptRevision += 1;
      emit("transcript");
    }
    return { ok: true as const, updated, unmatched };
  }

  // ---------------------------------------------------------------- agent API
  const notStarted = (): ToolError => ({
    error: "recording has not started yet: the user must choose a project folder and press 録音開始 / Start recording",
  });

  function waitForEvent(maxWaitS?: number): Promise<AgentEventResult | ToolError> {
    if (!started) return Promise.resolve(notStarted());

    if (waiter) {
      const prev = waiter;
      setWaiter(null);
      clearTimeout(prev.timer);
      prev.resolve(buildResult({ event: "superseded" }));
    }

    let max = typeof maxWaitS === "number" && isFinite(maxWaitS) && maxWaitS > 0 ? maxWaitS : DEFAULT_WAIT_S;
    if (max > MAX_WAIT_S) max = MAX_WAIT_S;

    const queued = eventQueue.shift();
    if (queued) return Promise.resolve(buildResult(queued));
    if (ended) return Promise.resolve(buildResult({ event: "ended" }));

    return new Promise<AgentEventResult>((resolve) => {
      const timer = window.setTimeout(() => {
        setWaiter(null);
        resolve(buildResult({ event: "timeout" }));
      }, max * 1000);
      setWaiter({ resolve, timer });
    });
  }

  return {
    on(name, fn) {
      const arr = listeners.get(name);
      if (arr) arr.push(fn);
      else listeners.set(name, [fn]);
    },

    get segments() {
      return segments;
    },
    get questions() {
      return questions;
    },
    get pendingQuestion() {
      return pending();
    },
    get recording() {
      return recording;
    },
    get ended() {
      return ended;
    },
    get started() {
      return started;
    },
    get agentListening() {
      return waiter !== null;
    },
    get lastAgentCallAt() {
      return lastAgentCallAt;
    },
    touchAgent() {
      lastAgentCallAt = Date.now();
      emit("agent");
    },
    get finishing() {
      return finishing;
    },
    get speaking() {
      return speaking;
    },
    get elapsed() {
      return elapsed();
    },
    get status() {
      return statusView();
    },
    get asrStatus() {
      return t(asrState.key, asrState.params);
    },
    get asrReadiness() {
      return asrReadiness;
    },
    get asrBackend() {
      return engine ? engine.backend : null;
    },
    get projectOpen() {
      return project !== null;
    },
    get projectName() {
      return project ? project.name : null;
    },
    get outlineMd() {
      return outlineMd;
    },
    get slidesMd() {
      return slidesMd;
    },
    get glossaryText() {
      return glossaryText;
    },
    get notesText() {
      return notesText;
    },
    get transcriptRevision() {
      return transcriptRevision;
    },
    get timerRunning() {
      return timerRunning;
    },
    get timerSeconds() {
      return timerS();
    },
    get language() {
      return speechLanguage;
    },
    get asrModel() {
      return asrModel;
    },
    get canUseFileSystem() {
      return fileSystemAccessAvailable();
    },
    get fileSystemProblem() {
      return unavailableReason();
    },

    lastProjectName,

    async openProject() {
      try {
        const p = await pickProject();
        await asrModelDetected; // a new project records the device default, so make sure the probe is in
        adoptProject(p);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStatus("status.openFailed", { message: e instanceof Error ? e.message : String(e) }, true);
      }
    },

    async openLastProject() {
      try {
        const p = await reopenLastProject();
        if (!p) {
          setStatus("status.noLastProject", undefined, true);
          return;
        }
        await asrModelDetected;
        adoptProject(p);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setStatus("status.openLastFailed", { message: e instanceof Error ? e.message : String(e) }, true);
      }
    },

    preloadAsr,
    start,
    askNow,
    end,
    answerTyped,
    setGlossary,
    addGlossary,
    setNotes,
    editNotes,
    flushNotesEdit,
    appendNote,
    listHistory: (doc) => (project ? project.listHistory(doc) : Promise.resolve([])),
    restoreHistory,
    startTimer,
    stopTimer,
    resetTimer,
    setLanguage,
    setAsrModel,

    waitForEvent,
    correctSegments,

    getNewSegments() {
      if (!started) return notStarted();
      const fresh = segments.slice(segCursor).map((s) => ({ ...s }));
      segCursor = segments.length;
      return { new_segments: fresh, total_segments: segments.length };
    },

    getTranscript(): TranscriptView {
      return {
        segments: segments.map((s) => ({ ...s })),
        questions: questions.map((q) => ({ ...q })),
        glossary: parseGlossary(glossaryText),
        notes: notesText,
        language: speechLanguage,
        recording,
        ended,
        elapsed_s: elapsed(),
      };
    },

    showQuestion(text: string) {
      if (!project) return { error: "no project is open yet" };
      questionSeq += 1;
      const q: Question = {
        id: `q${questionSeq}`,
        t: elapsed(),
        text,
        answer: null,
        source: null,
        answeredT: null,
      };
      questions.push(q);
      pendingId = q.id;
      saveQuestions();
      record("question_shown", { question_id: q.id, text });
      return { ok: true as const, question_id: q.id };
    },

    resolveQuestion(id: string, answer: string, source: AnswerSource) {
      const q = questions.find((x) => x.id === id);
      if (!q) return { error: `unknown question_id: ${id}` };
      q.answer = source === "skipped" && !answer ? null : answer;
      q.source = source;
      q.answeredT = elapsed();
      if (pendingId === id) pendingId = null;
      saveQuestions();
      record("answered", { question_id: id, source, text: answer });
      return { ok: true as const };
    },

    setOutline(markdown: string) {
      applyOutline(markdown, "agent");
      return { ok: true as const };
    },

    setSlides(markdown: string) {
      applySlides(markdown, "agent");
      return { ok: true as const };
    },

    getStatus(): StatusReport {
      const q = pending();
      return {
        project_open: project !== null,
        project_name: project ? project.name : null,
        recording,
        ended,
        total_segments: segments.length,
        elapsed_s: elapsed(),
        pending_question: q ? q.text : null,
        pending_question_id: q ? q.id : null,
        asr_backend: engine ? engine.backend : null,
        asr_status: t(asrState.key, asrState.params),
        timer_running: timerRunning,
        timer_s: timerS(),
        language: speechLanguage,
        asr_model: asrModel,
      };
    },
  };
}
