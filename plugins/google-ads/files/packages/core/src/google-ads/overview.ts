import type { CampaignRole } from "./types";
import type { ScoreboardRow } from "./scoreboard";

export type KpiTotals = {
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number | null;
};

export function emptyTotals(): KpiTotals {
  return { spend: 0, clicks: 0, impressions: 0, conversions: 0, cpa: null };
}

export function sumRows(rows: ScoreboardRow[]): KpiTotals {
  const spend = rows.reduce((total, row) => total + row.spend, 0);
  const clicks = rows.reduce((total, row) => total + row.clicks, 0);
  const impressions = rows.reduce((total, row) => total + row.impressions, 0);
  const conversions = rows.reduce((total, row) => total + row.conversions, 0);
  return {
    spend,
    clicks,
    impressions,
    conversions,
    cpa: conversions > 0 ? spend / conversions : null,
  };
}

export function totalsForWindow(
  rows: ScoreboardRow[],
  windowDays: number,
): KpiTotals {
  return sumRows(rows.filter((row) => row.windowDays === windowDays));
}

export type CampaignBreakdown = {
  campaignId: string;
  campaign: CampaignRole | "other";
  campaignName: string;
  d7: KpiTotals;
  d30: KpiTotals;
};

export function campaignBreakdown(rows: ScoreboardRow[]): CampaignBreakdown[] {
  const ids = [...new Set(rows.map((row) => row.campaignId))];
  return ids
    .map((campaignId) => {
      const scoped = rows.filter((row) => row.campaignId === campaignId);
      const first = scoped[0];
      return {
        campaignId,
        campaign: first?.campaign ?? "other",
        campaignName: first?.campaignName || campaignId,
        d7: sumRows(scoped.filter((row) => row.windowDays === 7)),
        d30: sumRows(scoped.filter((row) => row.windowDays === 30)),
      };
    })
    .sort((a, b) => b.d30.spend - a.d30.spend);
}
