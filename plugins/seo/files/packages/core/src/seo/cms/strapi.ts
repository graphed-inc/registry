import type { CmsAdapter, ClientConfig, PublishInput, PublishResult } from "../types";
import { markdownToHtml } from "../markdown";

// Strapi is different from Ghost/WordPress: every instance defines its own
// content types, so there is no universal "post" shape. The adapter is driven
// entirely by the client config — `cms.collection` and `cms.fields` map our
// article concepts onto the instance's attribute names, and `cms.bodyFormat`
// must match the body field's type (Blocks vs Markdown vs Rich Text/HTML).
// See AGENT.md for how to inspect an instance's schema to fill these in.

interface StrapiEntry {
  id: number;
  documentId: string;
  [attribute: string]: unknown;
}

interface StrapiResponse {
  data?: StrapiEntry | StrapiEntry[] | null;
}

// --- Markdown -> Strapi Blocks (Strapi v5 rich-text format) ---------------

type StrapiTextChild = { type: "text"; text: string; bold?: boolean };
type StrapiBlock =
  | { type: "paragraph"; children: StrapiTextChild[] }
  | { type: "heading"; level: number; children: StrapiTextChild[] }
  | {
      type: "list";
      format: "ordered" | "unordered";
      children: { type: "list-item"; children: StrapiTextChild[] }[];
    };

function parseInlineText(text: string): StrapiTextChild[] {
  const children: StrapiTextChild[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const start = remaining.indexOf("**");
    if (start === -1) {
      children.push({ type: "text", text: remaining });
      break;
    }
    if (start > 0) children.push({ type: "text", text: remaining.slice(0, start) });
    const end = remaining.indexOf("**", start + 2);
    if (end === -1) {
      children.push({ type: "text", text: remaining.slice(start) });
      break;
    }
    children.push({ type: "text", text: remaining.slice(start + 2, end), bold: true });
    remaining = remaining.slice(end + 2);
  }

  return children.length > 0 ? children : [{ type: "text", text: "" }];
}

export function markdownToStrapiBlocks(markdown: string): StrapiBlock[] {
  const blocks: StrapiBlock[] = [];
  let listItems: string[] | null = null;
  let listFormat: "ordered" | "unordered" = "unordered";

  const flushList = (): void => {
    if (!listItems || listItems.length === 0) {
      listItems = null;
      return;
    }
    blocks.push({
      type: "list",
      format: listFormat,
      children: listItems.map((item) => ({
        type: "list-item" as const,
        children: parseInlineText(item),
      })),
    });
    listItems = null;
  };

  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      blocks.push({
        type: "heading",
        level: Math.min(heading[1].length, 6),
        children: [{ type: "text", text: heading[2].trim() }],
      });
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    if (unordered) {
      if (listItems && listFormat !== "unordered") flushList();
      listFormat = "unordered";
      listItems ??= [];
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      if (listItems && listFormat !== "ordered") flushList();
      listFormat = "ordered";
      listItems ??= [];
      listItems.push(ordered[1]);
      continue;
    }

    flushList();
    blocks.push({ type: "paragraph", children: parseInlineText(line) });
  }

  flushList();
  if (blocks.length === 0) {
    throw new Error("Article body is empty after Markdown-to-Blocks conversion.");
  }
  return blocks;
}

// --- Adapter ----------------------------------------------------------------

interface StrapiFieldMap {
  title: string;
  slug: string;
  excerpt?: string;
  body: string;
  metaDescription?: string;
}

const DEFAULT_FIELDS: StrapiFieldMap = {
  title: "title",
  slug: "slug",
  excerpt: "excerpt",
  body: "body",
  metaDescription: "seoDescription",
};

export function createStrapiAdapter(options: {
  apiUrl: string;
  apiToken: string;
  client: ClientConfig;
}): CmsAdapter {
  const { apiUrl, apiToken, client } = options;
  const cms = client.cms;

  if (cms.type !== "strapi") throw new Error("cms.type is not strapi");
  if (!cms.collection) {
    throw new Error(
      'cms.collection is not set in the client config (e.g. "articles"). ' +
        "Inspect the Strapi instance's content types to pick it — see AGENT.md.",
    );
  }

  const collection = cms.collection;
  const fields: StrapiFieldMap = { ...DEFAULT_FIELDS, ...cms.fields };
  const bodyFormat = cms.bodyFormat ?? "blocks";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };

  async function requestJson(
    url: string,
    init?: RequestInit,
  ): Promise<StrapiResponse> {
    const response = await fetch(url, init);
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as StrapiResponse) : null;
    if (!response.ok) {
      throw new Error(
        `${init?.method ?? "GET"} ${url} failed with ${response.status}: ${text.slice(0, 1000)}`,
      );
    }
    return payload ?? {};
  }

  function publicUrlFor(slug: string): string | null {
    return cms.publicUrlPattern
      ? cms.publicUrlPattern.replace("{slug}", slug)
      : null;
  }

  function entryToResult(entry: StrapiEntry): PublishResult {
    return {
      id: entry.documentId,
      url: publicUrlFor(String(entry[fields.slug] ?? "")),
    };
  }

  function buildPayload(input: PublishInput): { data: Record<string, unknown> } {
    const body =
      bodyFormat === "blocks"
        ? markdownToStrapiBlocks(input.article.markdown)
        : bodyFormat === "html"
          ? markdownToHtml(input.article.markdown)
          : input.article.markdown;

    const data: Record<string, unknown> = {
      [fields.title]: input.article.title,
      [fields.slug]: input.slug,
      [fields.body]: body,
    };
    if (fields.excerpt) data[fields.excerpt] = input.article.excerpt;
    if (fields.metaDescription) {
      data[fields.metaDescription] = input.article.meta_description;
    }
    // Publishes live. To create drafts for human review instead, add:
    //   data.publishedAt = null;
    return { data };
  }

  async function findBySlug(slug: string): Promise<PublishResult | null> {
    // Strapi's draft/publish system partitions queries by status — a
    // published entry is invisible to a draft query, so check both.
    for (const status of ["published", "draft"] as const) {
      const url = new URL(`${apiUrl}/api/${collection}`);
      url.searchParams.set(`filters[${fields.slug}][$eq]`, slug);
      url.searchParams.set("pagination[pageSize]", "1");
      url.searchParams.set("status", status);

      const payload = await requestJson(url.toString(), { headers });
      const entry = Array.isArray(payload.data) ? payload.data[0] : null;
      if (entry) return entryToResult(entry);
    }
    return null;
  }

  return {
    name: "strapi",

    findBySlug,

    async publish(input: PublishInput): Promise<PublishResult> {
      const existing = await findBySlug(input.slug);

      if (existing) {
        const payload = await requestJson(
          `${apiUrl}/api/${collection}/${existing.id}`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify(buildPayload(input)),
          },
        );
        const entry = payload.data as StrapiEntry | undefined;
        return entry ? entryToResult(entry) : existing;
      }

      const payload = await requestJson(`${apiUrl}/api/${collection}`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildPayload(input)),
      });
      const entry = payload.data as StrapiEntry | undefined;
      if (!entry?.documentId) {
        throw new Error("Strapi create response had no documentId.");
      }
      return entryToResult(entry);
    },

    async unpublish(id: string): Promise<void> {
      // Strapi v5 Draft & Publish endpoint. It 400s when the content type
      // doesn't have Draft & Publish enabled — enable it in the
      // Content-Type Builder, or delete the entry manually instead.
      await requestJson(`${apiUrl}/api/${collection}/${id}/unpublish`, {
        method: "POST",
        headers,
      });
    },
  };
}
