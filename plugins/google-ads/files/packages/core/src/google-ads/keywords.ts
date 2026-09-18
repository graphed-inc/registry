import type { AdsClient } from "./client";
import type { ClientConfig } from "./types";
import { campaignId } from "./types";
import {
  quoteNumericId,
  schemaFromClient,
  warehouseQuery,
  warehouseQueryAllowMissing,
} from "./warehouse";

export type KeywordPositive = {
  adGroupId: string;
  adGroupName: string;
  term: string;
  matchType: string;
  status: string;
};

export type KeywordNegative = {
  scope: "campaign" | "ad_group";
  adGroupId?: string;
  term: string;
  matchType: string;
  resourceName: string;
};

type AdsSearch = Pick<AdsClient, "search">;

type CampaignCriterionRow = {
  campaignCriterion?: {
    resourceName?: string;
    keyword?: { text?: string; matchType?: string };
  };
};

function customerId(client: ClientConfig): string {
  return quoteNumericId(client.google_ads.customer_id, "customer id");
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

/**
 * Current positives / negatives from Fivetran history
 * (`ad_group_criterion_history`, optional `campaign_criterion_history`).
 * Campaign-level negatives fall back to Ads search only when that
 * history table is not synced. A synced table with zero rows is trusted.
 * Resource names are reconstructed for Ads mutates when they come from
 * the warehouse.
 */
export async function listKeywords(
  client: ClientConfig,
  campaign: "testing" | "winners",
  kind: "positives" | "negatives" | "both",
  ads?: AdsSearch | null,
): Promise<{ positives: KeywordPositive[]; negatives: KeywordNegative[] }> {
  const id = campaignId(client, campaign);
  const schema = schemaFromClient(client);
  if (!id || !schema) return { positives: [], negatives: [] };

  const campaignKey = quoteNumericId(id, "campaign id");
  const customer = customerId(client);
  const positives: KeywordPositive[] = [];
  const negatives: KeywordNegative[] = [];

  if (kind === "positives" || kind === "both") {
    const result = await warehouseQuery(`SELECT
        toString(c.ad_group_id) AS ad_group_id,
        ag.name AS ad_group_name,
        toString(c.id) AS criterion_id,
        c.keyword_text AS term,
        ifNull(c.keyword_match_type, 'UNKNOWN') AS match_type,
        ifNull(c.status, 'UNKNOWN') AS status
      FROM ${schema}.ad_group_criterion_history c
      INNER JOIN ${schema}.ad_group_history ag
        ON ag.id = c.ad_group_id AND ag._fivetran_active = 1
      WHERE c._fivetran_active = 1
        AND toString(ag.campaign_id) = '${campaignKey}'
        AND c.keyword_text IS NOT NULL
        AND c.keyword_text != ''
        AND c.negative = 0
        AND upper(ifNull(c.status, '')) != 'REMOVED'`);
    for (const row of result.results) {
      const term = text(row, "term");
      if (!term) continue;
      positives.push({
        adGroupId: text(row, "ad_group_id"),
        adGroupName: text(row, "ad_group_name"),
        term,
        matchType: text(row, "match_type").toUpperCase() || "UNKNOWN",
        status: text(row, "status").toUpperCase() || "UNKNOWN",
      });
    }
  }

  if (kind === "negatives" || kind === "both") {
    const campaignRows = await warehouseQueryAllowMissing(`SELECT
        toString(c.id) AS criterion_id,
        c.keyword_text AS term,
        ifNull(c.keyword_match_type, 'UNKNOWN') AS match_type
      FROM ${schema}.campaign_criterion_history c
      WHERE c._fivetran_active = 1
        AND toString(c.campaign_id) = '${campaignKey}'
        AND c.keyword_text IS NOT NULL
        AND c.keyword_text != ''
        AND c.negative = 1
        AND upper(ifNull(c.status, '')) != 'REMOVED'`);
    for (const row of campaignRows.results) {
      const term = text(row, "term");
      const criterionId = text(row, "criterion_id");
      if (!term || !criterionId) continue;
      negatives.push({
        scope: "campaign",
        term,
        matchType: text(row, "match_type").toUpperCase() || "UNKNOWN",
        resourceName: `customers/${customer}/campaignCriteria/${campaignKey}~${criterionId}`,
      });
    }

    if (campaignRows.missingTable && ads) {
      const rows = await ads.search<CampaignCriterionRow>(`
        SELECT campaign_criterion.resource_name,
               campaign_criterion.keyword.text,
               campaign_criterion.keyword.match_type
        FROM campaign_criterion
        WHERE campaign.id = ${campaignKey}
          AND campaign_criterion.negative = TRUE
          AND campaign_criterion.type = 'KEYWORD'
          AND campaign_criterion.status != 'REMOVED'`);
      for (const row of rows) {
        const term = row.campaignCriterion?.keyword?.text;
        const resourceName = row.campaignCriterion?.resourceName;
        if (!term || !resourceName) continue;
        negatives.push({
          scope: "campaign",
          term,
          matchType:
            row.campaignCriterion?.keyword?.matchType?.toUpperCase() ||
            "UNKNOWN",
          resourceName,
        });
      }
    }

    const agRows = await warehouseQuery(`SELECT
        toString(c.ad_group_id) AS ad_group_id,
        toString(c.id) AS criterion_id,
        c.keyword_text AS term,
        ifNull(c.keyword_match_type, 'UNKNOWN') AS match_type
      FROM ${schema}.ad_group_criterion_history c
      INNER JOIN ${schema}.ad_group_history ag
        ON ag.id = c.ad_group_id AND ag._fivetran_active = 1
      WHERE c._fivetran_active = 1
        AND toString(ag.campaign_id) = '${campaignKey}'
        AND c.keyword_text IS NOT NULL
        AND c.keyword_text != ''
        AND c.negative = 1
        AND upper(ifNull(c.status, '')) != 'REMOVED'`);
    for (const row of agRows.results) {
      const term = text(row, "term");
      const adGroupId = text(row, "ad_group_id");
      const criterionId = text(row, "criterion_id");
      if (!term || !adGroupId || !criterionId) continue;
      negatives.push({
        scope: "ad_group",
        adGroupId,
        term,
        matchType: text(row, "match_type").toUpperCase() || "UNKNOWN",
        resourceName: `customers/${customer}/adGroupCriteria/${adGroupId}~${criterionId}`,
      });
    }
  }

  return { positives, negatives };
}
