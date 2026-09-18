/**
 * A very small Markdown → DOM renderer for the outline pane.
 *
 * It builds real nodes with textContent, so agent-written text can never inject HTML.
 * Supported: headings, bullet / numbered lists (one level of nesting), blockquotes,
 * fenced code, horizontal rules, paragraphs, and inline **bold** / *italic* / `code` /
 * [text](https://…). Placeholder lines such as "[イラスト: …]" ("[illustration: …]")
 * become dashed placeholder boxes.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*(```|~~~)(.*)$/;
const PLACEHOLDER = /^\s*\[(イラスト|図|画像|写真|illustration|image|figure)\s*[:：]\s*(.+?)\]\s*$/;

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^\s)]+\))/;

function appendInline(parent: Node, text: string): void {
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      const el = document.createElement("strong");
      el.textContent = part.slice(2, -2);
      parent.appendChild(el);
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const el = document.createElement("code");
      el.textContent = part.slice(1, -1);
      parent.appendChild(el);
    } else if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      const el = document.createElement("em");
      el.textContent = part.slice(1, -1);
      parent.appendChild(el);
    } else if (part.startsWith("[") && part.includes("](")) {
      const split = part.indexOf("](");
      const label = part.slice(1, split);
      const href = part.slice(split + 2, -1);
      const a = document.createElement("a");
      a.href = href; // the regex above already allowed only http(s)/mailto
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      parent.appendChild(a);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function placeholderBox(label: string, body: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "placeholder";
  div.textContent = `${label}: ${body}`;
  return div;
}

/** Render Markdown into `container`, replacing its contents. */
export function renderMarkdown(container: HTMLElement, markdown: string, emptyText = "(empty)"): void {
  container.textContent = "";
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  let paragraph: string[] = [];
  const listStack: Array<{ el: HTMLElement; indent: number }> = [];
  let quote: HTMLElement | null = null;

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join("\n"));
    (quote ?? container).appendChild(p);
    paragraph = [];
  };
  const closeList = (): void => {
    listStack.length = 0;
  };
  const closeQuote = (): void => {
    flushParagraph();
    quote = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      closeList();
      const body: string[] = [];
      i += 1;
      for (; i < lines.length; i++) {
        if (FENCE.test(lines[i])) break;
        body.push(lines[i]);
      }
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = body.join("\n");
      pre.appendChild(code);
      (quote ?? container).appendChild(pre);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      closeList();
      closeQuote();
      continue;
    }

    const ph = PLACEHOLDER.exec(line);
    if (ph) {
      flushParagraph();
      closeList();
      (quote ?? container).appendChild(placeholderBox(ph[1], ph[2]));
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      closeList();
      closeQuote();
      container.appendChild(document.createElement("hr"));
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const h = document.createElement(`h${Math.min(6, heading[1].length + 1)}`);
      appendInline(h, heading[2]);
      (quote ?? container).appendChild(h);
      continue;
    }

    const q = QUOTE.exec(line);
    if (q) {
      closeList();
      if (!quote) {
        flushParagraph();
        quote = document.createElement("blockquote");
        container.appendChild(quote);
      }
      paragraph.push(q[1]);
      continue;
    }
    if (quote) closeQuote();

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      flushParagraph();
      const indent = item[1].replace(/\t/g, "  ").length;
      // Close as many nesting levels as the indent became shallower
      while (listStack.length > 1 && indent < listStack[listStack.length - 1].indent) listStack.pop();
      let top = listStack[listStack.length - 1] as { el: HTMLElement; indent: number } | undefined;
      if (!top) {
        const el = document.createElement(bullet ? "ul" : "ol");
        (quote ?? container).appendChild(el);
        top = { el, indent };
        listStack.push(top);
      } else if (indent >= top.indent + 2) {
        const nested = document.createElement(bullet ? "ul" : "ol");
        (top.el.lastElementChild ?? top.el).appendChild(nested);
        top = { el: nested, indent };
        listStack.push(top);
      }
      const li = document.createElement("li");
      appendInline(li, item[2]);
      top.el.appendChild(li);
      continue;
    }
    closeList();

    paragraph.push(line);
  }

  flushParagraph();

  if (!container.childNodes.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = emptyText;
    container.appendChild(p);
  }
}
