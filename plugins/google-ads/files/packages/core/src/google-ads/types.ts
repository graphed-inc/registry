import { z } from "zod";
import { keepNameShaped, type DroppedNameList } from "./name-list";

const campaignIdsSchema = z.object({
  testing_campaign_id: z.string(),
  testing_campaign_name: z.string(),
  winners_campaign_id: z.string(),
  winners_campaign_name: z.string(),
  brand_protection_campaign_id: z.string(),
  brand_protection_campaign_name: z.string(),
});

// Not exported — parseClientConfig() is the only way in, so name lists
// are always shaped. ClientConfig is inferred from this below.
const clientConfigSchema = z.object({
  client_key: z.string().min(1),
  display_name: z.string().min(1),
  product_one_liner: z.string().min(1),
  google_ads: z.object({
    customer_id: z.string().min(1),
    login_customer_id: z.string().min(1),
  }),
  campaigns: campaignIdsSchema,
  thresholds: z.object({
    target_cpa: z.number(),
    min_conversions: z.number(),
    waste_min_spend: z.number(),
    lookback_days: z.number(),
    success_cpa_target: z.number(),
  }),
  winners_guardrails: z.object({
    target_cpa: z.number(),
    demote_min_spend: z.number(),
    demote_cpa_multiple: z.number(),
  }),
  budget: z.object({
    testing_share: z.number(),
    winners_share: z.number(),
    max_daily_shift_pct: z.number(),
    max_total_daily_budget: z.number(),
  }),
  agent: z.object({
    loop_owns_promotions: z.boolean(),
    max_writes_per_run: z.number(),
    max_api_operations_per_run: z.number(),
  }),
  safeguard: z.object({
    impressions_drop_pct: z.number(),
    pacing_floor_pct: z.number(),
    recent_days: z.number(),
    baseline_days: z.number(),
    min_baseline_impressions: z.number(),
  }),
  promotion: z.object({
    landing_page_url: z.string().url(),
    // RSA copy only — own-brand matching uses display_name + brand_terms.
    brand_headline: z.string(),
    descriptions: z.array(z.string()).min(2),
    headline_pool: z.array(z.string()).min(2),
    // refuse = do not bid (default). safe_copy = bid, but never put the
    // term in RSA headlines (Styleframe-style conquesting).
    competitor_policy: z.enum(["refuse", "safe_copy"]).default("refuse"),
    competitor_names: z.array(z.string()).default([]),
    brand_terms: z.array(z.string()).default([]),
  }),
  relevance: z.object({
    product_context: z.string().min(1),
    min_confidence: z.number(),
  }),
  metrics: z.object({
    googleAdsSchema: z.string(),
  }),
  writes: z.object({
    enabled: z.boolean(),
  }),
  seed: z.object({
    max_keywords: z.number().int().min(1).max(80),
    min_search_volume: z.number().int().min(0),
    match_type: z.enum(["PHRASE", "BROAD"]),
    location_code: z.number().int(),
    language_code: z.string().min(1),
    testing_ad_group_id: z.string(),
    target: z.string(),
  }),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;
export type LoadedClientConfig = ClientConfig & {
  nameListDrops: DroppedNameList[];
};
export type CampaignRole = "testing" | "winners" | "brand";

/**
 * Filter name lists here — not in the Zod transform — so drops hang
 * off the parsed object instead of a module global. loadClientConfig
 * and the dashboard already hold this value.
 */
export function parseClientConfig(raw: unknown): LoadedClientConfig {
  const parsed = clientConfigSchema.parse(raw);
  const competitor = keepNameShaped(
    parsed.promotion.competitor_names,
    "competitor_names",
  );
  const brand = keepNameShaped(parsed.promotion.brand_terms, "brand_terms");
  return {
    ...parsed,
    promotion: {
      ...parsed.promotion,
      competitor_names: competitor.kept,
      brand_terms: brand.kept,
    },
    nameListDrops: [
      { label: "competitor_names", entries: competitor.dropped },
      { label: "brand_terms", entries: brand.dropped },
    ].filter((row) => row.entries.length),
  };
}

export function campaignId(
  client: ClientConfig,
  role: CampaignRole,
): string | null {
  const id =
    role === "testing"
      ? client.campaigns.testing_campaign_id
      : role === "winners"
        ? client.campaigns.winners_campaign_id
        : client.campaigns.brand_protection_campaign_id;
  return id.trim() === "" ? null : id;
}

export function campaignRole(
  client: ClientConfig,
  id: string,
): CampaignRole | "other" {
  if (id === client.campaigns.testing_campaign_id) return "testing";
  if (id === client.campaigns.winners_campaign_id) return "winners";
  if (id === client.campaigns.brand_protection_campaign_id) return "brand";
  return "other";
}

export function normKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function writesEnabled(client: ClientConfig): boolean {
  return client.writes.enabled;
}
