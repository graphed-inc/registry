import { asDateString, computeWarehouseLagHours, num } from "./dates";
import type { CampaignRole, ClientConfig } from "./types";
import { campaignRole } from "./types";
import {
  isUnknownColumnError,
  schemaFromClient,
  warehouseQuery,
} from "./warehouse";

export type ScoreboardRow = {
  windowDays: number;
  campaign: CampaignRole | "other";
  campaignId: string;
  campaignName?: string;
  adGroupId?: string;
  adGroupName?: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number | null;
};

export type Scoreboard = {
  generatedAt: string;
  asOfDate: string | null;
  warehouseLagHours: number | null;
  rows: ScoreboardRow[];
  daily: { date: string; spend: number; conversions: number }[];
};

const campaignStatsMissingSynced = new Set<string>();

/** Test seam — the daily process keeps the probe result per schema. */
export function resetCampaignStatsSyncedProbe(): void {
  campaignStatsMissingSynced.clear();
}

type AggRow = {
  campaign_id: string;
  campaign_name?: string;
  ad_group_id?: string;
  ad_group_name?: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

function toRow(
  client: ClientConfig,
  windowDays: number,
  row: AggRow,
): ScoreboardRow {
  const campaignId = String(row.campaign_id);
  const conversions = num(row.conversions);
  const spend = num(row.spend);
  return {
    windowDays,
    campaign: campaignRole(client, campaignId),
    campaignId,
    campaignName: row.campaign_name,
    adGroupId: row.ad_group_id ? String(row.ad_group_id) : undefined,
    adGroupName: row.ad_group_name,
    spend,
    clicks: num(row.clicks),
    impressions: num(row.impressions),
    conversions,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

async function loadCampaignStatsAsOf(schema: string): Promise<{
  max_d: unknown;
  last_synced: unknown;
}> {
  if (campaignStatsMissingSynced.has(schema)) {
    const result = await warehouseQuery(
      `SELECT max(toDate(date)) AS max_d FROM ${schema}.campaign_stats`,
    );
    return { max_d: result.results[0]?.max_d, last_synced: undefined };
  }
  try {
    const result = await warehouseQuery(
      `SELECT max(toDate(date)) AS max_d, max(_fivetran_synced) AS last_synced FROM ${schema}.campaign_stats`,
    );
    return {
      max_d: result.results[0]?.max_d,
      last_synced: result.results[0]?.last_synced,
    };
  } catch (error) {
    if (!isUnknownColumnError(error)) throw error;
    campaignStatsMissingSynced.add(schema);
    const result = await warehouseQuery(
      `SELECT max(toDate(date)) AS max_d FROM ${schema}.campaign_stats`,
    );
    return { max_d: result.results[0]?.max_d, last_synced: undefined };
  }
}

function emptyBoard(): Scoreboard {
  return {
    generatedAt: new Date().toISOString(),
    asOfDate: null,
    warehouseLagHours: null,
    rows: [],
    daily: [],
  };
}

/** Hours behind Fivetran sync and/or `max(date)`. Null if unknown. */
export async function getWarehouseLagHours(
  client: ClientConfig,
): Promise<number | null> {
  const schema = schemaFromClient(client);
  if (!schema) return null;
  const maxRes = await loadCampaignStatsAsOf(schema);
  return computeWarehouseLagHours({
    asOfDate: asDateString(maxRes.max_d),
    lastSynced: maxRes.last_synced,
  });
}

export async function getScoreboard(
  client: ClientConfig,
  windows: number[],
  groupBy: "campaign" | "ad_group",
): Promise<Scoreboard> {
  const schema = schemaFromClient(client);
  if (!schema) return emptyBoard();

  const maxRes = await loadCampaignStatsAsOf(schema);
  const asOf = asDateString(maxRes.max_d);
  const warehouseLagHours = computeWarehouseLagHours({
    asOfDate: asOf,
    lastSynced: maxRes.last_synced,
  });

  if (!asOf) {
    return { ...emptyBoard(), warehouseLagHours };
  }

  const sqlFor = (windowDays: number): string =>
    groupBy === "ad_group"
      ? `SELECT
            toString(a.campaign_id) AS campaign_id,
            any(h.name) AS campaign_name,
            toString(a.id) AS ad_group_id,
            any(ag.name) AS ad_group_name,
            sum(a.cost_micros)/1e6 AS spend,
            sum(a.clicks) AS clicks,
            sum(a.impressions) AS impressions,
            sum(a.conversions) AS conversions
          FROM ${schema}.ad_group_stats a
          LEFT JOIN ${schema}.campaign_history h
            ON h.id = a.campaign_id AND h._fivetran_active = 1
          LEFT JOIN ${schema}.ad_group_history ag
            ON ag.id = a.id AND ag._fivetran_active = 1
          WHERE toDate(a.date) > toDate('${asOf}') - ${windowDays}
            AND toDate(a.date) <= toDate('${asOf}')
          GROUP BY a.campaign_id, a.id`
      : `SELECT
            toString(s.id) AS campaign_id,
            any(h.name) AS campaign_name,
            sum(s.cost_micros)/1e6 AS spend,
            sum(s.clicks) AS clicks,
            sum(s.impressions) AS impressions,
            sum(s.conversions) AS conversions
          FROM ${schema}.campaign_stats s
          LEFT JOIN ${schema}.campaign_history h
            ON h.id = s.id AND h._fivetran_active = 1
          WHERE toDate(s.date) > toDate('${asOf}') - ${windowDays}
            AND toDate(s.date) <= toDate('${asOf}')
          GROUP BY s.id`;

  const [windowRows, dailyRes] = await Promise.all([
    Promise.all(
      windows.map(async (windowDays) => {
        const result = await warehouseQuery(sqlFor(windowDays));
        return result.results.map((row) =>
          toRow(client, windowDays, row as AggRow),
        );
      }),
    ),
    warehouseQuery(`SELECT
      toString(toDate(date)) AS date,
      sum(cost_micros)/1e6 AS spend,
      sum(conversions) AS conversions
    FROM ${schema}.campaign_stats
    WHERE toDate(date) > toDate('${asOf}') - 30 AND toDate(date) <= toDate('${asOf}')
    GROUP BY date
    ORDER BY date`),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: asOf,
    warehouseLagHours,
    rows: windowRows.flat(),
    daily: dailyRes.results.map((row) => ({
      date: String(row.date ?? ""),
      spend: num(row.spend),
      conversions: num(row.conversions),
    })),
  };
}
