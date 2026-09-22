// Published-article refresh decisions. Pure: no database, no network.
// The daily seo-refresh job loads GSC + SERP evidence, then calls
// decideArticleRefresh. Titles and slugs are never part of the decision.

export type RefreshDecisionKind = "refresh" | "expand" | "dedupe" | "leave";

export type RefreshThresholds = {
  thinWordThreshold: number;
};

export const DEFAULT_THIN_WORD_THRESHOLD = 500;
/** Days after a content write before another rewrite. */
export const DEFAULT_MIN_AGE_DAYS = 30;
/** Skip a post audited inside this window, unless apply mode still owes it a non-leave write. */
export const AUDIT_COOLDOWN_DAYS = 7;

export const DEFAULT_REFRESH_THRESHOLDS: RefreshThresholds = {
  thinWordThreshold: DEFAULT_THIN_WORD_THRESHOLD,
};

const SLUG_NUMERIC_SUFFIX = /^(.*)-(\d+)$/;

const GENERIC_TOKENS = new Set([
  "about",
  "after",
  "best",
  "better",
  "cheap",
  "companies",
  "company",
  "compared",
  "comparison",
  "complete",
  "easy",
  "free",
  "guide",
  "industry",
  "online",
  "options",
  "program",
  "programs",
  "review",
  "reviews",
  "small",
  "software",
  "solution",
  "solutions",
  "tools",
  "top",
  "ultimate",
  "using",
  "what",
  "which",
  "with",
  "your",
  "2024",
  "2025",
  "2026",
  "2027",
  "business",
  "businesses",
]);

/** Forums and social SERP hits are buyer-language insight, not pages to clone. */
const FORUM_HOST_SUFFIXES = [
  "reddit.com",
  "facebook.com",
  "fb.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "quora.com",
  "pinterest.com",
  "linkedin.com",
  "instagram.com",
  "threads.net",
  "spiceworks.com",
  "news.ycombinator.com",
];

export type GscMetrics = {
  impressions_28d: number | null;
  clicks_28d: number | null;
  ctr_28d: number | null;
  avg_position_28d: number | null;
};

export type CorpusArticle = {
  slug: string;
  title: string;
  impressions_28d: number | null;
  public_url: string | null;
};

export type SerperHit = {
  url: string;
  title: string;
  snippet?: string | null;
  /** H1–H3 pulled from the ranking page body when page text is available. */
  headings?: string[];
};

export type SerperLookup = {
  hits: SerperHit[];
  error: string | null;
};

export type RankingGapAnalysis = {
  gaps: string[];
  forumInsights: string[];
  source: "model" | "heuristic";
};

export type RefreshCandidate = {
  slug: string;
  title: string;
  publicUrl: string | null;
  word_count: number;
  keyword?: string | null;
  /** Hostname of the client's site, used to ignore our own ranking URLs. */
  siteUrl: string;
  gsc: GscMetrics;
  gsc_queries?: Array<{
    query: string;
    impressions_28d: number;
    clicks_28d: number;
    avg_position_28d: number;
  }>;
  serper: SerperLookup;
  corpus: CorpusArticle[];
  bodyText?: string;
  gapAnalysis?: RankingGapAnalysis;
};

export type GapTrace = {
  gsc: {
    impressions_28d: number | null;
    clicks_28d: number | null;
    ctr_28d: number | null;
    avg_position_28d: number | null;
    status: "ok" | "no-data";
  };
  serper: {
    status: "ok" | "error" | "skipped";
    error?: string;
    top?: Array<{ url: string; title: string }>;
    missing_subtopics?: string[];
    forum_insights?: string[];
    gap_source?: "model" | "heuristic";
    own_rank?: number | null;
  };
  gsc_queries?: Array<{
    query: string;
    impressions_28d: number;
    clicks_28d: number;
    avg_position_28d: number;
  }>;
  dupe?: { other_slug: string; rule: "normalized-title" | "slug-suffix" };
};

export type RefreshDecision = {
  decision: RefreshDecisionKind;
  decision_reason: string;
  gap_trace: GapTrace;
  dupe_of: string | null;
};

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function wordCountFromMarkdown(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_[\]()`]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

export function articleHasCta(
  markdown: string,
  ctaUrl: string | undefined,
): boolean {
  const url = ctaUrl?.trim();
  if (!url) return true;
  return markdown.includes(url);
}

export function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 86_400_000;
}

export type RefreshSkipReason =
  | "no-published-at"
  | "recently-refreshed"
  | "recently-audited"
  | "missing-html";

/**
 * A non-leave audit that was never written. Apply mode keeps these eligible
 * so a later `--apply` run can still write them inside the audit cooldown.
 * A `leave` is finished work, not a pending write. A failed CMS update is
 * stored as leave, so a broken CMS cannot hold the front of the batch.
 */
export function isPendingRefreshWrite(audit: {
  auditedAt: Date | null;
  refreshedAt: Date | null;
  decision: string | null;
} | null): boolean {
  return Boolean(
    audit?.auditedAt &&
      !audit.refreshedAt &&
      audit.decision &&
      audit.decision !== "leave",
  );
}

export function refreshSkipReason({
  publishedAt,
  refreshedAt,
  auditedAt,
  wordCount,
  now,
  minAgeDays,
  lastDecision = null,
  apply = true,
}: {
  publishedAt: Date | null;
  refreshedAt: Date | null;
  auditedAt: Date | null;
  wordCount: number;
  now: Date;
  minAgeDays: number;
  /** Previous seo_article_audits.decision, if any. */
  lastDecision?: string | null;
  apply?: boolean;
}): RefreshSkipReason | null {
  if (!publishedAt) return "no-published-at";
  // First pass: never audited → eligible, even if a CMS republish rewrote published_at.
  // After that, cooldown is this loop's audit row.
  if (refreshedAt && daysBetween(now, refreshedAt) < minAgeDays) {
    return "recently-refreshed";
  }
  const pendingWrite = isPendingRefreshWrite({
    auditedAt,
    refreshedAt,
    decision: lastDecision,
  });
  // Missing a CTA does not bypass this. Audit-only never writes the CTA, so
  // a bypass would re-audit the same posts every night. Apply mode still
  // retries a non-leave decision that has not been written.
  if (
    auditedAt &&
    daysBetween(now, auditedAt) < AUDIT_COOLDOWN_DAYS &&
    !(apply && pendingWrite)
  ) {
    return "recently-audited";
  }
  if (wordCount <= 0) return "missing-html";
  return null;
}

export interface RefreshQueueItem {
  slug: string;
  needsCta: boolean;
  pendingApply: boolean;
  impressions: number;
}

/**
 * Every attempted CMS write failed. A partial failure stays a successful
 * exit: those posts are already recorded as leave and wait out the cooldown.
 */
export function cmsRefreshShouldFail(cmsWrites: number, cmsFailures: number): boolean {
  return cmsWrites > 0 && cmsFailures === cmsWrites;
}

/** Pending writes first, then posts missing the CTA, then impressions. */
export function orderRefreshBatch<T extends RefreshQueueItem>(
  items: T[],
  batchSize: number,
): T[] {
  return [...items]
    .sort((a, b) => {
      if (a.pendingApply !== b.pendingApply) return a.pendingApply ? -1 : 1;
      if (a.needsCta !== b.needsCta) return a.needsCta ? -1 : 1;
      return b.impressions - a.impressions;
    })
    .slice(0, batchSize);
}

export function emptyGsc(): GscMetrics {
  return {
    impressions_28d: null,
    clicks_28d: null,
    ctr_28d: null,
    avg_position_28d: null,
  };
}

export function hostnameOf(value: string): string | null {
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function isOwnUrl(url: string, siteUrl: string): boolean {
  const host = hostnameOf(siteUrl);
  if (!host) return false;
  const page = hostnameOf(url);
  if (!page) return false;
  return page === host || page.endsWith(`.${host}`);
}

export function isForumUrl(url: string): boolean {
  const host = hostnameOf(url);
  if (!host) return false;
  return FORUM_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}

function impressionsOrMissing(value: number | null): number {
  return value == null ? Number.NEGATIVE_INFINITY : value;
}

function isWeaker(
  mine: number | null,
  other: number | null,
  tieIAmWeaker: boolean,
): boolean {
  const a = impressionsOrMissing(mine);
  const b = impressionsOrMissing(other);
  if (a < b) return true;
  if (a > b) return false;
  return tieIAmWeaker;
}

export function findDupeOf(
  candidate: { slug: string; title: string; impressions_28d: number | null },
  corpus: CorpusArticle[],
): { slug: string; rule: "normalized-title" | "slug-suffix" } | null {
  const suffix = candidate.slug.match(SLUG_NUMERIC_SUFFIX);
  if (suffix) {
    const baseSlug = suffix[1];
    const other = corpus.find((row) => row.slug === baseSlug);
    if (other && isWeaker(candidate.impressions_28d, other.impressions_28d, true)) {
      return { slug: other.slug, rule: "slug-suffix" };
    }
  }

  const myTitle = normalizeTitle(candidate.title);
  if (!myTitle) return null;

  for (const other of corpus) {
    if (other.slug === candidate.slug) continue;
    if (normalizeTitle(other.title) !== myTitle) continue;
    if (
      isWeaker(
        candidate.impressions_28d,
        other.impressions_28d,
        candidate.slug > other.slug,
      )
    ) {
      return { slug: other.slug, rule: "normalized-title" };
    }
  }
  return null;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
}

function keywordStopwords(keyword?: string | null): Set<string> {
  const stop = new Set(GENERIC_TOKENS);
  if (keyword) {
    for (const word of tokenize(keyword)) stop.add(word);
  }
  return stop;
}

function distinctiveTokens(text: string, stop: Set<string>): string[] {
  return tokenize(text).filter((word) => word.length >= 5 && !stop.has(word));
}

function phraseCovered(phrase: string, body: string, stop: Set<string>): boolean {
  const tokens = distinctiveTokens(phrase, stop);
  if (!tokens.length) return true;
  const hits = tokens.filter((token) => body.includes(token)).length;
  return hits / tokens.length >= 0.5;
}

function hostParts(url: string): { host: string; label: string } | null {
  const host = hostnameOf(url);
  if (!host) return null;
  const label = host.split(".")[0] ?? "";
  if (label.length < 4) return null;
  return { host, label };
}

function isEditorialUrl(url: string, title: string): boolean {
  const lower = url.toLowerCase();
  if (/\/blog\//.test(lower) || /\/articles?\//.test(lower)) return true;
  return /^\d+\s+best\b/i.test(title);
}

function hostCovered(body: string, label: string): boolean {
  const compactBody = body.replace(/[^a-z0-9]/g, "");
  const compactLabel = label.replace(/[^a-z0-9]/g, "");
  return compactLabel.length >= 4 && compactBody.includes(compactLabel);
}

export function headingsFromPageText(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const heading = raw
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (heading.length < 8 || heading.length > 90) return;
    const key = heading.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(heading);
  };
  for (const match of text.matchAll(/^#{1,3}\s+(.+)$/gm)) add(match[1]);
  for (const match of text.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)) {
    add(match[1]);
  }
  return found.slice(0, 12);
}

/**
 * What page-one covers that this article does not. Ranking product/vendor
 * hosts we never name are the strongest signal; competitor headings and
 * leftover title topics fill in when page text or snippets exist.
 * Keyword words are ignored so a same-angle competitor title does not
 * look like a gap.
 */
export function findMissingSubtopics(
  articleText: string,
  hits: SerperHit[],
  keyword: string | null | undefined,
  siteUrl: string,
): string[] {
  const body = articleText.toLowerCase();
  const stop = keywordStopwords(keyword);
  const missing: string[] = [];
  const seen = new Set<string>();
  const push = (gap: string) => {
    const key = gap.toLowerCase();
    if (seen.has(key) || !gap.trim()) return;
    seen.add(key);
    missing.push(gap);
  };

  for (const hit of hits) {
    if (isOwnUrl(hit.url, siteUrl)) continue;
    const parsed = hostParts(hit.url);
    const forum = isForumUrl(hit.url);
    const editorial = isEditorialUrl(hit.url, hit.title);
    let addedPage = false;

    if (parsed && !forum && !editorial && !hostCovered(body, parsed.label)) {
      push(`Cover ranking page: ${hit.title} (${parsed.host})`);
      addedPage = true;
    }

    for (const heading of hit.headings ?? []) {
      if (!phraseCovered(heading, body, stop)) {
        push(`Cover ranking topic: ${heading}`);
      }
    }

    if (addedPage) continue;
    const titleAndSnippet = [hit.title, hit.snippet ?? ""].filter(Boolean).join(" ");
    if (
      !phraseCovered(titleAndSnippet, body, stop) &&
      distinctiveTokens(titleAndSnippet, stop).length
    ) {
      push(`Cover ranking topic: ${hit.title}`);
    }
  }

  return missing.slice(0, 8);
}

export function ownSerpRank(
  slug: string,
  publicUrl: string | null,
  hits: SerperHit[],
): number | null {
  const index = hits.findIndex((hit) => {
    if (publicUrl && urlsLooselyMatch(hit.url, publicUrl)) return true;
    try {
      const path = new URL(hit.url).pathname.replace(/\/$/, "");
      return path === `/${slug}` || path.endsWith(`/${slug}`);
    } catch {
      return false;
    }
  });
  return index >= 0 ? index + 1 : null;
}

export function urlsLooselyMatch(a: string, b: string): boolean {
  const left = hostnameOf(a);
  const right = hostnameOf(b);
  if (!left || !right || left !== right) return false;
  try {
    const pathA = new URL(a).pathname.replace(/\/$/, "") || "/";
    const pathB = new URL(b).pathname.replace(/\/$/, "") || "/";
    return pathA === pathB;
  } catch {
    return false;
  }
}

/** URL variants Search Console may store for one public URL. */
export function urlVariants(url: string): string[] {
  const trimmed = url.replace(/\/$/, "");
  const withSlash = `${trimmed}/`;
  const swapWww = (value: string): string =>
    value.includes("://www.")
      ? value.replace("://www.", "://")
      : value.replace("://", "://www.");
  return [...new Set([trimmed, withSlash, swapWww(trimmed), swapWww(withSlash)])];
}

function gscStatus(gsc: GscMetrics): "ok" | "no-data" {
  return gsc.impressions_28d == null &&
    gsc.clicks_28d == null &&
    gsc.avg_position_28d == null
    ? "no-data"
    : "ok";
}

export function decideArticleRefresh(
  candidate: RefreshCandidate,
  thresholds: RefreshThresholds = DEFAULT_REFRESH_THRESHOLDS,
): RefreshDecision {
  const gscStatusValue = gscStatus(candidate.gsc);
  const baseTrace: GapTrace = {
    gsc: {
      impressions_28d: candidate.gsc.impressions_28d,
      clicks_28d: candidate.gsc.clicks_28d,
      ctr_28d: candidate.gsc.ctr_28d,
      avg_position_28d: candidate.gsc.avg_position_28d,
      status: gscStatusValue,
    },
    serper: { status: "skipped" },
  };
  if (candidate.gsc_queries?.length) baseTrace.gsc_queries = candidate.gsc_queries;

  const heuristicGaps = candidate.serper.hits.length
    ? findMissingSubtopics(
        candidate.bodyText ?? candidate.title,
        candidate.serper.hits,
        candidate.keyword,
        candidate.siteUrl,
      )
    : [];
  const analysis = candidate.gapAnalysis ?? {
    gaps: heuristicGaps,
    forumInsights: [] as string[],
    source: "heuristic" as const,
  };
  const serperTrace = candidate.serper.error
    ? { status: "error" as const, error: candidate.serper.error }
    : candidate.serper.hits.length
      ? {
          status: "ok" as const,
          top: candidate.serper.hits.slice(0, 10).map((hit) => ({
            url: hit.url,
            title: hit.title,
          })),
          missing_subtopics: analysis.gaps,
          forum_insights: analysis.forumInsights,
          gap_source: analysis.source,
          own_rank: ownSerpRank(
            candidate.slug,
            candidate.publicUrl,
            candidate.serper.hits,
          ),
        }
      : { status: "skipped" as const };

  const dupe = findDupeOf(
    {
      slug: candidate.slug,
      title: candidate.title,
      impressions_28d: candidate.gsc.impressions_28d,
    },
    candidate.corpus,
  );
  if (dupe) {
    return {
      decision: "dedupe",
      decision_reason: `Weaker duplicate of ${dupe.slug} via ${dupe.rule}; keep title and slug and point at the canonical.`,
      gap_trace: {
        ...baseTrace,
        serper: serperTrace,
        dupe: { other_slug: dupe.slug, rule: dupe.rule },
      },
      dupe_of: dupe.slug,
    };
  }

  const thin = candidate.word_count < thresholds.thinWordThreshold;

  if (thin) {
    const gaps = serperTrace.status === "ok" ? serperTrace.missing_subtopics ?? [] : [];
    const gapNote = gaps.length
      ? ` Page-one gaps to cover: ${gaps.join("; ")}.`
      : "";
    return {
      decision: "expand",
      decision_reason: `Thin copy (${candidate.word_count} words < ${thresholds.thinWordThreshold}).${gapNote}`,
      gap_trace: { ...baseTrace, serper: serperTrace },
      dupe_of: null,
    };
  }

  if (candidate.serper.error) {
    return {
      decision: "leave",
      decision_reason: `SERP lookup failed (no rewrite): ${candidate.serper.error}`,
      gap_trace: {
        ...baseTrace,
        serper: { status: "error", error: candidate.serper.error },
      },
      dupe_of: null,
    };
  }

  const missing = serperTrace.status === "ok" ? serperTrace.missing_subtopics ?? [] : [];
  const forumInsights =
    serperTrace.status === "ok" ? serperTrace.forum_insights ?? [] : [];
  // Forum insight shapes a rewrite but does not justify one. A forum ranks
  // for most informational keywords, so triggering on it alone makes leave
  // unreachable and rewrites articles with no coverage gap.
  if (missing.length > 0) {
    const parts = [
      `Coverage gaps: ${missing.join("; ")}`,
      forumInsights.length ? `Forum insight: ${forumInsights.join("; ")}` : null,
    ].filter((part): part is string => part != null);
    return {
      decision: "refresh",
      decision_reason: parts.join(" "),
      gap_trace: { ...baseTrace, serper: serperTrace },
      dupe_of: null,
    };
  }

  return {
    decision: "leave",
    decision_reason: "Page-one coverage looks aligned; no ranking-content gaps to write.",
    gap_trace: { ...baseTrace, serper: serperTrace },
    dupe_of: null,
  };
}

const MAX_GAP_ITEMS = 10;
const MAX_FORUM_ITEMS = 8;
const MAX_GAP_ITEM_CHARS = 280;

function asStringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.replace(/\s+/g, " ").trim().slice(0, MAX_GAP_ITEM_CHARS);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function parseGapAnalysisJson(
  raw: string,
): Pick<RankingGapAnalysis, "gaps" | "forumInsights"> {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("gap analysis was not JSON");
  }
  const parsed = JSON.parse(stripped.slice(start, end + 1)) as {
    gaps?: unknown;
    forumInsights?: unknown;
    forum_insights?: unknown;
  };
  return {
    gaps: asStringList(parsed.gaps, MAX_GAP_ITEMS),
    forumInsights: asStringList(
      parsed.forumInsights ?? parsed.forum_insights,
      MAX_FORUM_ITEMS,
    ),
  };
}

export function stripRewriteFences(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * A rewrite that fails these checks is discarded. Nothing is written.
 * `ctaUrl` empty means the client did not configure one, so a link is not required.
 */
export function refreshRejectionReason({
  original,
  refreshed,
  ctaUrl,
  canonicalUrl,
  decision,
  thinWordThreshold = DEFAULT_THIN_WORD_THRESHOLD,
}: {
  original: string;
  refreshed: string;
  ctaUrl?: string | null;
  /** Required on a dedupe rewrite: the markdown link to the canonical article. */
  canonicalUrl?: string | null;
  decision: RefreshDecisionKind;
  thinWordThreshold?: number;
}): string | null {
  const body = stripRewriteFences(refreshed);
  if (!body.trim()) return "empty";
  if (/^#\s+/m.test(body)) return "contains_h1";
  const cta = ctaUrl?.trim();
  if (cta && !body.includes(`](${cta})`)) return "missing_cta_link";
  const canonical = canonicalUrl?.trim();
  if (decision === "dedupe" && canonical && !body.includes(`](${canonical})`)) {
    return "missing_canonical_link";
  }
  if (!/^#{2,3}\s+/m.test(body)) return "missing_headings";
  const originalWords = Math.max(1, wordCountFromMarkdown(original));
  const refreshedWords = wordCountFromMarkdown(body);
  const ratio = refreshedWords / originalWords;
  if (decision === "expand") {
    if (refreshedWords < thinWordThreshold) return `expand_too_short_${refreshedWords}`;
    return null;
  }
  if (ratio < 0.6) return `length_drift_${ratio.toFixed(2)}`;
  return null;
}
