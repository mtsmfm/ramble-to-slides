/**
 * The project directory the user picks with the File System Access API.
 *
 * Layout (all files live directly in the chosen directory):
 *   project.json      {name, createdAt, version, elapsedS, audioParts, language, asrModel}
 *   audio.wav, audio-2.wav, …  one WAV per recording run (stop → resume starts a new part)
 *   transcript.jsonl  one {t0,t1,text} (plus "corrected" once the agent fixed it) per line,
 *                     rewritten whenever a segment arrives or is corrected
 *   questions.jsonl   one Question per line, rewritten on every change
 *   events.jsonl      one ProjectEvent per line, appended (rewritten in full)
 *   outline.md / slides.md / glossary.txt / notes.md
 *   history/<doc>/<ISO timestamp>.md   one file per generation of slides / outline / notes
 *   history/<doc>/index.jsonl          one HistoryEntry per line, oldest first
 */
import { isAsrModel, type AsrModel, type SpeechLanguage } from "../asr/types";
import { t, type MessageKey, type Params } from "../i18n";
import type { ProjectEvent, Question, Segment } from "../types";
import {
  fileSystemAccessAvailable,
  queryPermission,
  requestPermission,
  showDirectoryPicker,
  unavailableReason,
} from "./fsa";
import { clearLastHandle, loadLastHandle, saveLastHandle } from "./idb";

export const PROJECT_VERSION = 1;

export const FILES = {
  meta: "project.json",
  audio: "audio.wav",
  transcript: "transcript.jsonl",
  questions: "questions.jsonl",
  events: "events.jsonl",
  outline: "outline.md",
  slides: "slides.md",
  glossary: "glossary.txt",
  notes: "notes.md",
} as const;

/** The documents that keep a version history (one directory each under history/). */
export type HistoryDoc = "slides" | "outline" | "notes";
/** Who produced a generation: a WebMCP tool, the user typing, or a restore. */
export type HistorySource = "agent" | "user" | "restore";

/** One line of history/<doc>/index.jsonl. */
export interface HistoryEntry {
  /** File name inside history/<doc>/, e.g. "2026-09-09T13-05-22.123Z.md". */
  file: string;
  /** Wall clock when the generation was recorded, ISO 8601. */
  at: string;
  source: HistorySource;
  /** Length of the content in characters. */
  chars: number;
  /** For "restore": the file it was restored from. */
  note?: string;
}

export const HISTORY_DIR = "history";
export const HISTORY_INDEX = "index.jsonl";
/** Generations kept per document; older files and index lines are deleted. */
export const HISTORY_LIMIT = 30;

/** Everything that was already on disk when the project was opened. */
export interface ProjectSnapshot {
  name: string;
  createdAt: string;
  segments: Segment[];
  questions: Question[];
  events: ProjectEvent[];
  outlineMd: string;
  slidesMd: string;
  glossary: string;
  notes: string;
  /** audio.wav exists → this project has already been recorded (it can be resumed). */
  hasAudio: boolean;
  /** Number of audio parts on disk (audio.wav, audio-2.wav, …). */
  audioParts: number;
  /** Total recorded seconds so far (from project.json), if known. */
  elapsedS: number | null;
  /** Speech language remembered for this project, or null when it was never set. */
  language: SpeechLanguage | null;
  /** Speech-recognition model remembered for this project, or null when it was never set. */
  asrModel: AsrModel | null;
}

export interface Project {
  readonly name: string;
  readonly snapshot: ProjectSnapshot;
  /** Called with a localizable message key when a background write fails. */
  onError: ((key: MessageKey, params?: Params) => void) | null;
  saveTranscript(segments: readonly Segment[]): void;
  saveQuestions(questions: readonly Question[]): void;
  saveEvents(events: readonly ProjectEvent[]): void;
  saveOutline(markdown: string): void;
  saveSlides(markdown: string): void;
  saveGlossary(text: string): void;
  saveNotes(markdown: string): void;
  /** Write the next audio part (audio.wav, then audio-2.wav, …). */
  saveAudio(blob: Blob): Promise<void>;
  /** Persist total recorded seconds / the speech language / the ASR model into project.json. */
  saveMeta(patch: { elapsedS?: number; language?: SpeechLanguage; asrModel?: AsrModel }): void;

  // --- version history (history/<doc>/) ---
  /**
   * Save one generation of a document. Resolves with the new entry, or null when
   * the content was identical to the newest generation (nothing is written then).
   */
  recordHistory(
    doc: HistoryDoc,
    content: string,
    source: HistorySource,
    note?: string,
  ): Promise<HistoryEntry | null>;
  /** Generations of one document, newest first ([] when there is no history yet). */
  listHistory(doc: HistoryDoc): Promise<HistoryEntry[]>;
  /** Content of one generation, or null when the file is not in the index / unreadable. */
  readHistory(doc: HistoryDoc, file: string): Promise<string | null>;

  /** Wait for every queued write to finish. */
  flush(): Promise<void>;
}

export { fileSystemAccessAvailable, unavailableReason };

// ---------------------------------------------------------------- reading

async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function fileExists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

function parseJsonl<T>(text: string | null, pick: (v: Record<string, unknown>) => T | null): T[] {
  if (!text) return [];
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const v: unknown = JSON.parse(trimmed);
      if (typeof v !== "object" || v === null) continue;
      const item = pick(v as Record<string, unknown>);
      if (item) out.push(item);
    } catch {
      /* drop broken lines */
    }
  }
  return out;
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

function parseSegments(text: string | null): Segment[] {
  return parseJsonl<Segment>(text, (v) => {
    const seg: Segment = { t0: num(v.t0), t1: num(v.t1), text: str(v.text) };
    if (typeof v.corrected === "string" && v.corrected !== "") seg.corrected = v.corrected;
    return seg;
  });
}

function parseQuestions(text: string | null): Question[] {
  return parseJsonl<Question>(text, (v) => {
    const id = str(v.id);
    if (!id) return null;
    const source = v.source;
    return {
      id,
      t: num(v.t),
      text: str(v.text),
      answer: typeof v.answer === "string" ? v.answer : null,
      source: source === "spoken" || source === "typed" || source === "skipped" ? source : null,
      answeredT: typeof v.answeredT === "number" ? v.answeredT : null,
    };
  });
}

function parseEvents(text: string | null): ProjectEvent[] {
  return parseJsonl<ProjectEvent>(text, (v) => {
    const type = str(v.type);
    if (!type) return null;
    return {
      at: str(v.at, new Date(0).toISOString()),
      t: num(v.t),
      type: type as ProjectEvent["type"],
      detail: typeof v.detail === "object" && v.detail !== null ? (v.detail as Record<string, unknown>) : undefined,
    };
  });
}

function parseHistory(text: string | null): HistoryEntry[] {
  return parseJsonl<HistoryEntry>(text, (v) => {
    const file = str(v.file);
    if (!safeFileName(file)) return null;
    const source = v.source;
    const entry: HistoryEntry = {
      file,
      at: str(v.at, new Date(0).toISOString()),
      source: source === "agent" || source === "user" || source === "restore" ? source : "agent",
      chars: num(v.chars),
    };
    if (typeof v.note === "string" && v.note !== "") entry.note = v.note;
    return entry;
  });
}

/** A plain file name inside history/<doc>/ — never a path. */
function safeFileName(name: string): boolean {
  return name !== "" && name !== "." && name !== ".." && !/[/\\]/.test(name);
}

// ---------------------------------------------------------------- writing

/** One-shot write into any directory handle (the queued writer only knows the project root). */
async function writeInto(dir: FileSystemDirectoryHandle, name: string, data: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const stream = await fh.createWritable();
  try {
    await stream.write(data);
  } finally {
    await stream.close();
  }
}

/**
 * Per-file serialized writer. Writes are fire-and-forget; if a file is written
 * again while the previous write is still running only the newest content is kept.
 */
function createWriter(dir: FileSystemDirectoryHandle) {
  const queued = new Map<string, string>();
  const running = new Map<string, Promise<void>>();
  let onError: ((key: MessageKey, params?: Params) => void) | null = null;

  async function writeNow(name: string, data: string | Blob): Promise<void> {
    const fh = await dir.getFileHandle(name, { create: true });
    const stream = await fh.createWritable();
    try {
      await stream.write(data);
    } finally {
      await stream.close();
    }
  }

  async function drain(name: string): Promise<void> {
    for (;;) {
      const next = queued.get(name);
      if (next === undefined) return;
      queued.delete(name);
      try {
        await writeNow(name, next);
      } catch (e) {
        onError?.("store.writeFailed", { name, message: e instanceof Error ? e.message : String(e) });
        return;
      }
    }
  }

  return {
    set onError(fn: ((key: MessageKey, params?: Params) => void) | null) {
      onError = fn;
    },
    get onError(): ((key: MessageKey, params?: Params) => void) | null {
      return onError;
    },
    text(name: string, content: string): void {
      queued.set(name, content);
      if (running.has(name)) return;
      const p = drain(name).finally(() => running.delete(name));
      running.set(name, p);
    },
    async blob(name: string, blob: Blob): Promise<void> {
      const prev = running.get(name);
      const p = (prev ?? Promise.resolve()).then(() => writeNow(name, blob));
      running.set(
        name,
        p.catch(() => undefined).finally(() => running.delete(name)),
      );
      await p;
    },
    async flush(): Promise<void> {
      while (running.size) await Promise.all([...running.values()]);
    },
  };
}

const jsonl = (rows: readonly unknown[]): string =>
  rows.length ? rows.map((r) => JSON.stringify(r)).join("\n") + "\n" : "";

// ---------------------------------------------------------------- open

async function loadSnapshot(dir: FileSystemDirectoryHandle): Promise<ProjectSnapshot> {
  const [metaText, transcript, questions, events, outline, slides, glossary, notes, audioParts] =
    await Promise.all([
      readText(dir, FILES.meta),
      readText(dir, FILES.transcript),
      readText(dir, FILES.questions),
      readText(dir, FILES.events),
      readText(dir, FILES.outline),
      readText(dir, FILES.slides),
      readText(dir, FILES.glossary),
      readText(dir, FILES.notes),
      countAudioParts(dir),
    ]);
  const hasAudio = audioParts > 0;

  let name = dir.name;
  let createdAt = new Date().toISOString();
  let elapsedS: number | null = null;
  let language: SpeechLanguage | null = null;
  let asrModel: AsrModel | null = null;
  if (metaText) {
    try {
      const meta: unknown = JSON.parse(metaText);
      if (typeof meta === "object" && meta !== null) {
        const m = meta as Record<string, unknown>;
        name = str(m.name, name);
        createdAt = str(m.createdAt, createdAt);
        if (typeof m.elapsedS === "number" && Number.isFinite(m.elapsedS)) elapsedS = m.elapsedS;
        if (m.language === "ja" || m.language === "en") language = m.language;
        if (isAsrModel(m.asrModel)) asrModel = m.asrModel;
      }
    } catch {
      /* ignore a broken project.json */
    }
  }

  return {
    name,
    createdAt,
    segments: parseSegments(transcript),
    questions: parseQuestions(questions),
    events: parseEvents(events),
    outlineMd: outline ?? "",
    slidesMd: slides ?? "",
    glossary: glossary ?? "",
    notes: notes ?? "",
    hasAudio,
    audioParts,
    elapsedS,
    language,
    asrModel,
  };
}

export const audioPartName = (index: number): string => (index === 1 ? FILES.audio : `audio-${index}.wav`);

async function countAudioParts(dir: FileSystemDirectoryHandle): Promise<number> {
  let n = 0;
  while (n < 1000 && (await fileExists(dir, audioPartName(n + 1)))) n += 1;
  return n;
}

async function attach(dir: FileSystemDirectoryHandle): Promise<Project> {
  const snapshot = await loadSnapshot(dir);
  const writer = createWriter(dir);

  let audioParts = snapshot.audioParts;
  let elapsedS = snapshot.elapsedS;
  let language = snapshot.language;
  let asrModel = snapshot.asrModel;
  const writeMeta = () =>
    writer.text(
      FILES.meta,
      JSON.stringify(
        {
          name: snapshot.name,
          createdAt: snapshot.createdAt,
          version: PROJECT_VERSION,
          elapsedS,
          audioParts,
          language,
          asrModel,
        },
        null,
        2,
      ) + "\n",
    );

  // Write project.json when this is a brand new directory
  if (!(await fileExists(dir, FILES.meta))) writeMeta();

  await saveLastHandle(dir).catch(() => undefined);

  // ------------------------------------------------------------ history
  /** index.jsonl per document, oldest first; loaded on demand and then kept in sync. */
  const historyIndex = new Map<HistoryDoc, HistoryEntry[]>();
  /** One promise chain for every history operation, so reads and writes never interleave. */
  let historyChain: Promise<unknown> = Promise.resolve();

  function queueHistory<T>(fn: () => Promise<T>): Promise<T> {
    const next = historyChain.then(fn, fn);
    historyChain = next.catch(() => undefined);
    return next;
  }

  async function historyDir(doc: HistoryDoc, create: boolean): Promise<FileSystemDirectoryHandle | null> {
    try {
      const root = await dir.getDirectoryHandle(HISTORY_DIR, { create });
      return await root.getDirectoryHandle(doc, { create });
    } catch {
      return null; // no history/ yet (e.g. a read that does not create it)
    }
  }

  async function loadIndex(doc: HistoryDoc): Promise<HistoryEntry[]> {
    const cached = historyIndex.get(doc);
    if (cached) return cached;
    const dh = await historyDir(doc, false);
    const rows = dh ? parseHistory(await readText(dh, HISTORY_INDEX)) : [];
    historyIndex.set(doc, rows);
    return rows;
  }

  async function readGeneration(doc: HistoryDoc, file: string): Promise<string | null> {
    if (!safeFileName(file)) return null;
    const dh = await historyDir(doc, false);
    return dh ? readText(dh, file) : null;
  }

  async function recordNow(
    doc: HistoryDoc,
    content: string,
    source: HistorySource,
    note: string | undefined,
  ): Promise<HistoryEntry | null> {
    const rows = await loadIndex(doc);
    const latest = rows[rows.length - 1];
    // Skip when the content is identical to the previous generation (a different length rules it out without reading)
    if (latest && latest.chars === content.length && (await readGeneration(doc, latest.file)) === content) {
      return null;
    }

    const dh = await historyDir(doc, true);
    if (!dh) throw new Error(t("store.historyDirFailed", { doc }));

    const at = new Date().toISOString();
    const stamp = at.replace(/:/g, "-");
    let file = `${stamp}.md`;
    for (let n = 2; rows.some((r) => r.file === file); n++) file = `${stamp}-${n}.md`;

    const entry: HistoryEntry = { file, at, source, chars: content.length };
    if (note) entry.note = note;

    await writeInto(dh, file, content);
    const next = [...rows, entry];
    const dropped = next.length > HISTORY_LIMIT ? next.splice(0, next.length - HISTORY_LIMIT) : [];
    await writeInto(dh, HISTORY_INDEX, jsonl(next));
    historyIndex.set(doc, next);
    for (const old of dropped) await dh.removeEntry(old.file).catch(() => undefined);
    return entry;
  }

  return {
    name: snapshot.name,
    snapshot,
    get onError() {
      return writer.onError;
    },
    set onError(fn: ((key: MessageKey, params?: Params) => void) | null) {
      writer.onError = fn;
    },
    saveTranscript: (segments) => writer.text(FILES.transcript, jsonl(segments)),
    saveQuestions: (questions) => writer.text(FILES.questions, jsonl(questions)),
    saveEvents: (events) => writer.text(FILES.events, jsonl(events)),
    saveOutline: (markdown) => writer.text(FILES.outline, markdown),
    saveSlides: (markdown) => writer.text(FILES.slides, markdown),
    saveGlossary: (text) => writer.text(FILES.glossary, text),
    saveNotes: (markdown) => writer.text(FILES.notes, markdown),
    saveAudio: (blob) => {
      audioParts += 1;
      writeMeta();
      return writer.blob(audioPartName(audioParts), blob);
    },
    saveMeta: (patch) => {
      if (patch.elapsedS !== undefined) elapsedS = patch.elapsedS;
      if (patch.language !== undefined) language = patch.language;
      if (patch.asrModel !== undefined) asrModel = patch.asrModel;
      writeMeta();
    },

    recordHistory: (doc, content, source, note) =>
      queueHistory(() => recordNow(doc, content, source, note)).catch((e: unknown) => {
        writer.onError?.("store.historyWriteFailed", {
          doc,
          message: e instanceof Error ? e.message : String(e),
        });
        return null;
      }),
    listHistory: (doc) => queueHistory(() => loadIndex(doc)).then((rows) => [...rows].reverse()),
    readHistory: (doc, file) =>
      queueHistory(async () => {
        const rows = await loadIndex(doc);
        return rows.some((r) => r.file === file) ? readGeneration(doc, file) : null;
      }),

    flush: async () => {
      await writer.flush();
      await historyChain;
    },
  };
}

/** Ask the user for a directory. Rejects with an AbortError when they cancel. */
export async function pickProject(): Promise<Project> {
  const dir = await showDirectoryPicker({ id: "ramble-to-slides", mode: "readwrite" });
  const perm = await requestPermission(dir, "readwrite");
  if (perm !== "granted") throw new Error(t("store.permissionDenied"));
  return attach(dir);
}

/** Name of the directory remembered from last time, if any (no permission prompt). */
export async function lastProjectName(): Promise<string | null> {
  if (!fileSystemAccessAvailable()) return null;
  const dir = await loadLastHandle();
  return dir ? dir.name : null;
}

/** Reopen the remembered directory. Must be called from a user gesture (may prompt). */
export async function reopenLastProject(): Promise<Project | null> {
  const dir = await loadLastHandle();
  if (!dir) return null;
  let perm = await queryPermission(dir, "readwrite");
  if (perm !== "granted") perm = await requestPermission(dir, "readwrite");
  if (perm !== "granted") {
    await clearLastHandle().catch(() => undefined);
    throw new Error(t("store.lastPermissionDenied"));
  }
  return attach(dir);
}
