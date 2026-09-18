import type { ClientConfig } from "../types";

export function sampleClient(
  overrides: Partial<ClientConfig> = {},
): ClientConfig {
  return {
    client_key: "default",
    display_name: "Graphed",
    product_one_liner: "AI analytics",
    google_ads: {
      customer_id: "8751573727",
      login_customer_id: "8751573727",
    },
    campaigns: {
      testing_campaign_id: "1",
      testing_campaign_name: "testing",
      winners_campaign_id: "2",
      winners_campaign_name: "winners",
      brand_protection_campaign_id: "3",
      brand_protection_campaign_name: "brand",
    },
    thresholds: {
      target_cpa: 150,
      min_conversions: 1,
      waste_min_spend: 25,
      lookback_days: 30,
      success_cpa_target: 250,
    },
    winners_guardrails: {
      target_cpa: 500,
      demote_min_spend: 300,
      demote_cpa_multiple: 2,
    },
    budget: {
      testing_share: 0.2,
      winners_share: 0.8,
      max_daily_shift_pct: 0.1,
      max_total_daily_budget: 600,
    },
    agent: {
      loop_owns_promotions: false,
      max_writes_per_run: 20,
      max_api_operations_per_run: 200,
    },
    safeguard: {
      impressions_drop_pct: 0.5,
      pacing_floor_pct: 0.5,
      recent_days: 3,
      baseline_days: 7,
      min_baseline_impressions: 50,
    },
    promotion: {
      landing_page_url: "https://www.graphed.com/",
      brand_headline: "Graphed",
      descriptions: ["Ask your data anything.", "Warehouse-native AI."],
      headline_pool: ["Ask Your Data Anything", "AI Analytics For Teams"],
      competitor_policy: "refuse",
      competitor_names: [],
      brand_terms: [],
    },
    relevance: {
      product_context: "Graphed is AI analytics software.",
      min_confidence: 0.6,
    },
    metrics: {
      googleAdsSchema: "google_ads_example",
    },
    writes: {
      enabled: false,
    },
    seed: {
      max_keywords: 25,
      min_search_volume: 10,
      match_type: "PHRASE",
      location_code: 2840,
      language_code: "en",
      testing_ad_group_id: "",
      target: "",
    },
    ...overrides,
  };
}
