import { asDateString, num } from "./dates";
import type { CampaignRole, ClientConfig } from "./types";
import { campaignId, campaignRole } from "./types";
import { quoteNumericId, schemaFromClient, warehouseQuery } from "./warehouse";

export type SearchTermRow = {
  term: string;
  campaign: CampaignRole | "other";
  campaignId: string;
  adGroupId: string | null;
  adGroupName: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number | null;
};

export type SearchTermConversions = "any" | "converters" | "zero";

export async function listSearchTerms(
  client: ClientConfig,
  input: {
    campaign: CampaignRole;
    lookbackDays: 7 | 30 | 90;
    sort: "spend" | "conversions" | "cpa";
    conversions?: SearchTermConversions;
    minSpend?: number;
    limit?: number;
  },
): Promise<SearchTermRow[]> {
  const schema = schemaFromClient(client);
  if (!schema) return [];

  const scopedId = campaignId(client, input.campaign);
  const maxRes = await warehouseQuery(
    `SELECT max(toDate(date)) AS max_d FROM ${schema}.search_term_keyword_stats`,
  );
  const asOf = asDateString(maxRes.results[0]?.max_d);
  if (!asOf) return [];

  const filters = [
    `toDate(date) > toDate('${asOf}') - ${input.lookbackDays}`,
    `toDate(date) <= toDate('${asOf}')`,
  ];
  if (scopedId) {
    filters.push(
      `toString(campaign_id) = '${quoteNumericId(scopedId, "campaign id")}'`,
    );
  }

  // ClickHouse treats `sum(conversions) AS conversions` as an aggregate in
  // WHERE. Aggregate filters belong in HAVING — including minSpend, or LIMIT
  // truncates before the spend floor is applied.
  const having: string[] = [];
  if (input.conversions === "converters") having.push("conversions > 0");
  if (input.conversions === "zero") having.push("conversions = 0");
  if (
    typeof input.minSpend === "number" &&
    Number.isFinite(input.minSpend)
  ) {
    having.push(`spend >= ${Number(input.minSpend)}`);
  }

  const order =
    input.sort === "conversions"
      ? "conversions DESC, spend DESC"
      : input.sort === "cpa"
        ? "if(conversions > 0, spend / conversions, 1e12) DESC"
        : "spend DESC";

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const havingSql = having.length > 0 ? `\n    HAVING ${having.join(" AND ")}` : "";
  const sql = `SELECT
      search_term AS term,
      toString(campaign_id) AS campaign_id,
      toString(ad_group_id) AS ad_group_id,
      sum(cost_micros)/1e6 AS spend,
      sum(clicks) AS clicks,
      sum(impressions) AS impressions,
      sum(conversions) AS conversions
    FROM ${schema}.search_term_keyword_stats
    WHERE ${filters.join(" AND ")}
    GROUP BY search_term, campaign_id, ad_group_id${havingSql}
    ORDER BY ${order}
    LIMIT ${limit}`;

  const result = await warehouseQuery(sql);
  return result.results.map((row) => {
    const spend = num(row.spend);
    const conversions = num(row.conversions);
    return {
      term: String(row.term ?? ""),
      campaign: campaignRole(client, String(row.campaign_id)),
      campaignId: String(row.campaign_id),
      adGroupId: row.ad_group_id ? String(row.ad_group_id) : null,
      adGroupName: null,
      spend,
      clicks: num(row.clicks),
      impressions: num(row.impressions),
      conversions,
      cpa: conversions > 0 ? spend / conversions : null,
    };
  });
}
