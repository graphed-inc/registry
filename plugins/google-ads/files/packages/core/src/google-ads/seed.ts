import { classifyTerms, type TermVerdict } from "./classify";
import type { AdsClient } from "./client";
import { listKeywords, type KeywordNegative, type KeywordPositive } from "./keywords";
import {
  extractKeywordRows,
  filterResearchKeywords,
  researchSeedKeywords,
  type ResearchKeyword,
  type ResearchResult,
  type ResearchSource,
  type ToolsRunner,
} from "./research";
import { campaignId, type ClientConfig } from "./types";
import { seedTestingKeywords, type SeedWriteResult } from "./writes";

export type AccountKeywordSnapshot = {
  testing: { positives: KeywordPositive[]; negatives: KeywordNegative[] };
  winners: { positives: KeywordPositive[]; negatives: KeywordNegative[] };
};

/** Warehouse keywords already on Testing / Winners. Setup uses this before DataForSEO. */
export async function listAccountKeywordSnapshot(
  client: ClientConfig,
): Promise<AccountKeywordSnapshot> {
  const empty = { positives: [], negatives: [] };
  const [testing, winners] = await Promise.all([
    campaignId(client, "testing")
      ? listKeywords(client, "testing", "both")
      : Promise.resolve(empty),
    campaignId(client, "winners")
      ? listKeywords(client, "winners", "both")
      : Promise.resolve(empty),
  ]);
  return { testing, winners };
}

export type SeedPreview = {
  target: string;
  toolsUsed: string[];
  location_code: number;
  language_code: string;
  match_type: "PHRASE" | "BROAD";
  keywords: ResearchKeyword[];
  droppedOffIntent: ResearchKeyword[];
  classifierUnavailable: boolean;
  error?: string;
  seeded?: SeedWriteResult;
};

export type ClassifyFn = (
  client: ClientConfig,
  terms: string[],
) => Promise<TermVerdict[] | null>;

function keepOnIntent(
  keywords: ResearchKeyword[],
  verdicts: TermVerdict[] | null,
  minConfidence: number,
): { kept: ResearchKeyword[]; dropped: ResearchKeyword[] } {
  if (verdicts === null) {
    return { kept: keywords, dropped: [] };
  }
  const byTerm = new Map(
    verdicts.map((row) => [row.term.toLowerCase(), row] as const),
  );
  const kept: ResearchKeyword[] = [];
  const dropped: ResearchKeyword[] = [];
  for (const row of keywords) {
    const verdict = byTerm.get(row.term.toLowerCase());
    if (verdict && verdict.offIntent && verdict.confidence >= minConfidence) {
      dropped.push(row);
    } else {
      kept.push(row);
    }
  }
  return { kept, dropped };
}

export async function previewTestingSeeds(
  client: ClientConfig,
  input: {
    target?: string;
    limit?: number;
    run?: ToolsRunner;
    classify?: ClassifyFn;
    fromPayload?: { payload: unknown; source: ResearchSource };
  } = {},
): Promise<SeedPreview> {
  let research: ResearchResult;
  if (input.fromPayload) {
    const rows = extractKeywordRows(
      input.fromPayload.payload,
      input.fromPayload.source,
    );
    const keywords = filterResearchKeywords(rows, client).slice(
      0,
      input.limit ?? client.seed.max_keywords,
    );
    const reason =
      rows.length === 0
        ? "no keyword rows found in the payload — expected a keywords_for_site or keyword_ideas envelope"
        : `payload had ${rows.length} rows but none survived filtering (2+ tokens, not brand-only, known search volume >= ${client.seed.min_search_volume})`;
    research = {
      target: input.target ?? client.seed.target,
      toolsUsed: ["offline-json"],
      keywords,
      ...(keywords.length === 0
        ? { error: `${reason} — use --terms with a reviewed list` }
        : {}),
    };
  } else {
    research = await researchSeedKeywords(client, {
      target: input.target,
      limit: input.limit,
      run: input.run,
    });
  }

  const classify = input.classify ?? classifyTerms;
  const verdicts =
    research.keywords.length === 0
      ? []
      : await classify(
          client,
          research.keywords.map((row) => row.term),
        );
  const { kept, dropped } = keepOnIntent(
    research.keywords,
    verdicts,
    client.relevance.min_confidence,
  );

  return {
    target: research.target,
    toolsUsed: research.toolsUsed,
    location_code: client.seed.location_code,
    language_code: client.seed.language_code,
    match_type: client.seed.match_type,
    keywords: kept,
    droppedOffIntent: dropped,
    classifierUnavailable: verdicts === null,
    error: research.error,
  };
}

export async function applyTestingSeeds(
  ads: AdsClient,
  client: ClientConfig,
  preview: SeedPreview,
  dryRun: boolean,
): Promise<SeedPreview> {
  if (preview.keywords.length === 0) {
    return {
      ...preview,
      seeded: {
        ok: true,
        applied: false,
        dryRun,
        seeded: [],
        skipped: [],
        createdAdGroup: false,
        error: "nothing new to seed",
      },
    };
  }
  const seeded = await seedTestingKeywords(ads, client, {
    terms: preview.keywords.map((row) => row.term),
    dryRun,
  });
  return { ...preview, seeded };
}
