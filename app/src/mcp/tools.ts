/**
 * WebMCP tools. The agent (Claude Code, through the webmcp relay) drives the whole
 * facilitation loop with these; the page itself never calls an API.
 *
 * wait_for_event / get_new_segments / get_transcript / show_question /
 * resolve_question / set_outline / set_slides / end_session / add_glossary /
 * correct_segments / set_notes / append_note / start_timer / stop_timer /
 * reset_timer / set_language / set_asr_model / get_status / list_history / restore_history
 */
import INSTRUCTIONS from "./instructions.md?raw";
import { t } from "../i18n";
import type { HistoryDoc, Session, SegmentCorrection } from "../session";
import { ASR_MODELS, isAsrModel, type SpeechLanguage } from "../asr/types";
import { countSlides } from "../slides/marp";
import type { AnswerSource } from "../types";

interface McpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => unknown;
}

interface ModelContextLike {
  registerTool(tool: McpTool, options?: { signal?: AbortSignal }): Promise<void>;
}

function modelContext(): ModelContextLike | null {
  const mc = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  return mc && typeof mc.registerTool === "function" ? mc : null;
}

const str = (args: Record<string, unknown>, key: string): string | null => {
  const v = args[key];
  return typeof v === "string" ? v : null;
};

const HISTORY_DOCS = ["slides", "outline", "notes"] as const;
const historyDoc = (v: string | null): HistoryDoc | null =>
  HISTORY_DOCS.includes(v as HistoryDoc) ? (v as HistoryDoc) : null;

export function buildTools(session: Session): McpTool[] {
  return [
    {
      name: "get_instructions",
      description:
        "Read this first. Returns the facilitation playbook for this page (Markdown, Japanese): how to run the " +
        "wait_for_event loop, when to ask questions, how to handle voice commands, the practice-timer mode, and " +
        "the outline/slide style. Follow it unless the user tells you otherwise.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => ({ instructions: INSTRUCTIONS }),
    },
    {
      name: "wait_for_event",
      description:
        "The user controls everything by voice: watch new_segments for requests aimed at you (asking for a question, saying they are done) and act on them yourself with show_question / end_session. " +
        "Wait until something happens on the page, then return it together with a fresh snapshot of the " +
        'transcript. Call this in a loop to follow the conversation. Resolves when: the user asks for a question ' +
        '("ask me something", event "ask_now"), the user submits a typed answer (event "answered", with ' +
        '"answer", "question_id" and "source"), the speaker has been silent for a few seconds after talking ' +
        '(event "pause", with "silence_s" — delivered only once every utterance before it has been ' +
        'transcribed, so new_segments already contains what caused the pause), the user presses 録音終了 / Stop recording (event ' +
        '"ended", emitted after the last transcription finished), or the timeout elapses (event "timeout"). ' +
        'If another wait_for_event starts while one is pending, the older call returns event "superseded". ' +
        "Events that happen while nothing is waiting are queued and delivered in order on the next call, so " +
        'nothing is missed. Once the session has ended every call returns "ended" immediately, until the user presses 録音再開 / Resume recording: recording then continues with the same transcript and timestamps keep counting up. The result ' +
        "always includes new_segments (transcript segments not yet returned to you, each {t0,t1,text} in " +
        'seconds from recording start, plus "corrected" once you fixed that segment with correct_segments — ' +
        '"text" always stays the raw ASR output), total_segments, recording, ended, pending_question, ' +
        "pending_question_id and elapsed_s. Returns {error} until the user has started recording.",
      inputSchema: {
        type: "object",
        properties: {
          max_wait_s: {
            type: "number",
            description: 'Maximum seconds to wait before returning event "timeout". Default 45, max 90.',
          },
        },
      },
      execute: (args) => {
        const v = args.max_wait_s;
        return session.waitForEvent(typeof v === "number" ? v : undefined);
      },
    },
    {
      name: "get_new_segments",
      description:
        "Return the transcript segments that arrived since the last wait_for_event or get_new_segments call " +
        "and advance the read cursor. Use it for a quick non-blocking check. Returns {new_segments, total_segments}.",
      inputSchema: { type: "object", properties: {} },
      execute: () => session.getNewSegments(),
    },
    {
      name: "get_transcript",
      description:
        "Return the whole session so far without moving the read cursor: every transcript segment " +
        '({t0,t1,text}, plus "corrected" — your correct_segments fix-up — where one exists; prefer ' +
        "corrected over text when it is there), every question ({id,t,text,answer,source,answeredT}; " +
        'answer is null while unanswered, source is "spoken" | "typed" | "skipped", text is "" for a note ' +
        "the user typed without being asked), the glossary of proper nouns the user entered, notes (the " +
        "Markdown memo shared with the user, from notes.md), language (the speech language whisper is " +
        'transcribing in, "ja" or "en"), plus recording, ended and elapsed_s. ' +
        "Call this before writing the outline and the slides.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => session.getTranscript(),
    },
    {
      name: "show_question",
      description:
        "Show one question to the user in the question card, replacing whatever question was there (the " +
        "previous one stays in the history, unanswered). The user may answer out loud — it appears as " +
        'transcript segments, and you should then call resolve_question with source "spoken" — or type an ' +
        'answer, which arrives as the "answered" event and resolves the question automatically. Ask one ' +
        "short question at a time, in Japanese. Returns {ok, question_id}.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "The question to display, in Japanese." } },
        required: ["text"],
      },
      execute: (args) => {
        const text = str(args, "text");
        if (!text || !text.trim()) return { error: "text is required" };
        return session.showQuestion(text.trim());
      },
    },
    {
      name: "resolve_question",
      description:
        "Record how a question ended up being answered, so the page can show it in the history and save it " +
        'to questions.jsonl. Use source "spoken" with the answer you distilled from the transcript when the ' +
        'user answered out loud, "typed" when you are copying a typed answer, and "skipped" (answer may be ' +
        'empty) when the user moved on without answering. Unknown question_id returns {error}.',
      inputSchema: {
        type: "object",
        properties: {
          question_id: { type: "string", description: "The id returned by show_question." },
          answer: { type: "string", description: "The answer, in Japanese. May be empty for skipped." },
          source: {
            type: "string",
            enum: ["spoken", "typed", "skipped"],
            description: "How the answer was given.",
          },
        },
        required: ["question_id", "answer", "source"],
      },
      execute: (args) => {
        const id = str(args, "question_id");
        const answer = str(args, "answer") ?? "";
        const source = str(args, "source");
        if (!id) return { error: "question_id is required" };
        if (source !== "spoken" && source !== "typed" && source !== "skipped") {
          return { error: 'source must be "spoken", "typed" or "skipped"' };
        }
        return session.resolveQuestion(id, answer, source as AnswerSource);
      },
    },
    {
      name: "set_outline",
      description:
        "Replace the outline panel with the given Markdown and switch the page to the outline tab. Use it " +
        "for the structured summary of the talk (headings + bullets), reordered into the shape that works " +
        "best as a presentation. It is saved to outline.md in the user's project directory. Every write is " +
        "versioned (history/outline/, the newest 30 generations) and any of them can be brought back with " +
        "restore_history, so overwriting is safe — rewrite freely instead of asking first.",
      inputSchema: {
        type: "object",
        properties: { markdown: { type: "string", description: "The outline as Markdown." } },
        required: ["markdown"],
      },
      execute: (args) => {
        const markdown = str(args, "markdown");
        if (markdown === null) return { error: "markdown is required" };
        return session.setOutline(markdown);
      },
    },
    {
      name: "set_slides",
      description:
        "Replace the slide deck with the given Marp Markdown, render it in the page and switch to the " +
        'slides tab. Start with the front matter "---\\nmarp: true\\n---"; separate slides with a line that ' +
        'is exactly "---". Lines like "[イラスト: 何を描くか]" ("[illustration: what to draw]"; 図 / 画像 / ' +
        '写真 and the English illustration / image / figure work too) become dashed placeholder boxes on ' +
        "the slide, so use them where an illustration should go; do not embed images. " +
        "The deck is saved to slides.md in the user's project directory and can be downloaded as Markdown " +
        "or HTML, or printed to PDF from the page. Every write is versioned (history/slides/, the newest 30 " +
        "generations) and any of them can be brought back with restore_history, so overwriting is safe — " +
        "rewrite the whole deck freely. Returns {ok, slide_count}.",
      inputSchema: {
        type: "object",
        properties: { markdown: { type: "string", description: "The full slide deck as Marp Markdown." } },
        required: ["markdown"],
      },
      execute: (args) => {
        const markdown = str(args, "markdown");
        if (markdown === null) return { error: "markdown is required" };
        const result = session.setSlides(markdown);
        if ("error" in result) return result;
        return { ok: true, slide_count: countSlides(markdown) };
      },
    },
    {
      name: "end_session",
      description:
        "Stop recording and finish the session, exactly like the user pressing the 録音終了 / Stop recording button. Call it when " +
        "the user says out loud that they are done (そろそろ終わり, 以上です, 終了して — \"about time to wrap " +
        "up\", \"that is all\", \"please finish\", etc.) — the page never matches phrases itself; you decide " +
        "from the transcript. Remaining utterances are transcribed and " +
        "the audio is saved before the session is marked ended, so the next wait_for_event returns \"ended\".",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        if (!session.recording) return { error: "not recording" };
        await session.end();
        return { ok: true };
      },
    },
    {
      name: "add_glossary",
      description:
        "Add proper nouns / technical terms to the glossary that biases speech recognition (whisper prompt). " +
        "Use it as soon as you infer from context what a garbled word really is (e.g. the transcript says " +
        "お待ち東京 but the talk is clearly about Omarchy Tokyo): later utterances will then be transcribed " +
        "with the right spelling. Words already present are ignored. Returns the full glossary.",
      inputSchema: {
        type: "object",
        properties: {
          words: {
            type: "array",
            items: { type: "string" },
            description: "Terms to add, in the spelling you want to see in the transcript.",
          },
        },
        required: ["words"],
      },
      execute: (args) => {
        const raw = (args as { words?: unknown }).words;
        const words = Array.isArray(raw) ? raw.map((w) => String(w).trim()).filter(Boolean) : [];
        if (words.length === 0) return { error: "words is required" };
        return { ok: true, glossary: session.addGlossary(words) };
      },
    },
    {
      name: "correct_segments",
      description:
        "Fix garbled speech recognition in segments that were already transcribed. Give the segment's t0 " +
        "(as you received it, in seconds) and the text as it should read; the page keeps the raw ASR output " +
        "in text and stores yours in corrected, shows corrected in the 文字起こし / Transcript panel with a " +
        "修正 / fixed badge (the original stays visible as a tooltip) and saves it to transcript.jsonl. " +
        "An empty text clears a " +
        "previous correction. Use it for proper nouns and mis-heard words once the context makes the right " +
        "reading obvious — and call add_glossary too, so later utterances come out right in the first " +
        "place. t0 is matched after rounding to 0.1 s; t0 values that match no segment come back in " +
        "unmatched. Returns {ok, updated, unmatched}.",
      inputSchema: {
        type: "object",
        properties: {
          corrections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                t0: { type: "number", description: "The segment's t0, in seconds from recording start." },
                text: { type: "string", description: "The corrected text. Empty clears the correction." },
              },
              required: ["t0", "text"],
            },
            description: "One entry per segment to correct.",
          },
        },
        required: ["corrections"],
      },
      execute: (args) => {
        const raw = (args as { corrections?: unknown }).corrections;
        if (!Array.isArray(raw)) return { error: "corrections must be an array of {t0, text}" };
        const corrections: SegmentCorrection[] = [];
        for (const item of raw) {
          if (typeof item !== "object" || item === null) continue;
          const row = item as Record<string, unknown>;
          if (typeof row.t0 !== "number" || !isFinite(row.t0)) continue;
          corrections.push({ t0: row.t0, text: typeof row.text === "string" ? row.text : "" });
        }
        if (corrections.length === 0) return { error: "corrections must contain at least one {t0, text}" };
        return session.correctSegments(corrections);
      },
    },
    {
      name: "set_notes",
      description:
        "Replace the メモ / Memo panel (notes.md in the user's project) with the given Markdown. The panel is a " +
        "plain textarea the user can edit too, so it is a shared scratchpad: put things there that should " +
        "stay in front of the user while they practise — timings, phrases to remember, what to cut. " +
        "Overwrites whatever is there, so read notes from get_transcript first if you want to keep it. " +
        "Every write is versioned (history/notes/, the newest 30 generations — the user's own edits are " +
        "kept there too) and any of them can be brought back with restore_history, so overwriting is safe. " +
        "Returns {ok, notes}.",
      inputSchema: {
        type: "object",
        properties: { markdown: { type: "string", description: "The whole memo, as Markdown." } },
        required: ["markdown"],
      },
      execute: (args) => {
        const markdown = str(args, "markdown");
        if (markdown === null) return { error: "markdown is required" };
        session.setNotes(markdown);
        return { ok: true, notes: session.notesText };
      },
    },
    {
      name: "append_note",
      description:
        "Append one line to the メモ / Memo panel without touching what is already there. While the practice " +
        'timer runs the line is prefixed with the timer position ("[03:12] …"), so this is the natural way ' +
        "to log feedback during a rehearsal (too fast here, this part ran long, good phrasing). " +
        "Returns {ok, notes}.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "The line to append, in Japanese." } },
        required: ["text"],
      },
      execute: (args) => {
        const text = str(args, "text");
        if (!text || !text.trim()) return { error: "text is required" };
        return { ok: true, notes: session.appendNote(text.trim()) };
      },
    },
    {
      name: "start_timer",
      description:
        "Reset the practice timer to 0 and start it. It is independent of recording — use it to time a " +
        "rehearsal of the deck, alone or while recording. The page shows it as a large mm:ss readout and " +
        "the user can also drive it with the タイマー開始 / 停止 / リセット (Start timer / Stop / Reset) " +
        "buttons. Logs a timer_started event. Returns {ok}.",
      inputSchema: { type: "object", properties: {} },
      execute: () => session.startTimer(),
    },
    {
      name: "stop_timer",
      description:
        "Stop the practice timer and report how long the run took. Logs a timer_stopped event with the " +
        "elapsed seconds, so the rehearsal times stay in events.jsonl. Compare elapsed_s with the time " +
        "budget of the talk and say so in your feedback. Returns {ok, elapsed_s}, or {error} when the " +
        "timer is not running.",
      inputSchema: { type: "object", properties: {} },
      execute: () => session.stopTimer(),
    },
    {
      name: "reset_timer",
      description: "Set the practice timer back to 0 and leave it stopped. Returns {ok}.",
      inputSchema: { type: "object", properties: {} },
      execute: () => session.resetTimer(),
    },
    {
      name: "list_history",
      description:
        "List the saved generations of one document. Every write through set_slides / set_outline / " +
        "set_notes / append_note is kept as a file in the user's project directory " +
        "(history/<doc>/<timestamp>.md), and so is the memo the user types themselves; the newest 30 are " +
        'kept. Returns {doc, generations} newest first, each {file, at (ISO), source ("agent" — you wrote ' +
        'it, "user" — the user typed it, "restore" — it came back from an older generation), chars, note ' +
        "(for a restore: the file it came from)}. Use it before restore_history, and to see whether the " +
        "user changed the memo under you.",
      inputSchema: {
        type: "object",
        properties: {
          doc: {
            type: "string",
            enum: ["slides", "outline", "notes"],
            description: "Which document's history to list.",
          },
        },
        required: ["doc"],
      },
      annotations: { readOnlyHint: true },
      execute: async (args) => {
        const doc = historyDoc(str(args, "doc"));
        if (!doc) return { error: 'doc must be "slides", "outline" or "notes"' };
        if (!session.projectOpen) return { error: "no project is open yet" };
        return { doc, generations: await session.listHistory(doc) };
      },
    },
    {
      name: "restore_history",
      description:
        "Make one saved generation the current document again: it is written back through the normal " +
        "path, so the page re-renders it, it is saved to slides.md / outline.md / notes.md, and the state " +
        "it replaced is itself recorded as a generation first — nothing is lost, and a restore can be " +
        "undone by restoring the generation it replaced. Take file from list_history. Returns {ok, doc, " +
        "at} (the timestamp of the restored generation), or {error} for an unknown file.",
      inputSchema: {
        type: "object",
        properties: {
          doc: {
            type: "string",
            enum: ["slides", "outline", "notes"],
            description: "Which document to restore.",
          },
          file: {
            type: "string",
            description: 'The generation\'s "file" as returned by list_history.',
          },
        },
        required: ["doc", "file"],
      },
      execute: (args) => {
        const doc = historyDoc(str(args, "doc"));
        if (!doc) return { error: 'doc must be "slides", "outline" or "notes"' };
        const file = str(args, "file");
        if (!file) return { error: "file is required" };
        return session.restoreHistory(doc, file);
      },
    },
    {
      name: "set_language",
      description:
        "Switch the language the page transcribes speech in. Whisper is told which language to expect, so a " +
        "mismatch garbles everything — call this as soon as you notice the user is speaking the other " +
        'language ("ja" for Japanese, "en" for English). It takes effect on the next utterance (no restart, ' +
        "the model stays loaded) and is remembered in the project directory (project.json), so reopening the " +
        "project keeps it. Returns {ok, language}.",
      inputSchema: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["ja", "en"],
            description: "The spoken language from now on.",
          },
        },
        required: ["language"],
      },
      execute: (args) => {
        const language = str(args, "language");
        if (language !== "ja" && language !== "en") return { error: 'language must be "ja" or "en"' };
        return session.setLanguage(language as SpeechLanguage);
      },
    },
    {
      name: "set_asr_model",
      description:
        "Switch how the page turns speech into text. Use it when get_status shows asr_model null (no WebGPU: " +
        "the user must choose and Start stays disabled until then), when the user says transcription is " +
        "lagging behind or their PC / GPU is too weak, or when they ask for better accuracy. " +
        '"turbo" is whisper-large-v3-turbo in the browser (accurate, ~1.5 GB, needs a real GPU); ' +
        '"small" is whisper-small (~0.4 GB, runs without a GPU but is slow and makes many mistakes); ' +
        '"webspeech-local" is the browser\'s own recognizer running on the device (Chrome 139+, audio never ' +
        'leaves the machine, the glossary biases it); "webspeech-cloud" is the browser\'s own recognizer via its ' +
        "vendor's servers (Chrome sends the audio to Google, Edge to Microsoft; no glossary bias). The browser " +
        "recognizers are free and light but do not work in Brave, Firefox or plain Chromium, and their " +
        "timestamps are approximate. Ask before choosing a cloud variant — it sends the talk elsewhere. " +
        "The new model is loaded right away (the status line shows the progress); switching between whisper " +
        "models while recording is fine, switching between whisper and the browser recognizer takes effect " +
        "at the next Start. The choice is saved in the project (project.json) and becomes the default for " +
        "new projects on this device. Returns {ok, model}.",
      inputSchema: {
        type: "object",
        properties: {
          model: {
            type: "string",
            enum: [...ASR_MODELS],
            description: "The recognizer to transcribe with from now on.",
          },
        },
        required: ["model"],
      },
      execute: (args) => {
        const model = str(args, "model");
        if (!isAsrModel(model)) return { error: `model must be one of ${ASR_MODELS.map((m) => `"${m}"`).join(", ")}` };
        return session.setAsrModel(model);
      },
    },
    {
      name: "get_status",
      description:
        "Cheap status check that works before recording starts: returns project_open (the user must pick a " +
        "project directory before anything else), project_name, recording, ended, total_segments, " +
        'elapsed_s, pending_question, pending_question_id, asr_backend ("webgpu", "wasm", "browser-local", "browser-cloud" or null while the ' +
        "model is still loading), asr_status (the status line for the speech model), asr_model (the recognizer " +
        'in use — "turbo", "small", "webspeech-local", "webspeech-cloud", or null when the user still has to choose; ' +
        'see set_asr_model), language (the speech language, "ja" or ' +
        '"en"), timer_running and timer_s (the practice timer, which runs independently of recording).',
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => session.getStatus(),
    },
  ];
}

export interface RegisterResult {
  ok: boolean;
  registered: number;
  total: number;
}

/** Localized text for a failed / partial registration (a full one is not worth a status line). */
export function registerProblem(result: RegisterResult): string | null {
  if (result.ok) return null;
  if (result.total === 0 || result.registered === 0) return t("mcp.unavailable");
  return t("mcp.partial", { n: result.registered, total: result.total });
}

/** Register every tool with the WebMCP polyfill / native implementation. */
export async function registerTools(session: Session): Promise<RegisterResult> {
  const mc = modelContext();
  if (!mc) {
    return { ok: false, registered: 0, total: 0 };
  }
  const tools = buildTools(session);
  let registered = 0;
  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = (args: Record<string, unknown>) => {
      session.touchAgent();
      return execute(args);
    };
    try {
      await mc.registerTool(tool);
      registered += 1;
    } catch (e) {
      console.warn("registerTool failed:", tool.name, e);
    }
  }
  if (registered === tools.length) console.info(`[webmcp] registered ${registered} tools`);
  return { ok: registered === tools.length, registered, total: tools.length };
}
