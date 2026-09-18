import { normKey, type ClientConfig } from "./types";

export const SITE_KEYWORDS_TOOL = "dataforseo:google_ads.keywords_for_site.live";
export const KEYWORD_IDEAS_TOOL = "dataforseo:labs.keyword_ideas.live";

const MIN_TOKENS = 2;
const SITE_FALLBACK_MIN = 10;

export type ResearchSource = "site" | "ideas";

export type ResearchKeyword = {
  term: string;
  searchVolume: number;
  volumeKnown: boolean;
  cpc: number | null;
  competition: string | null;
  source: ResearchSource;
};

export type ResearchResult = {
  target: string;
  toolsUsed: string[];
  keywords: ResearchKeyword[];
  error?: string;
};

export type ToolsRunner = (
  tool: string,
  input: Record<string, string | number | string[]>,
) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokenCount(term: string): number {
  return normKey(term)
    .split(" ")
    .filter(Boolean).length;
}

export function landingHost(client: ClientConfig): string {
  try {
    return new URL(client.promotion.landing_page_url).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return "";
  }
}

export function researchTarget(client: ClientConfig, override?: string): string {
  const explicit = (override ?? client.seed.target).trim();
  if (explicit) return explicit.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return landingHost(client);
}

export function brandTokens(client: ClientConfig): Set<string> {
  const tokens = new Set<string>();
  const add = (value: string) => {
    const key = normKey(value);
    if (key) tokens.add(key);
  };
  add(client.display_name);
  add(client.promotion.brand_headline);
  add(client.client_key);
  const host = landingHost(client);
  if (host) {
    add(host);
    add(host.split(".")[0] ?? "");
  }
  const seedHost = researchTarget(client);
  if (seedHost) {
    add(seedHost);
    add(seedHost.split(".")[0] ?? "");
  }
  return tokens;
}

function isBrandOnly(term: string, brands: Set<string>): boolean {
  return brands.has(normKey(term));
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readCompetition(row: Record<string, unknown>): string | null {
  if (typeof row.competition === "string" && row.competition.trim()) {
    return row.competition.toUpperCase();
  }
  const info = isRecord(row.keyword_info) ? row.keyword_info : null;
  if (info && typeof info.competition_level === "string") {
    return info.competition_level.toUpperCase();
  }
  return null;
}

function readVolume(row: Record<string, unknown>): {
  volume: number;
  known: boolean;
} {
  const info = isRecord(row.keyword_info) ? row.keyword_info : null;
  const value =
    readNumber(row.search_volume) ??
    readNumber(row.searchVolume) ??
    (info ? readNumber(info.search_volume) : null);
  if (value == null) return { volume: 0, known: false };
  return { volume: value, known: true };
}

function readCpc(row: Record<string, unknown>): number | null {
  const info = isRecord(row.keyword_info) ? row.keyword_info : null;
  return (
    readNumber(row.cpc) ?? (info ? readNumber(info.cpc) : null)
  );
}

/**
 * Pull keyword rows out of a DataForSEO envelope, a tools.run payload,
 * or an already-flat list. Site items are `{ keyword, search_volume }`.
 * Labs ideas nest volume under `keyword_info` and wrap rows in `items`.
 */
export function extractKeywordRows(
  payload: unknown,
  source: ResearchSource,
): ResearchKeyword[] {
  const rows: ResearchKeyword[] = [];
  const seen = new Set<unknown>();

  const walk = (value: unknown): void => {
    if (value == null || seen.has(value)) return;
    if (typeof value === "object") seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!isRecord(value)) return;
    const rawTerm =
      typeof value.keyword === "string"
        ? value.keyword
        : typeof value.term === "string"
          ? value.term
          : "";
    if (rawTerm) {
      const term = normKey(rawTerm);
      if (term) {
        const volume = readVolume(value);
        rows.push({
          term,
          searchVolume: volume.volume,
          volumeKnown: volume.known,
          cpc: readCpc(value),
          competition: readCompetition(value),
          source,
        });
      }
      return;
    }
    for (const key of [
      "tasks",
      "result",
      "items",
      "results",
      "keywords",
    ] as const) {
      walk(value[key]);
    }
  };

  walk(payload);
  return rows;
}

export function filterResearchKeywords(
  rows: ResearchKeyword[],
  client: ClientConfig,
  options?: { dropUnknownVolume?: boolean },
): ResearchKeyword[] {
  const brands = brandTokens(client);
  const minVolume = client.seed.min_search_volume;
  const picked = new Map<string, ResearchKeyword>();
  for (const row of rows) {
    const term = normKey(row.term);
    if (!term) continue;
    if (tokenCount(term) < MIN_TOKENS) continue;
    if (isBrandOnly(term, brands)) continue;
    if (options?.dropUnknownVolume && !row.volumeKnown) continue;
    if (row.volumeKnown && row.searchVolume < minVolume) continue;
    const existing = picked.get(term);
    if (!existing || row.searchVolume > existing.searchVolume) {
      picked.set(term, { ...row, term });
    }
  }
  return [...picked.values()].sort((a, b) => {
    if (b.searchVolume !== a.searchVolume) return b.searchVolume - a.searchVolume;
    return (b.cpc ?? 0) - (a.cpc ?? 0);
  });
}

export function ideaSeedKeywords(client: ClientConfig): string[] {
  const brands = brandTokens(client);
  const seeds: string[] = [];
  const add = (raw: string) => {
    const term = normKey(raw);
    if (tokenCount(term) < MIN_TOKENS || tokenCount(term) > 6) return;
    if (brands.has(term)) return;
    if (seeds.includes(term)) return;
    seeds.push(term);
  };
  add(client.product_one_liner);
  for (const chunk of client.relevance.product_context.split(/[.;\n]/)) {
    add(chunk);
    if (seeds.length >= 3) break;
  }
  return seeds.slice(0, 3);
}

async function defaultToolsRunner(
  tool: string,
  input: Record<string, string | number | string[]>,
): Promise<unknown> {
  const { Graphed } = await import("@graphed-inc/sdk");
  const graphed = new Graphed();
  if (!graphed.isConfigured()) {
    throw new Error(
      "Missing GRAPHED_TOKEN. Run through `graphed dev run` so Graphed can call the DataForSEO catalog.",
    );
  }
  return graphed.tools.run(tool, input);
}

function mergeKeywords(
  primary: ResearchKeyword[],
  extra: ResearchKeyword[],
): ResearchKeyword[] {
  const picked = new Map<string, ResearchKeyword>();
  for (const row of [...primary, ...extra]) {
    if (!picked.has(row.term)) picked.set(row.term, row);
  }
  return [...picked.values()].sort((a, b) => {
    if (b.searchVolume !== a.searchVolume) return b.searchVolume - a.searchVolume;
    return (b.cpc ?? 0) - (a.cpc ?? 0);
  });
}

/**
 * Ask DataForSEO what people search to find this product.
 * Prefer `keywords_for_site` on the landing host. Labs ideas only if the
 * site list is thin — ideas for a brand token like "graphed" are noisy.
 */
export async function researchSeedKeywords(
  client: ClientConfig,
  input: {
    target?: string;
    limit?: number;
    run?: ToolsRunner;
  } = {},
): Promise<ResearchResult> {
  const target = researchTarget(client, input.target);
  const limit = input.limit ?? client.seed.max_keywords;
  const run = input.run ?? defaultToolsRunner;
  const toolsUsed: string[] = [];

  if (!target) {
    return {
      target,
      toolsUsed,
      keywords: [],
      error:
        "No research target. Set seed.target or promotion.landing_page_url to the product host.",
    };
  }

  try {
    toolsUsed.push(SITE_KEYWORDS_TOOL);
    const sitePayload = await run(SITE_KEYWORDS_TOOL, {
      target,
      locationCode: client.seed.location_code,
      languageCode: client.seed.language_code,
    });
    const siteRows = extractKeywordRows(sitePayload, "site");
    let fetchedRows = siteRows.length;
    let keywords = filterResearchKeywords(siteRows, client, {
      dropUnknownVolume: true,
    }).slice(0, limit);

    // Fall back only when the catalog itself was thin, not when the
    // volume filter dropped unknown-volume rows.
    if (siteRows.length < SITE_FALLBACK_MIN) {
      const seeds = ideaSeedKeywords(client);
      if (seeds.length > 0) {
        toolsUsed.push(KEYWORD_IDEAS_TOOL);
        const ideasPayload = await run(KEYWORD_IDEAS_TOOL, {
          keywords: seeds,
          locationCode: client.seed.location_code,
          languageCode: client.seed.language_code,
        });
        const ideaRows = extractKeywordRows(ideasPayload, "ideas");
        fetchedRows += ideaRows.length;
        keywords = mergeKeywords(
          keywords,
          filterResearchKeywords(ideaRows, client, {
            dropUnknownVolume: true,
          }),
        ).slice(0, limit);
      }
    }

    if (keywords.length === 0) {
      const reason =
        fetchedRows === 0
          ? "DataForSEO returned no usable keywords"
          : `catalog returned ${fetchedRows} rows but none survived filtering (2+ tokens, not brand-only, known search volume >= ${client.seed.min_search_volume})`;
      return {
        target,
        toolsUsed,
        keywords,
        error: `${reason} — use --terms with a reviewed list`,
      };
    }

    return { target, toolsUsed, keywords };
  } catch (error) {
    return {
      target,
      toolsUsed,
      keywords: [],
      error: error instanceof Error ? error.message : "DataForSEO research failed",
    };
  }
}
