// SERP research, pass 0 of the pipeline. Both sources go through Graphed
// Tools (GRAPHED_TOKEN + GRAPHED_TOOLS_URL). No Serper or Exa API key.
//
//   serper:search — Google results for the keyword: top organic
//     titles/snippets, people-also-ask, related searches.
//   exa:search — neural search. Page text is requested on the search
//     (`contents.text`); if the result rows have no text, exa:contents
//     fetches it. That text grounds the draft and the fact-check pass.
//
// Both are best-effort: a source that fails is skipped. If neither returns
// anything, the pipeline runs unresearched and the prompts tell the model
// to stay non-specific.

import { z } from "zod";
import { runTool } from "./tools";

export interface ResearchBrief {
  /** Compact markdown-ish block injected into every stage's prompt. */
  text: string;
  sources: { title: string; url: string }[];
}

const serperSchema = z.object({
  organic: z
    .array(
      z.object({
        title: z.string().optional(),
        link: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .nullish(),
  peopleAlsoAsk: z
    .array(z.object({ question: z.string().optional() }))
    .nullish(),
  relatedSearches: z
    .array(z.object({ query: z.string().optional() }))
    .nullish(),
});

const exaResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  text: z.string().optional(),
});

const exaSchema = z.object({
  results: z.array(exaResultSchema).nullish(),
});

type ExaResult = z.infer<typeof exaResultSchema>;

function parseToolPayload<T>(
  schema: z.ZodType<T>,
  value: unknown,
  tool: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const detail = issue
      ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
      : "unknown";
    throw new Error(`${tool} returned an unexpected payload: ${detail}`);
  }
  return parsed.data;
}

const SERPER_SEARCH_TOOL = "serper:search";
const EXA_SEARCH_TOOL = "exa:search";
const EXA_CONTENTS_TOOL = "exa:contents";
const EXA_TEXT_CHARS = 1500;

async function fetchSerper(keyword: string): Promise<string[]> {
  const data = parseToolPayload(
    serperSchema,
    await runTool(SERPER_SEARCH_TOOL, { q: keyword, num: 10 }),
    SERPER_SEARCH_TOOL,
  );

  const lines: string[] = [];
  const organic = (data.organic ?? [])
    .filter(
      (result): result is { title: string; link: string; snippet?: string } =>
        typeof result.title === "string" && typeof result.link === "string",
    )
    .slice(0, 10);
  if (organic.length > 0) {
    lines.push("### Top organic results");
    for (const [i, result] of organic.entries()) {
      lines.push(`${i + 1}. "${result.title}" — ${result.link}`);
      if (result.snippet) lines.push(`   ${result.snippet}`);
    }
  }
  const paa = (data.peopleAlsoAsk ?? [])
    .map((item) => item.question)
    .filter((question): question is string => typeof question === "string")
    .slice(0, 6);
  if (paa.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("### People also ask");
    for (const question of paa) lines.push(`- ${question}`);
  }
  const related = (data.relatedSearches ?? [])
    .map((item) => item.query)
    .filter((query): query is string => typeof query === "string")
    .slice(0, 6);
  if (related.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("### Related searches");
    for (const query of related) lines.push(`- ${query}`);
  }
  return lines;
}

function exaLines(results: ExaResult[]): string[] {
  const lines: string[] = [];
  for (const result of results) {
    if (!result.title && !result.url) continue;
    if (lines.length === 0) lines.push("### Content extracts from ranking pages");
    lines.push("", `#### ${result.title ?? "Untitled"} — ${result.url ?? ""}`);
    if (result.text) lines.push(result.text.trim());
  }
  return lines;
}

async function fetchExa(keyword: string): Promise<string[]> {
  // `contents` is forwarded to Exa's search API by the tools provider.
  const searched = parseToolPayload(
    exaSchema,
    await runTool(EXA_SEARCH_TOOL, {
      query: keyword,
      numResults: 5,
      contents: { text: { maxCharacters: EXA_TEXT_CHARS } },
    }),
    EXA_SEARCH_TOOL,
  );

  const results = (searched.results ?? []).slice(0, 5);
  const missing = [
    ...new Set(
      results
        .filter((result) => !result.text && result.url)
        .map((result) => result.url)
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ];

  if (missing.length > 0) {
    const contents = parseToolPayload(
      exaSchema,
      await runTool(EXA_CONTENTS_TOOL, {
        urls: missing,
        text: { maxCharacters: EXA_TEXT_CHARS },
      }),
      EXA_CONTENTS_TOOL,
    );
    const byUrl = new Map(
      (contents.results ?? [])
        .filter((result) => typeof result.url === "string")
        .map((result) => [result.url, result.text]),
    );
    for (const result of results) {
      if (!result.text && result.url) {
        result.text = byUrl.get(result.url);
      }
    }
  }

  return exaLines(results);
}

/** Total brief is capped — it rides along in four LLM prompts. */
const MAX_BRIEF_CHARS = 12_000;

export async function buildResearchBrief(
  keyword: string,
): Promise<ResearchBrief | null> {
  const sections: string[] = [];
  const sources: { title: string; url: string }[] = [];

  const attempts: [string, () => Promise<string[]>][] = [
    [SERPER_SEARCH_TOOL, () => fetchSerper(keyword)],
    [EXA_SEARCH_TOOL, () => fetchExa(keyword)],
  ];
  const settled = await Promise.allSettled(
    attempts.map(([, fetcher]) => fetcher()),
  );
  for (const [i, outcome] of settled.entries()) {
    const tool = attempts[i]?.[0] ?? "research";
    if (outcome.status === "fulfilled") {
      sections.push(...outcome.value);
      continue;
    }
    const error = outcome.reason;
    console.warn(
      `Research source ${tool} failed, continuing without it: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (sections.length === 0) {
    console.log(
      "SERP research returned nothing — generating without SERP grounding.",
    );
    return null;
  }

  const text = sections.join("\n").slice(0, MAX_BRIEF_CHARS);
  for (const line of sections) {
    const match = /^#### (.+) — (\S+)$/.exec(line);
    if (match) sources.push({ title: match[1], url: match[2] });
  }
  return { text, sources };
}

export interface SerperOrganicHit {
  url: string;
  title: string;
  snippet: string | null;
}

/** Google organic results for a refresh pass. Throws on tool or payload failure. */
export async function searchSerperHits(keyword: string): Promise<SerperOrganicHit[]> {
  const data = parseToolPayload(
    serperSchema,
    await runTool(SERPER_SEARCH_TOOL, { q: keyword, num: 10 }),
    SERPER_SEARCH_TOOL,
  );
  return (data.organic ?? [])
    .filter(
      (result): result is { title: string; link: string; snippet?: string } =>
        typeof result.title === "string" && typeof result.link === "string",
    )
    .slice(0, 10)
    .map((result) => ({
      url: result.link,
      title: result.title,
      snippet: result.snippet ?? null,
    }));
}

export interface ExaPageText {
  url: string;
  title: string | null;
  text: string;
}

/** Page text for known ranking URLs. Throws on tool or payload failure. */
export async function fetchExaPageText(
  urls: string[],
  maxCharacters = 4_000,
): Promise<ExaPageText[]> {
  const unique = [...new Set(urls.filter((url) => url.length > 0))];
  if (unique.length === 0) return [];
  const contents = parseToolPayload(
    exaSchema,
    await runTool(EXA_CONTENTS_TOOL, {
      urls: unique,
      text: { maxCharacters },
    }),
    EXA_CONTENTS_TOOL,
  );
  return (contents.results ?? [])
    .filter(
      (result): result is ExaResult & { url: string } =>
        typeof result.url === "string" && result.url.length > 0,
    )
    .map((result) => ({
      url: result.url,
      title: result.title ?? null,
      text: result.text ?? "",
    }));
}
