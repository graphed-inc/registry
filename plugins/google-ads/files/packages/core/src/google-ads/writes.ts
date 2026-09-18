import { listCampaignBudgets, listEnabledAdGroups } from "./account-state";
import {
  assessPromoteBrandGuard,
  BlockedTermsParseError,
  parseBlockedTerms,
  type BrandJudgeFn,
} from "./brand-guard";
import type { AdsClient } from "./client";
import {
  addNegativeScopeError,
  blocksTargetKeyword,
  budgetCapExceeded,
  budgetStepExceeded,
  promoteLoopBlock,
  refuse,
  type WriteResult,
} from "./guards";
import { listKeywords } from "./keywords";
import { listSearchTerms } from "./search-terms";
import { campaignId, normKey, type ClientConfig } from "./types";

export type SeedSkip = { term: string; reason: string };

export type SeedWriteResult = WriteResult & {
  seeded: string[];
  skipped: SeedSkip[];
  adGroupId?: string;
  createdAdGroup: boolean;
};

function uniqueHeadlines(texts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const text = raw.slice(0, 30).trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export const RSA_MAX_HEADLINES = 15;

export function rsaHeadlineAssets(texts: string[]): { text: string; pinnedField?: string }[] {
  // Ads caps an RSA at 15 headlines; headline_pool has no upper bound.
  return uniqueHeadlines(texts)
    .slice(0, RSA_MAX_HEADLINES)
    .map((text, index) =>
      index === 0 ? { text, pinnedField: "HEADLINE_1" } : { text },
    );
}

function seedRefuse(
  blocked: WriteResult["blocked"],
  dryRun: boolean,
  error?: string,
): SeedWriteResult {
  return {
    ...refuse(blocked ?? "invalid_scope", dryRun, error),
    seeded: [],
    skipped: [],
    createdAdGroup: false,
  };
}

function cid(client: ClientConfig): string {
  return client.google_ads.customer_id.replace(/-/g, "");
}

export async function addNegative(
  ads: AdsClient,
  client: ClientConfig,
  input: {
    campaign: "testing" | "winners";
    scope: "campaign" | "ad_group";
    adGroupId?: string;
    term: string;
    matchType: "EXACT" | "PHRASE";
    dryRun: boolean;
  },
): Promise<WriteResult> {
  const scopeError = addNegativeScopeError(input.campaign, input.scope);
  if (scopeError) return refuse(scopeError, input.dryRun);

  const campaign = campaignId(client, input.campaign);
  if (!campaign) return refuse("campaigns_not_configured", input.dryRun);

  if (input.campaign === "winners") {
    if (!input.adGroupId) {
      return refuse("invalid_scope", input.dryRun, "adGroupId required");
    }
    const keywords = await listKeywords(client, "winners", "positives", ads);
    const targets = keywords.positives.filter(
      (row) => row.adGroupId === input.adGroupId,
    );
    if (targets.some((row) => blocksTargetKeyword(input.term, row.term))) {
      return refuse("blocks_target_keyword", input.dryRun);
    }
  }

  const existing = await listKeywords(client, input.campaign, "negatives", ads);
  const already = existing.negatives.some(
    (row) =>
      row.term.toLowerCase() === input.term.toLowerCase() &&
      row.matchType === input.matchType &&
      (input.scope === "campaign"
        ? row.scope === "campaign"
        : row.adGroupId === input.adGroupId),
  );
  if (already) {
    return {
      ok: true,
      applied: false,
      dryRun: input.dryRun,
      error: "already exists",
    };
  }

  const customer = cid(client);
  const operations =
    input.scope === "campaign"
      ? [
          {
            campaignCriterionOperation: {
              create: {
                campaign: `customers/${customer}/campaigns/${campaign}`,
                negative: true,
                keyword: { text: input.term, matchType: input.matchType },
              },
            },
          },
        ]
      : [
          {
            adGroupCriterionOperation: {
              create: {
                adGroup: `customers/${customer}/adGroups/${input.adGroupId}`,
                negative: true,
                keyword: { text: input.term, matchType: input.matchType },
              },
            },
          },
        ];

  const result = await ads.mutate(operations, input.dryRun);
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
  };
}

export async function removeNegative(
  ads: AdsClient,
  client: ClientConfig,
  input: {
    campaign: "testing" | "winners";
    resourceName: string;
    dryRun: boolean;
  },
): Promise<WriteResult> {
  const campaign = campaignId(client, input.campaign);
  if (!campaign) return refuse("campaigns_not_configured", input.dryRun);

  const existing = await listKeywords(client, input.campaign, "negatives", ads);
  const match = existing.negatives.find(
    (row) => row.resourceName === input.resourceName,
  );
  if (!match) {
    return refuse(
      "invalid_scope",
      input.dryRun,
      "resourceName not on this campaign",
    );
  }

  const isCampaign = match.scope === "campaign";
  const operations = isCampaign
    ? [{ campaignCriterionOperation: { remove: input.resourceName } }]
    : [{ adGroupCriterionOperation: { remove: input.resourceName } }];
  const result = await ads.mutate(operations, input.dryRun);
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
  };
}

export type LoadBlockedTerms = (clientKey: string) => Promise<string[]>;

async function defaultLoadBlockedTerms(clientKey: string): Promise<string[]> {
  const { memoryGet } = await import("./store");
  const items = await memoryGet(clientKey, ["blocked_terms"]);
  return parseBlockedTerms(items[0]?.value ?? "");
}

async function loadBlockedPromoteTerms(
  clientKey: string,
  loadBlocked?: LoadBlockedTerms,
): Promise<
  { ok: true; terms: string[] } | { ok: false; blocked: "blocked_terms_unreadable" | "blocked_terms_invalid"; error: string }
> {
  try {
    const terms = await (loadBlocked ?? defaultLoadBlockedTerms)(clientKey);
    return { ok: true, terms };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "memory read failed";
    if (error instanceof BlockedTermsParseError) {
      return { ok: false, blocked: "blocked_terms_invalid", error: message };
    }
    return {
      ok: false,
      blocked: "blocked_terms_unreadable",
      error: `could not read blocked_terms: ${message}`,
    };
  }
}

export async function promoteSearchTerm(
  ads: AdsClient,
  client: ClientConfig,
  input: {
    term: string;
    dryRun: boolean;
    judge?: BrandJudgeFn;
    loadBlocked?: LoadBlockedTerms;
  },
): Promise<WriteResult> {
  const loopBlock = promoteLoopBlock(client.agent.loop_owns_promotions);
  if (loopBlock) return refuse(loopBlock, input.dryRun);
  const testing = campaignId(client, "testing");
  const winners = campaignId(client, "winners");
  if (!testing || !winners) {
    return refuse("campaigns_not_configured", input.dryRun);
  }

  const existing = await listKeywords(client, "winners", "both", ads);
  if (
    existing.positives.some(
      (row) => row.term.toLowerCase() === input.term.toLowerCase(),
    )
  ) {
    return {
      ok: true,
      applied: false,
      dryRun: input.dryRun,
      error: "already a Winners keyword",
    };
  }
  if (
    existing.negatives.some(
      (row) => row.term.toLowerCase() === input.term.toLowerCase(),
    )
  ) {
    return refuse(
      "invalid_scope",
      input.dryRun,
      "blocked by an existing Winners negative",
    );
  }

  const converters = await listSearchTerms(client, {
    campaign: "testing",
    lookbackDays: 30,
    sort: "conversions",
    conversions: "converters",
    limit: 100,
  });
  const match = converters.find(
    (row) => row.term.toLowerCase() === input.term.toLowerCase(),
  );
  if (!match || match.conversions < client.thresholds.min_conversions) {
    return refuse(
      "below_threshold",
      input.dryRun,
      "not enough conversions on Testing in the last 30 days",
    );
  }
  if (match.cpa != null && match.cpa > client.thresholds.target_cpa) {
    return refuse(
      "below_threshold",
      input.dryRun,
      `CPA ${match.cpa.toFixed(2)} is above the ${client.thresholds.target_cpa} promotion bar`,
    );
  }

  const loaded = await loadBlockedPromoteTerms(
    client.client_key,
    input.loadBlocked,
  );
  if (!loaded.ok) {
    return refuse(loaded.blocked, input.dryRun, loaded.error);
  }
  const brandGuard = await assessPromoteBrandGuard(client, {
    term: input.term,
    blockedTerms: loaded.terms,
    judge: input.judge,
  });
  if (brandGuard.blocked) {
    return refuse(brandGuard.blocked, input.dryRun, brandGuard.reason);
  }

  const customer = cid(client);
  const headlineSource = brandGuard.useTermAsHeadline
    ? [input.term, client.promotion.brand_headline, ...client.promotion.headline_pool]
    : [client.promotion.brand_headline, ...client.promotion.headline_pool];
  const headlines = rsaHeadlineAssets(headlineSource);
  if (headlines.length < 3) {
    return refuse(
      "invalid_scope",
      input.dryRun,
      brandGuard.useTermAsHeadline
        ? "need 3 unique RSA headlines (term + brand_headline + headline_pool)"
        : "need 3 unique RSA headlines (brand_headline + headline_pool)",
    );
  }
  const operations = [
    {
      campaignCriterionOperation: {
        create: {
          campaign: `customers/${customer}/campaigns/${testing}`,
          negative: true,
          keyword: { text: input.term, matchType: "EXACT" },
        },
      },
    },
    {
      adGroupOperation: {
        create: {
          resourceName: `customers/${customer}/adGroups/-1`,
          name: `EXACT | ${input.term}`.slice(0, 255),
          campaign: `customers/${customer}/campaigns/${winners}`,
          status: "ENABLED",
          type: "SEARCH_STANDARD",
        },
      },
    },
    {
      adGroupCriterionOperation: {
        create: {
          adGroup: `customers/${customer}/adGroups/-1`,
          status: "ENABLED",
          keyword: { text: input.term, matchType: "EXACT" },
        },
      },
    },
    {
      adGroupAdOperation: {
        create: {
          adGroup: `customers/${customer}/adGroups/-1`,
          status: "ENABLED",
          ad: {
            finalUrls: [client.promotion.landing_page_url],
            responsiveSearchAd: {
              headlines,
              descriptions: client.promotion.descriptions
                .slice(0, 2)
                .map((text) => ({
                  text: text.slice(0, 90),
                })),
            },
          },
        },
      },
    },
  ];
  const result = await ads.mutate(operations, input.dryRun);
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
  };
}

export async function pauseAdGroup(
  ads: AdsClient,
  client: ClientConfig,
  input: { adGroupId: string; dryRun: boolean },
): Promise<WriteResult> {
  const winners = campaignId(client, "winners");
  if (!winners) return refuse("campaigns_not_configured", input.dryRun);

  const enabled = await listEnabledAdGroups(client, winners);
  if (enabled.length <= 1) return refuse("last_winners_group", input.dryRun);

  const customer = cid(client);
  const result = await ads.mutate(
    [
      {
        adGroupOperation: {
          update: {
            resourceName: `customers/${customer}/adGroups/${input.adGroupId}`,
            status: "PAUSED",
          },
          updateMask: "status",
        },
      },
    ],
    input.dryRun,
  );
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
  };
}

export async function rebalanceBudgets(
  ads: AdsClient,
  client: ClientConfig,
  input: { testingDaily: number; winnersDaily: number; dryRun: boolean },
): Promise<WriteResult> {
  const testing = campaignId(client, "testing");
  const winners = campaignId(client, "winners");
  if (!testing || !winners) {
    return refuse("campaigns_not_configured", input.dryRun);
  }

  const brand = campaignId(client, "brand");
  const rows = await listCampaignBudgets(
    client,
    [testing, winners, ...(brand ? [brand] : [])],
    ads,
  );

  const current = (id: string) =>
    rows.find((item) => item.campaignId === id)?.daily ?? 0;
  const brandDaily = brand ? current(brand) : 0;

  if (
    budgetCapExceeded(
      input.testingDaily,
      input.winnersDaily,
      brandDaily,
      client.budget.max_total_daily_budget,
    )
  ) {
    return refuse("budget_cap", input.dryRun);
  }
  if (
    budgetStepExceeded(
      current(testing),
      input.testingDaily,
      client.budget.max_daily_shift_pct,
    ) ||
    budgetStepExceeded(
      current(winners),
      input.winnersDaily,
      client.budget.max_daily_shift_pct,
    )
  ) {
    return refuse("budget_step", input.dryRun);
  }

  const resource = (id: string) =>
    rows.find((item) => item.campaignId === id)?.resourceName;

  const testingBudget = resource(testing);
  const winnersBudget = resource(winners);
  if (!testingBudget || !winnersBudget) {
    return refuse(
      "invalid_scope",
      input.dryRun,
      "could not resolve campaign budgets",
    );
  }

  const result = await ads.mutate(
    [
      {
        campaignBudgetOperation: {
          update: {
            resourceName: testingBudget,
            amountMicros: Math.round(input.testingDaily * 1_000_000),
          },
          updateMask: "amount_micros",
        },
      },
      {
        campaignBudgetOperation: {
          update: {
            resourceName: winnersBudget,
            amountMicros: Math.round(input.winnersDaily * 1_000_000),
          },
          updateMask: "amount_micros",
        },
      },
    ],
    input.dryRun,
  );
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
  };
}

const DISCOVERY_AD_GROUP = "Discovery";

function validSeedText(term: string): boolean {
  const text = term.trim();
  if (text.length === 0 || text.length > 80) return false;
  return text.split(/\s+/).length <= 10;
}

/**
 * Attach researched keywords to Testing. Reuses an existing enabled ad
 * group (or seed.testing_ad_group_id). If Testing has none, creates a
 * Discovery group + RSA in the same mutate. Skips terms already present
 * as positives or negatives. Cold-start path — warehouse may be empty.
 */
export async function seedTestingKeywords(
  ads: AdsClient,
  client: ClientConfig,
  input: { terms: string[]; dryRun: boolean },
): Promise<SeedWriteResult> {
  const testing = campaignId(client, "testing");
  if (!testing) return seedRefuse("campaigns_not_configured", input.dryRun);

  const existing = await listKeywords(client, "testing", "both", ads);
  const existingPositives = new Set(
    existing.positives.map((row) => normKey(row.term)),
  );
  const existingNegatives = new Set(
    existing.negatives.map((row) => normKey(row.term)),
  );

  const skipped: SeedSkip[] = [];
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.terms) {
    const term = normKey(raw);
    if (!term || !validSeedText(term)) {
      skipped.push({ term: raw, reason: "invalid keyword text" });
      continue;
    }
    if (seen.has(term)) {
      skipped.push({ term, reason: "duplicate in batch" });
      continue;
    }
    seen.add(term);
    if (existingPositives.has(term)) {
      skipped.push({ term, reason: "already a Testing positive" });
      continue;
    }
    if (existingNegatives.has(term)) {
      skipped.push({ term, reason: "blocked by a Testing negative" });
      continue;
    }
    unique.push(term);
  }

  const toCreate = unique.slice(0, client.seed.max_keywords);
  for (const term of unique.slice(client.seed.max_keywords)) {
    skipped.push({ term, reason: "over seed.max_keywords" });
  }

  if (toCreate.length === 0) {
    return {
      ok: true,
      applied: false,
      dryRun: input.dryRun,
      seeded: [],
      skipped,
      createdAdGroup: false,
      error: "nothing new to seed",
    };
  }

  const configuredGroup = client.seed.testing_ad_group_id.trim();
  const enabled = await listEnabledAdGroups(client, testing);
  const existingGroupId = configuredGroup || enabled[0]?.adGroupId || "";
  const createGroup = existingGroupId === "";

  const customer = cid(client);
  const adGroupResource = createGroup
    ? `customers/${customer}/adGroups/-1`
    : `customers/${customer}/adGroups/${existingGroupId}`;

  const operations: unknown[] = [];
  if (createGroup) {
    const headlines = rsaHeadlineAssets([
      client.promotion.brand_headline,
      ...client.promotion.headline_pool,
    ]);
    if (headlines.length < 3) {
      return {
        ok: false,
        applied: false,
        dryRun: input.dryRun,
        seeded: [],
        skipped,
        createdAdGroup: false,
        error:
          "need 3 unique RSA headlines (brand_headline + headline_pool)",
      };
    }
    operations.push(
      {
        adGroupOperation: {
          create: {
            resourceName: adGroupResource,
            name: DISCOVERY_AD_GROUP,
            campaign: `customers/${customer}/campaigns/${testing}`,
            status: "ENABLED",
            type: "SEARCH_STANDARD",
          },
        },
      },
      {
        adGroupAdOperation: {
          create: {
            adGroup: adGroupResource,
            status: "ENABLED",
            ad: {
              finalUrls: [client.promotion.landing_page_url],
              responsiveSearchAd: {
                headlines,
                descriptions: client.promotion.descriptions
                  .slice(0, 2)
                  .map((text) => ({ text: text.slice(0, 90) })),
              },
            },
          },
        },
      },
    );
  }

  for (const term of toCreate) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: adGroupResource,
          status: "ENABLED",
          keyword: { text: term, matchType: client.seed.match_type },
        },
      },
    });
  }

  const result = await ads.mutate(operations, input.dryRun);
  return {
    ok: true,
    applied: !input.dryRun,
    dryRun: input.dryRun,
    resourceNames: result.resourceNames,
    seeded: toCreate,
    skipped,
    adGroupId: existingGroupId || undefined,
    createdAdGroup: createGroup,
  };
}
