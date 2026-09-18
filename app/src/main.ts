/** UI wiring: DOM ⇄ session ⇄ WebMCP tools. */
import { playChime } from "./ui/chime";
import "./style.css";
import { createSession, mmss } from "./session";
import type { HistoryDoc, HistoryEntry, HistorySource, SpeechLanguage } from "./session";
import { isAsrModel } from "./asr/types";
import { clearModelCache, modelCacheBytes } from "./asr/model-cache";
import { applyI18n, getLocale, localeTag, onLocaleChange, setLocale, t } from "./i18n";
import type { Locale, MessageKey } from "./i18n";
import { registerProblem, registerTools } from "./mcp/tools";
import { countSlides, deckDocument, downloadText, printDeck } from "./slides/marp";
import { renderMarkdown } from "./ui/markdown";
import { isToolError, type Question, type Segment } from "./types";

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element: #${id}`);
  return el as T;
};

const ui = {
  start: byId<HTMLElement>("start"),
  startProblem: byId<HTMLParagraphElement>("start-problem"),
  startUiLanguage: byId<HTMLSelectElement>("start-ui-language"),
  appHeader: byId<HTMLElement>("app-header"),
  appMain: byId<HTMLElement>("app-main"),
  projectName: byId<HTMLSpanElement>("project-name"),
  settings: byId<HTMLDialogElement>("settings"),
  settingsProjectName: byId<HTMLSpanElement>("settings-project-name"),
  btnSettings: byId<HTMLButtonElement>("btn-settings"),
  status: byId<HTMLSpanElement>("status"),
  speakDot: byId<HTMLSpanElement>("speak-dot"),
  agentDot: byId<HTMLSpanElement>("agent-dot"),
  tutorial: byId<HTMLElement>("tutorial"),
  tutorialText: byId<HTMLElement>("tutorial-text"),
  tutorialSteps: byId<HTMLElement>("tutorial-steps"),
  tutorialHint: byId<HTMLElement>("tutorial-hint"),
  tutorialClose: byId<HTMLButtonElement>("tutorial-close"),
  agentPromptCdm: byId<HTMLElement>("agent-prompt-cdm"),
  agentLabel: byId<HTMLSpanElement>("agent-label"),
  speechLanguage: byId<HTMLSelectElement>("speech-language"),
  asrModel: byId<HTMLSelectElement>("asr-model"),
  modelCacheSize: byId<HTMLSpanElement>("model-cache-size"),
  btnClearCache: byId<HTMLButtonElement>("btn-clear-cache"),
  uiLanguage: byId<HTMLSelectElement>("ui-language"),
  btnOpen: byId<HTMLButtonElement>("btn-open"),
  btnOpenLast: byId<HTMLButtonElement>("btn-open-last"),
  btnSwitch: byId<HTMLButtonElement>("btn-switch"),
  btnStart: byId<HTMLButtonElement>("btn-start"),
  btnEnd: byId<HTMLButtonElement>("btn-end"),
  timer: byId<HTMLSpanElement>("timer"),
  btnTimerStart: byId<HTMLButtonElement>("btn-timer-start"),
  btnTimerStop: byId<HTMLButtonElement>("btn-timer-stop"),
  btnTimerReset: byId<HTMLButtonElement>("btn-timer-reset"),
  glossary: byId<HTMLTextAreaElement>("glossary"),
  notes: byId<HTMLTextAreaElement>("notes"),
  transcriptBody: byId<HTMLDivElement>("transcript-body"),
  transcriptEmpty: byId<HTMLParagraphElement>("transcript-empty"),
  segments: byId<HTMLUListElement>("segments"),
  questionCard: byId<HTMLDivElement>("question-card"),
  history: byId<HTMLDetailsElement>("history"),
  historyCount: byId<HTMLSpanElement>("history-count"),
  historyList: byId<HTMLDivElement>("history-list"),
  tabOutline: byId<HTMLButtonElement>("tab-outline"),
  tabSlides: byId<HTMLButtonElement>("tab-slides"),
  docHistory: byId<HTMLSelectElement>("doc-history"),
  notesHistory: byId<HTMLSelectElement>("notes-history"),
  paneOutline: byId<HTMLDivElement>("pane-outline"),
  paneSlides: byId<HTMLDivElement>("pane-slides"),
  slidesTools: byId<HTMLDivElement>("slides-tools"),
  slidesEmpty: byId<HTMLParagraphElement>("slides-empty"),
  slidesFrame: byId<HTMLIFrameElement>("slides-frame"),
  slideCount: byId<HTMLSpanElement>("slide-count"),
  btnDownloadMd: byId<HTMLButtonElement>("btn-download-md"),
  btnDownloadHtml: byId<HTMLButtonElement>("btn-download-html"),
  btnPrint: byId<HTMLButtonElement>("btn-print"),
};

const session = createSession();

// ---------------------------------------------------------------- transcript
let renderedSegments = 0;
let renderedRevision = -1;

function appendSegmentRow(seg: Segment): void {
  const li = document.createElement("li");
  const stamp = document.createElement("span");
  stamp.className = "seg-t";
  stamp.textContent = mmss(seg.t0);
  const body = document.createElement("span");
  body.className = "seg-text";
  body.textContent = seg.corrected ?? seg.text;
  if (seg.corrected !== undefined) {
    li.className = "corrected";
    // Show the original transcription on hover
    li.title = t("seg.original", { text: seg.text });
    const badge = document.createElement("span");
    badge.className = "seg-badge";
    badge.textContent = t("seg.badge");
    body.appendChild(badge);
  }
  li.append(stamp, body);
  ui.segments.appendChild(li);
}

function renderTranscript(): void {
  const segments = session.segments;
  // Redraw everything when existing lines were rewritten (correct_segments)
  if (segments.length < renderedSegments || session.transcriptRevision !== renderedRevision) {
    ui.segments.textContent = "";
    renderedSegments = 0;
    renderedRevision = session.transcriptRevision;
  }
  for (let i = renderedSegments; i < segments.length; i++) appendSegmentRow(segments[i]);
  renderedSegments = segments.length;
  ui.transcriptEmpty.hidden = segments.length > 0;
  ui.transcriptBody.scrollTop = ui.transcriptBody.scrollHeight;
}

// ---------------------------------------------------------------- questions
const SOURCE_KEY: Record<string, MessageKey> = {
  spoken: "src.spoken",
  typed: "src.typed",
  skipped: "src.skipped",
};

const sourceLabel = (source: string): string =>
  source in SOURCE_KEY ? t(SOURCE_KEY[source]) : source;

function renderQuestions(): void {
  const pendingQuestion = session.pendingQuestion;
  if (pendingQuestion) {
    ui.questionCard.classList.remove("idle");
    ui.questionCard.textContent = pendingQuestion.text;
  } else {
    ui.questionCard.classList.add("idle");
    ui.questionCard.textContent = session.questions.length ? t("q.waiting") : t("q.none");
  }

  const past = session.questions.filter((q) => q.id !== pendingQuestion?.id);
  ui.historyCount.textContent = String(past.length);
  ui.historyList.textContent = "";
  if (!past.length) {
    const p = document.createElement("p");
    p.className = "hist-none";
    p.textContent = t("q.history.none");
    ui.historyList.appendChild(p);
    return;
  }
  for (const q of past) ui.historyList.appendChild(historyItem(q));
}

function historyItem(q: Question): HTMLElement {
  const item = document.createElement("div");
  item.className = "hist-item";

  const head = document.createElement("div");
  head.className = "hist-q";
  const stamp = document.createElement("span");
  stamp.className = "hist-t";
  stamp.textContent = `${mmss(q.t)} `;
  head.appendChild(stamp);
  head.appendChild(document.createTextNode(q.text || t("q.unprompted")));
  item.appendChild(head);

  const a = document.createElement("div");
  if (q.answer) {
    a.className = "hist-a";
    a.textContent = q.answer;
    if (q.source) {
      const src = document.createElement("span");
      src.className = "hist-src";
      src.textContent = `[${sourceLabel(q.source)}]`;
      a.appendChild(src);
    }
  } else {
    a.className = "hist-a none";
    a.textContent = q.source === "skipped" ? t("src.skipped") : t("q.unanswered");
  }
  item.appendChild(a);
  return item;
}

// ---------------------------------------------------------------- history dropdowns
const HISTORY_SOURCE_KEY: Record<HistorySource, MessageKey> = {
  agent: "hist.src.agent",
  user: "hist.src.user",
  restore: "hist.src.restore",
};

/** "13:05:22 AI 2,310字" / "13:05:22 AI 2,310 chars" */
function historyLabel(entry: HistoryEntry): string {
  const d = new Date(entry.at);
  const time = isNaN(d.getTime()) ? entry.at : d.toLocaleTimeString(localeTag(), { hour12: false });
  const key = HISTORY_SOURCE_KEY[entry.source];
  return t("hist.label", {
    time,
    source: key ? t(key) : entry.source,
    chars: entry.chars.toLocaleString(localeTag()),
  });
}

/** Newest refresh wins, so a slow listing cannot overwrite a newer one. */
const historySeq = new Map<string, number>();

async function refreshHistory(sel: HTMLSelectElement, doc: HistoryDoc): Promise<void> {
  const seq = (historySeq.get(sel.id) ?? 0) + 1;
  historySeq.set(sel.id, seq);
  let entries: HistoryEntry[] = [];
  if (session.projectOpen) {
    try {
      entries = await session.listHistory(doc);
    } catch (e) {
      console.warn("listHistory failed", doc, e);
    }
  }
  if (historySeq.get(sel.id) !== seq) return;

  sel.textContent = "";
  const head = document.createElement("option");
  head.value = "";
  head.textContent = t("history.head", { count: entries.length });
  sel.appendChild(head);
  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.file;
    opt.textContent = historyLabel(entry);
    opt.title = entry.note ? `${entry.file} — ${entry.note}` : entry.file;
    sel.appendChild(opt);
  }
  sel.value = "";
  sel.disabled = entries.length === 0;
}

function refreshAllHistory(): void {
  void refreshHistory(ui.docHistory, activeDoc);
  void refreshHistory(ui.notesHistory, "notes");
}

function restoreFrom(sel: HTMLSelectElement, doc: HistoryDoc): void {
  const file = sel.value;
  sel.value = ""; // put the selection straight back to the placeholder
  if (!file) return;
  void session.restoreHistory(doc, file).then((result) => {
    if (isToolError(result)) showStatus(() => t("hist.restoreFailed", { error: result.error }), true);
  });
}

// ---------------------------------------------------------------- outline / slides
/** Which document the tab-bar history dropdown is showing. */
let activeDoc: HistoryDoc = "outline";

function switchTab(which: "outline" | "slides"): void {
  const slides = which === "slides";
  ui.tabOutline.setAttribute("aria-selected", String(!slides));
  ui.tabSlides.setAttribute("aria-selected", String(slides));
  ui.paneOutline.hidden = slides;
  ui.paneSlides.hidden = !slides;
  ui.slidesTools.hidden = !(slides && session.slidesMd.trim().length > 0);
  if (activeDoc !== which) {
    activeDoc = which;
    void refreshHistory(ui.docHistory, activeDoc);
  }
}

function renderOutline(): void {
  renderMarkdown(ui.paneOutline, session.outlineMd, t("outline.empty"));
}

function renderSlides(): void {
  const md = session.slidesMd;
  const has = md.trim().length > 0;
  ui.slidesEmpty.hidden = has;
  ui.slidesFrame.hidden = !has;
  if (!has) {
    ui.slidesFrame.removeAttribute("srcdoc");
    ui.slideCount.textContent = "";
    ui.slidesTools.hidden = true;
    return;
  }
  ui.slidesFrame.srcdoc = deckDocument(md, session.projectName ?? "slides");
  ui.slideCount.textContent = t("slides.count", { n: countSlides(md) });
  ui.slidesTools.hidden = ui.paneSlides.hidden;
}

// ---------------------------------------------------------------- header state
function renderProject(): void {
  const name = session.projectName ?? t("hdr.project.none");
  ui.projectName.textContent = name;
  ui.settingsProjectName.textContent = name;
  ui.glossary.value = session.glossaryText;
  ui.notes.value = session.notesText;
}

// ---------------------------------------------------------------- practice timer
let timerTick: number | null = null;

function paintTimer(): void {
  ui.timer.textContent = mmss(session.timerSeconds);
}

function renderTimer(): void {
  paintTimer();
  ui.timer.classList.toggle("running", session.timerRunning);
  ui.btnTimerStop.disabled = !session.timerRunning;
  if (session.timerRunning) {
    if (timerTick === null) timerTick = window.setInterval(paintTimer, 250);
  } else if (timerTick !== null) {
    clearInterval(timerTick);
    timerTick = null;
  }
}

/**
 * A status line the page itself owns (a failed restore, a WebMCP problem). It is kept as a
 * closure so a UI language switch re-renders it, and the next session status replaces it.
 */
let statusOverride: { text: () => string; error: boolean } | null = null;

function showStatus(text: () => string, error: boolean): void {
  statusOverride = { text, error };
  renderStatus();
}

function statusNow(): { text: string; error: boolean } {
  return statusOverride ? { text: statusOverride.text(), error: statusOverride.error } : session.status;
}

function renderStatus(): void {
  const view = statusNow();
  ui.status.textContent = view.text;
  ui.status.classList.toggle("err", view.error);
  renderStartProblem(view);
}

function renderState(): void {
  // Not before the speech model is usable; after a failed load the button retries the load.
  const canRecord =
    session.projectOpen &&
    !session.recording &&
    !session.finishing &&
    session.asrReadiness !== "loading" &&
    session.asrReadiness !== "unset";
  ui.btnStart.disabled = !canRecord;
  ui.btnStart.textContent = session.ended ? t("btn.resume") : t("btn.start");
  ui.btnEnd.disabled = !session.recording || session.finishing;
  ui.btnSwitch.disabled = session.recording || session.finishing;
}

/** Start screen until a project is open, the app afterwards. */
function renderShell(): void {
  const open = session.projectOpen;
  ui.start.hidden = open;
  ui.appHeader.hidden = !open;
  ui.appMain.hidden = !open;
  if (!open) ui.tutorial.hidden = true;
}

/**
 * A problem the user must see before any project exists (no File System Access API,
 * WebMCP tools missing). Kept as a closure so it re-localizes.
 */
let bootProblem: (() => string) | null = null;

function setBootProblem(text: () => string): void {
  bootProblem = text;
  showStatus(text, true); // also on the header when it is visible (renderStartProblem runs as well)
}

/** The start screen has no status line, so errors (bad folder, no WebMCP) are shown on it. */
function renderStartProblem(view = statusNow()): void {
  const text = bootProblem ? bootProblem() : view.error ? view.text : "";
  ui.startProblem.textContent = text;
  ui.startProblem.hidden = text === "";
}

function renderSpeaking(): void {
  ui.speakDot.classList.toggle("on", session.speaking);
}

/** Coarse "N minutes ago" so the label does not flicker every second. */
function sinceLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return t("since.lt1m");
  return t("since.min", { n: Math.floor(s / 60) });
}

function renderAgent(): void {
  const listening = session.agentListening;
  const last = session.lastAgentCallAt;
  ui.agentDot.classList.toggle("on", listening);
  if (listening) ui.agentLabel.textContent = t("agent.waiting");
  else if (last === null) ui.agentLabel.textContent = t("agent.idle");
  else ui.agentLabel.textContent = t("agent.away", { since: sinceLabel(Date.now() - last) });
}
window.setInterval(renderAgent, 1000);

// Tutorial: recording has run for a while and no agent has ever called a tool.
const TUTORIAL_AFTER_MS = 20_000; // never connected
const AWAY_AFTER_MS = 90_000; // connected before, but silent since
let recordingSince: number | null = null;
let tutorialDismissedAt: number | null = null; // Date.now() when × was pressed

/** "<strong>lead-in</strong> rest of the sentence" — built as nodes, never as HTML. */
function setTutorialText(strong: MessageKey, rest: MessageKey, params?: Record<string, string | number>): void {
  ui.tutorialText.textContent = "";
  const b = document.createElement("strong");
  b.textContent = t(strong);
  ui.tutorialText.append(b, ` ${t(rest, params)}`);
}
function renderTutorial(): void {
  if (session.recording) recordingSince ??= Date.now();
  else recordingSince = null;
  const last = session.lastAgentCallAt;
  let mode: "setup" | "away" | null = null;
  if (recordingSince !== null && !session.agentListening) {
    if (last === null && Date.now() - recordingSince > TUTORIAL_AFTER_MS) mode = "setup";
    else if (last !== null && Date.now() - last > AWAY_AFTER_MS) mode = "away";
  }
  // × hides the panel until the situation changes (a later call resets it); "away" re-arms after each call.
  if (mode !== null && tutorialDismissedAt !== null && (last === null || tutorialDismissedAt > last)) mode = null;
  ui.tutorial.hidden = mode === null;
  if (mode === "setup") {
    setTutorialText("tut.setup.strong", "tut.setup.rest");
    ui.tutorialSteps.hidden = false;
    ui.tutorialHint.textContent = t("tut.setup.hint");
  } else if (mode === "away") {
    setTutorialText("tut.away.strong", "tut.away.rest", { since: sinceLabel(Date.now() - (last ?? 0)) });
    ui.tutorialSteps.hidden = true;
    ui.tutorialHint.textContent = t("tut.away.hint");
  }
}
window.setInterval(renderTutorial, 1000);
for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  button.addEventListener("click", () => {
    const text = document.getElementById(button.dataset.copy ?? "")?.textContent ?? "";
    void navigator.clipboard.writeText(text).then(
      () => (button.textContent = t("copy.done")),
      () => (button.textContent = t("copy.fail")),
    );
  });
}
ui.tutorialClose.addEventListener("click", () => {
  tutorialDismissedAt = Date.now();
  renderTutorial();
});

// ---------------------------------------------------------------- language
/** Name of the directory remembered from last time, shown on the "last folder" button. */
let lastName: string | null = null;

function renderOpenLast(): void {
  ui.btnOpenLast.hidden = lastName === null;
  ui.btnOpenLast.textContent = lastName === null ? t("btn.openLast") : t("btn.openLast.named", { name: lastName });
}

function renderLanguage(): void {
  ui.speechLanguage.value = session.language;
  ui.uiLanguage.value = getLocale();
  ui.startUiLanguage.value = getLocale();
}

function renderAsrModel(): void {
  ui.asrModel.value = session.asrModel ?? "";
}

const speechLanguageOf = (value: string): SpeechLanguage => (value === "en" ? "en" : "ja");
const localeOf = (value: string): Locale => (value === "en" ? "en" : "ja");

ui.speechLanguage.addEventListener("change", () => {
  session.setLanguage(speechLanguageOf(ui.speechLanguage.value));
});
ui.asrModel.addEventListener("change", () => {
  const value = ui.asrModel.value;
  if (isAsrModel(value)) session.setAsrModel(value);
});
ui.uiLanguage.addEventListener("change", () => setLocale(localeOf(ui.uiLanguage.value)));
ui.startUiLanguage.addEventListener("change", () => setLocale(localeOf(ui.startUiLanguage.value)));

/** Redraw everything in the current UI language (also the boot render). */
function renderAll(): void {
  applyI18n();
  // chrome-devtools-mcp opens its own Chrome, so that prompt has to carry this page's address
  ui.agentPromptCdm.textContent = t("tut.agentPromptCdm", { url: location.origin + location.pathname });
  renderShell();
  renderProject();
  renderStatus();
  renderState();
  renderedRevision = -1; // redraw the "corrected" badges and the like as well
  renderTranscript();
  renderQuestions();
  renderOutline();
  renderSlides();
  renderTimer();
  renderAgent();
  renderTutorial();
  renderLanguage();
  renderAsrModel();
  renderOpenLast();
  refreshAllHistory();
}

onLocaleChange(renderAll);

// ---------------------------------------------------------------- events
session.on("transcript", renderTranscript);
session.on("language", renderLanguage);
session.on("asrModel", renderAsrModel);
let lastQuestionId: string | null = null;
session.on("questions", () => {
  renderQuestions();
  const q = session.pendingQuestion;
  if (q && q.id !== lastQuestionId) {
    lastQuestionId = q.id;
    playChime();
  }
});
session.on("status", () => {
  statusOverride = null; // the session state takes precedence over a page-side message
  renderStatus();
});
session.on("speaking", renderSpeaking);
session.on("agent", () => {
  renderAgent();
  renderTutorial();
});
session.on("state", renderState);
session.on("glossary", () => {
  if (ui.glossary.value !== session.glossaryText) ui.glossary.value = session.glossaryText;
});
session.on("notes", () => {
  if (ui.notes.value !== session.notesText) ui.notes.value = session.notesText;
});
session.on("timer", renderTimer);
session.on("history", refreshAllHistory);
session.on("project", () => {
  renderShell();
  renderProject();
  renderState();
  renderTranscript();
  renderQuestions();
  renderOutline();
  renderSlides();
  switchTab(session.slidesMd.trim() ? "slides" : "outline");
  refreshAllHistory();
});
session.on("outline", () => {
  renderOutline();
  switchTab("outline");
});
session.on("slides", () => {
  renderSlides();
  switchTab("slides");
});

// ---------------------------------------------------------------- actions
/** Load the speech model; without WebGPU nothing is chosen yet, so open the settings for the choice. */
function preloadAsr(): void {
  session.preloadAsr();
  if (session.asrReadiness === "unset" && !ui.settings.open) ui.settings.showModal();
}

function openProject(): void {
  void session.openProject().then(() => {
    if (session.projectOpen) preloadAsr();
  });
}

ui.btnOpen.addEventListener("click", openProject);
ui.btnSettings.addEventListener("click", () => ui.settings.showModal());

// ---------------------------------------------------------------- model cache
async function renderModelCache(): Promise<void> {
  const bytes = await modelCacheBytes();
  ui.modelCacheSize.textContent =
    bytes === null ? t("modelCache.unknown") : bytes === 0 ? t("modelCache.none") : t("modelCache.size", { mb: Math.round(bytes / 1e6) });
  // Not while a download is in progress (deleting under it would break the load)
  ui.btnClearCache.disabled = bytes === null || bytes === 0 || session.asrReadiness === "loading";
}
ui.settings.addEventListener("toggle", () => {
  if (ui.settings.open) void renderModelCache();
});
ui.btnClearCache.addEventListener("click", () => {
  ui.btnClearCache.disabled = true;
  void clearModelCache()
    .then(() => showStatus(() => t("status.cacheCleared"), false))
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      showStatus(() => t("status.cacheClearFailed", { message }), true);
    })
    .finally(() => void renderModelCache());
});
// The header "open project" button is for switching projects (reopening resets the session)
ui.btnSwitch.addEventListener("click", openProject);

ui.btnOpenLast.addEventListener("click", () => {
  void session.openLastProject().then(() => {
    if (session.projectOpen) preloadAsr();
  });
});

ui.btnStart.addEventListener("click", () => {
  ui.btnStart.disabled = true;
  void session.start().finally(renderState);
});

ui.btnEnd.addEventListener("click", () => {
  ui.btnEnd.disabled = true;
  void session.end().finally(renderState);
});

// Proper nouns are managed only by the AI (add_glossary); the pane just displays them.
// The memo is written only by the AI (set_notes / append_note); the pane just displays it.

ui.docHistory.addEventListener("change", () => restoreFrom(ui.docHistory, activeDoc));
ui.notesHistory.addEventListener("change", () => restoreFrom(ui.notesHistory, "notes"));

ui.btnTimerStart.addEventListener("click", () => {
  session.startTimer();
});
ui.btnTimerStop.addEventListener("click", () => {
  session.stopTimer();
});
ui.btnTimerReset.addEventListener("click", () => {
  session.resetTimer();
});

ui.tabOutline.addEventListener("click", () => switchTab("outline"));
ui.tabSlides.addEventListener("click", () => switchTab("slides"));

ui.btnDownloadMd.addEventListener("click", () => {
  if (session.slidesMd) downloadText("slides.md", session.slidesMd, "text/markdown");
});
ui.btnDownloadHtml.addEventListener("click", () => {
  if (!session.slidesMd) return;
  downloadText("slides.html", deckDocument(session.slidesMd, session.projectName ?? "slides"), "text/html");
});
ui.btnPrint.addEventListener("click", () => {
  if (!session.slidesMd) return;
  const problem = printDeck(session.slidesMd, session.projectName ?? "slides");
  if (problem) showStatus(() => problem, true);
});

window.addEventListener("beforeunload", (e) => {
  if (session.recording || session.finishing) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ---------------------------------------------------------------- boot
switchTab("outline");
renderAll();
document.body.hidden = false; // index.html starts with <body hidden> so the empty markup never shows

if (!session.canUseFileSystem) {
  ui.btnOpen.disabled = true;
  setBootProblem(() => session.fileSystemProblem);
} else {
  void session.lastProjectName().then((name) => {
    if (!name) return;
    lastName = name;
    renderOpenLast();
  });
}

void registerTools(session).then((result) => {
  // Success goes to the console; only a failure is put on screen.
  if (registerProblem(result) === null) return;
  setBootProblem(() => registerProblem(result) ?? "");
});
