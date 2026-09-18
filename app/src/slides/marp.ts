/**
 * Marp rendering for the slides tab.
 *
 * Lines like "[イラスト: 全体像]" ("[illustration: overview]") are turned into a fenced
 * ```placeholder block before rendering, so they come out as
 * <code class="language-placeholder"> and can be styled
 * as a dashed "put a picture here" box (Marp runs with html:false, so we cannot inject
 * raw HTML from the agent's Markdown).
 */
import { Marp } from "@marp-team/marp-core";
import { t } from "../i18n";

const PLACEHOLDER_LINE = /^\s*\[(イラスト|図|画像|写真|illustration|image|figure)\s*[:：]\s*(.+?)\]\s*$/;
const FENCE = /^\s*(```|~~~)/;

/** Extra CSS injected into the rendered deck (placeholder boxes + page framing). */
const DECK_CSS = `
section pre:has(> code.language-placeholder) {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  box-shadow: none !important;
}
code.language-placeholder {
  display: block;
  border: 3px dashed #f59e0b;
  background: #fffbeb;
  color: #92400e;
  border-radius: 12px;
  padding: 1em 1.2em;
  text-align: center;
  font-family: inherit;
  font-size: 0.85em;
  white-space: pre-wrap;
  word-break: break-word;
}
code.language-placeholder::before {
  content: "🖼 ";
}
`;

/** CSS used only for the on-page preview (stacked slides in an iframe). */
const PREVIEW_CSS = `
html, body { margin: 0; padding: 0; background: #eef0f3; }
body { padding: 12px; box-sizing: border-box; }
div.marpit > svg[data-marpit-svg] {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 0 14px;
  background: #fff;
  border: 1px solid #dfe3e8;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(16,24,40,.08);
}
@media print {
  body { padding: 0; background: none; }
  div.marpit > svg[data-marpit-svg] { margin: 0; border: none; border-radius: 0; box-shadow: none; }
}
`;

export interface RenderedDeck {
  /** Marpit container markup (<div class="marpit">…</div>). */
  html: string;
  /** Theme CSS plus our placeholder styling. */
  css: string;
  slideCount: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let marp: Marp | null = null;

function instance(): Marp {
  marp ??= new Marp({ html: false, script: false, minifyCSS: false });
  return marp;
}

/** Replace placeholder lines outside code fences with a ```placeholder block. */
export function preprocessPlaceholders(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    const m = !inFence ? PLACEHOLDER_LINE.exec(line) : null;
    if (m) {
      out.push("```placeholder", `${m[1]}: ${m[2]}`, "```");
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

// Remember the most recent render (so asking for the slide count and drawing the pane
// do not render the same Markdown twice).
let cacheKey: string | null = null;
let cacheValue: RenderedDeck | null = null;

/** Render Marp Markdown. Result is cached for the same input. */
export function renderMarp(markdown: string): RenderedDeck {
  if (cacheKey === markdown && cacheValue) return cacheValue;
  const md = preprocessPlaceholders(markdown);
  let deck: RenderedDeck;
  try {
    const result = instance().render(md, { htmlAsArray: true });
    deck = {
      html: `<div class="marpit">${result.html.join("")}</div>`,
      css: `${result.css}\n${DECK_CSS}`,
      slideCount: result.html.length,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    deck = {
      html: `<div class="marpit"><p class="render-error">Marp failed to render: ${escapeHtml(message)}</p></div>`,
      css: DECK_CSS,
      slideCount: 0,
    };
    console.warn("marp render failed", message);
  }
  cacheKey = markdown;
  cacheValue = deck;
  return deck;
}

/** How many slides the given Markdown produces. */
export function countSlides(markdown: string): number {
  if (!markdown.trim()) return 0;
  return renderMarp(markdown).slideCount;
}

/** A standalone HTML document for the deck (used by the preview iframe, download and print). */
export function deckDocument(markdown: string, title: string): string {
  const deck = renderMarp(markdown);
  return [
    "<!doctype html>",
    '<html lang="ja"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${deck.css}</style>`,
    `<style>${PREVIEW_CSS}</style>`,
    "</head><body>",
    deck.html,
    "</body></html>",
  ].join("\n");
}

/** Trigger a browser download of a text file. */
export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open the deck in a new window and call print() (→ save as PDF). */
export function printDeck(markdown: string, title: string): string | null {
  const win = window.open("", "_blank");
  if (!win) return t("marp.popupBlocked");
  win.document.open();
  win.document.write(deckDocument(markdown, title));
  win.document.close();
  win.focus();
  setTimeout(() => {
    try {
      win.print();
    } catch (e) {
      console.warn("print failed", e);
    }
  }, 400);
  return null;
}
