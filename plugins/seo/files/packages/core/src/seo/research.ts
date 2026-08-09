// SERP research, pass 0 of the pipeline. Two optional sources:
//
//   Serper (SERPER_API_KEY, serper.dev) — Google results for the keyword:
//     top organic titles/snippets, people-also-ask, related searches.
//   Exa (EXA_API_KEY, exa.ai) — neural search returning actual page content,
//     which grounds the draft in what ranking pages say (and gives the
//     fact-check stage material to check claims against).
//
// Both are best-effort: a source that fails or is unconfigured is skipped,
// and if neither is available the pipeline runs unresearched (the prompts
// tell the model to stay non-specific in that case).

export interface ResearchBrief {
  /** Compact markdown-ish block injected into every stage's prompt. */
  text: string;
  sources: { title: string; url: string }[];
}

interface SerperResponse {
  organic?: { title: string; link: string; snippet?: string }[];
  peopleAlsoAsk?: { question: string }[];
  relatedSearches?: { query: string }[];
}

interface ExaResponse {
  results?: { title: string; url: string; text?: string }[];
}

async function fetchSerper(apiKey: string, keyword: string): Promise<string[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: keyword, num: 10 }),
  });
  if (!response.ok) {
    throw new Error(`Serper failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as SerperResponse;

  const lines: string[] = [];
  const organic = (data.organic ?? []).slice(0, 10);
  if (organic.length > 0) {
    lines.push("### Top organic results");
    for (const [i, result] of organic.entries()) {
      lines.push(`${i + 1}. "${result.title}" — ${result.link}`);
      if (result.snippet) lines.push(`   ${result.snippet}`);
    }
  }
  const paa = (data.peopleAlsoAsk ?? []).slice(0, 6);
  if (paa.length > 0) {
    lines.push("", "### People also ask");
    for (const item of paa) lines.push(`- ${item.question}`);
  }
  const related = (data.relatedSearches ?? []).slice(0, 6);
  if (related.length > 0) {
    lines.push("", "### Related searches");
    for (const item of related) lines.push(`- ${item.query}`);
  }
  return lines;
}

async function fetchExa(apiKey: string, keyword: string): Promise<string[]> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: keyword,
      numResults: 5,
      contents: { text: { maxCharacters: 1500 } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Exa failed: ${response.status} ${await response.text()}`);
  }
  const data = (await response.json()) as ExaResponse;

  const lines: string[] = [];
  const results = data.results ?? [];
  if (results.length > 0) {
    lines.push("### Content extracts from ranking pages");
    for (const result of results) {
      lines.push("", `#### ${result.title} — ${result.url}`);
      if (result.text) lines.push(result.text.trim());
    }
  }
  return lines;
}

/** Total brief is capped — it rides along in four LLM prompts. */
const MAX_BRIEF_CHARS = 12_000;

export async function buildResearchBrief(
  keyword: string,
  keys: { serperApiKey?: string; exaApiKey?: string },
): Promise<ResearchBrief | null> {
  const sections: string[] = [];
  const sources: { title: string; url: string }[] = [];

  const attempts: [string | undefined, (key: string) => Promise<string[]>][] = [
    [keys.serperApiKey, (key) => fetchSerper(key, keyword)],
    [keys.exaApiKey, (key) => fetchExa(key, keyword)],
  ];
  for (const [apiKey, fetcher] of attempts) {
    if (!apiKey) continue;
    try {
      sections.push(...(await fetcher(apiKey)));
    } catch (error) {
      console.warn(
        `Research source failed, continuing without it: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  if (sections.length === 0) {
    console.log(
      "No research APIs configured (SERPER_API_KEY / EXA_API_KEY) — generating without SERP grounding.",
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
