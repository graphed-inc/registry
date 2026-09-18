import type { BlockReason } from "./guards";
import { assertNameList } from "./name-list";
import type { ClientConfig } from "./types";
import { normKey } from "./types";

export type BrandKind = "generic" | "own_brand" | "competitor_brand";

export type BrandVerdict = {
  kind: BrandKind;
  confidence: number;
  reason: string;
};

export type BrandGuardDecision = {
  blocked: BlockReason | null;
  useTermAsHeadline: boolean;
  kind: BrandKind | "blocked_term";
  reason: string;
};

export type BrandJudgeFn = (
  client: ClientConfig,
  term: string,
) => Promise<BrandVerdict | null>;

type JudgePayload = {
  kind?: string;
  confidence?: number;
  reason?: string;
};

/** Suffixes glued to a 4+ letter name (`klingai`, `luma2`). */
const COMPOUND_SUFFIX = /^(ai|app|lab|labs|\d+)$/;

function isBrandKind(value: string | undefined): value is BrandKind {
  return (
    value === "generic" ||
    value === "own_brand" ||
    value === "competitor_brand"
  );
}

export function tokenize(text: string): string[] {
  return normKey(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function tokenMatchesName(token: string, needle: string): boolean {
  if (token === needle) return true;
  if (needle.length >= 4 && token.startsWith(needle)) {
    return COMPOUND_SUFFIX.test(token.slice(needle.length));
  }
  return false;
}

function phraseMatchesTokens(hay: string[], needle: string[]): boolean {
  if (!needle.length || hay.length < needle.length) return false;
  if (needle.length === 1) {
    return hay.some((token) => tokenMatchesName(token, needle[0]));
  }
  for (let i = 0; i <= hay.length - needle.length; i += 1) {
    if (needle.every((part, offset) => hay[i + offset] === part)) return true;
  }
  return false;
}

/** Token-sequence match — `luma` does not hit `luminance`. */
export function containsNamePhrase(text: string, phrases: string[]): boolean {
  if (!phrases.length) return false;
  const hay = tokenize(text);
  if (!hay.length) return false;
  return phrases.some((phrase) => phraseMatchesTokens(hay, tokenize(phrase)));
}

export function ownBrandPhrases(client: ClientConfig): string[] {
  // brand_headline is RSA copy, not a name. brand_terms is the list to
  // extend when the brand goes by more than display_name.
  return [client.display_name, ...client.promotion.brand_terms].filter(
    (phrase) => phrase.trim() !== "",
  );
}

export class BlockedTermsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedTermsParseError";
  }
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const terms: string[] = [];
  for (const row of value) {
    // A non-string entry means the note is not the shape we think it is —
    // an empty denylist is worse than a refused promote.
    if (typeof row !== "string") return null;
    const trimmed = row.trim();
    if (trimmed) terms.push(trimmed);
  }
  return terms;
}

function assertTermShape(terms: string[]): string[] {
  try {
    return assertNameList(terms, "blocked_terms");
  } catch (error) {
    throw new BlockedTermsParseError(
      error instanceof Error ? error.message : "blocked_terms invalid",
    );
  }
}

export function parseBlockedTerms(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const got = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A denylist has to be explicitly delimited. Every CSV/line heuristic
    // we tried admitted some label prefix that blocks nothing.
    throw new BlockedTermsParseError(
      `blocked_terms must be JSON: ["runway","kling ai"] or { "terms": ["runway"] } — got: "${got}"`,
    );
  }
  if (Array.isArray(parsed)) {
    const terms = stringList(parsed);
    if (terms) return assertTermShape(terms);
  } else if (parsed && typeof parsed === "object" && "terms" in parsed) {
    const terms = stringList(parsed.terms);
    if (terms) return assertTermShape(terms);
  }
  throw new BlockedTermsParseError(
    `blocked_terms JSON must be a string array or { terms: string[] } — got: "${got}"`,
  );
}

export function parseBrandJudgeContent(content: string): BrandVerdict | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(raw) as JudgePayload;
    if (!isBrandKind(parsed.kind)) return null;
    return {
      kind: parsed.kind,
      confidence: Number(parsed.confidence ?? 0),
      reason: parsed.reason ?? "",
    };
  } catch {
    return null;
  }
}

function applyCompetitorPolicy(
  client: ClientConfig,
  reason: string,
): BrandGuardDecision {
  if (client.promotion.competitor_policy === "safe_copy") {
    return {
      blocked: null,
      useTermAsHeadline: false,
      kind: "competitor_brand",
      reason,
    };
  }
  return {
    blocked: "competitor_brand",
    useTermAsHeadline: false,
    kind: "competitor_brand",
    reason,
  };
}

export async function assessPromoteBrandGuard(
  client: ClientConfig,
  input: {
    term: string;
    blockedTerms?: string[];
    judge?: BrandJudgeFn;
  },
): Promise<BrandGuardDecision> {
  const term = input.term.trim();
  if (!term) {
    return {
      blocked: "invalid_scope",
      useTermAsHeadline: false,
      kind: "generic",
      reason: "empty search term",
    };
  }

  if (containsNamePhrase(term, ownBrandPhrases(client))) {
    return {
      blocked: "own_brand",
      useTermAsHeadline: false,
      kind: "own_brand",
      reason: "term matches the client's brand — Brand campaign owns this",
    };
  }

  if (containsNamePhrase(term, input.blockedTerms ?? [])) {
    return {
      blocked: "competitor_brand",
      useTermAsHeadline: false,
      kind: "blocked_term",
      reason: "term is in blocked_terms memory — do not promote",
    };
  }

  if (containsNamePhrase(term, client.promotion.competitor_names)) {
    return applyCompetitorPolicy(
      client,
      "term matches promotion.competitor_names",
    );
  }

  const judge = input.judge ?? judgeBrandTerm;
  const verdict = await judge(client, term);
  if (verdict == null) {
    return {
      blocked: "classifier_unavailable",
      useTermAsHeadline: false,
      kind: "generic",
      reason: "brand judge unavailable — skip this promote",
    };
  }
  if (verdict.confidence < client.relevance.min_confidence) {
    if (verdict.kind === "generic") {
      // Not confident it is generic == might be a brand. Bid, but keep
      // an unverified term out of RSA headlines.
      return {
        blocked: null,
        useTermAsHeadline: false,
        kind: "generic",
        reason: verdict.reason || "low-confidence generic",
      };
    }
    return {
      blocked: "low_confidence",
      useTermAsHeadline: false,
      kind: verdict.kind,
      reason:
        verdict.reason ||
        "brand judge below min_confidence — skip this promote",
    };
  }
  if (verdict.kind === "own_brand") {
    return {
      blocked: "own_brand",
      useTermAsHeadline: false,
      kind: "own_brand",
      reason: verdict.reason || "own brand",
    };
  }
  if (verdict.kind === "competitor_brand") {
    return applyCompetitorPolicy(client, verdict.reason || "competitor brand");
  }
  return {
    blocked: null,
    useTermAsHeadline: true,
    kind: "generic",
    reason: verdict.reason || "generic",
  };
}

export async function judgeBrandTerm(
  client: ClientConfig,
  term: string,
): Promise<BrandVerdict | null> {
  const { Graphed } = await import("@graphed-inc/sdk");
  const graphed = new Graphed();
  if (!graphed.isConfigured()) return null;

  const { relevanceModel } = await import("./config");
  const own = ownBrandPhrases(client);
  const competitors = client.promotion.competitor_names.filter((name) =>
    name.trim(),
  );
  const response = await fetch(graphed.openRouter.chatCompletionsUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${graphed.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: relevanceModel(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify one Google Ads search term for brand impersonation risk. Reply with raw JSON only (no markdown): { kind, confidence, reason }. kind is generic, own_brand, or competitor_brand. confidence is 0-1.",
        },
        {
          role: "user",
          content: [
            `CLIENT: ${client.display_name}`,
            `PRODUCT: ${client.product_one_liner}`,
            "PRODUCT CONTEXT:",
            client.relevance.product_context,
            "",
            "kind=generic — category or job-to-be-done phrase, not a company or product name.",
            "kind=own_brand — the client's brand or product name.",
            "kind=competitor_brand — a third-party company, product, or well-known tool name.",
            "Do not treat generic category words as brands. Token-match names (luma ≠ luminance).",
            "",
            "KNOWN OWN BRAND TERMS:",
            own.length ? own.map((name) => `- ${name}`).join("\n") : "- (none)",
            "",
            "KNOWN COMPETITOR NAMES:",
            competitors.length
              ? competitors.map((name) => `- ${name}`).join("\n")
              : "- (none listed — still flag well-known third-party brands)",
            "",
            `TERM: ${term}`,
          ].join("\n"),
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;
  return parseBrandJudgeContent(content);
}
