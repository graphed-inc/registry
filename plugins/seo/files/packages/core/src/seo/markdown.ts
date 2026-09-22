// Minimal markdown -> HTML for generated articles. Handles headings,
// paragraphs, and dash/star lists — what the generator is prompted to emit.
// Links are stripped to anchor text unless `allowUrls` lists the href.
// Generation passes no allow-list, so published copy still bans stray links.
// Refresh passes the configured CTA (and a canonical URL on dedupe).

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

function inlineMarkdown(value: string, allowUrls: ReadonlySet<string>): string {
  const pieces: string[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    pieces.push(formatInline(value.slice(last, index)));
    const label = match[1] ?? "";
    const href = match[2] ?? "";
    if (allowUrls.has(href)) {
      pieces.push(`<a href="${escapeHtml(href)}">${formatInline(label)}</a>`);
    } else {
      pieces.push(formatInline(label));
    }
    last = index + match[0].length;
  }
  pieces.push(formatInline(value.slice(last)));
  return pieces.join("");
}

export function markdownToHtml(
  markdown: string,
  options?: { allowUrls?: string[] },
): string {
  const allowUrls = new Set(options?.allowUrls ?? []);
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "), allowUrls)}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (list.length === 0) return;
    blocks.push(
      `<ul>${list.map((item) => `<li>${inlineMarkdown(item, allowUrls)}</li>`).join("")}</ul>`,
    );
    list = [];
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1].length + 1, 4);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2], allowUrls)}</h${level}>`);
      continue;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(line);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
}
