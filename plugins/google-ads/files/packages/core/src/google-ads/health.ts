import { getScoreboard, type ScoreboardRow } from "./scoreboard";
import type { ClientConfig } from "./types";
import { campaignId } from "./types";

export type CampaignHealth = {
  healthy: boolean;
  configured: boolean;
  impressionsRecent: number;
  impressionsBaseline: number;
  dropPct: number;
  pacingPct: number | null;
  reasons: string[];
};

function sumImpressions(
  rows: ScoreboardRow[],
  role: "testing" | "winners",
): number {
  return rows
    .filter((row) => row.campaign === role)
    .reduce((total, row) => total + row.impressions, 0);
}

function assess(
  client: ClientConfig,
  recent: ScoreboardRow[],
  baseline: ScoreboardRow[],
  role: "testing" | "winners",
): CampaignHealth {
  const cfg = client.safeguard;
  const impressionsRecent = sumImpressions(recent, role);
  const impressionsBaseline =
    sumImpressions(baseline, role) / Math.max(cfg.baseline_days, 1);
  const recentDaily = impressionsRecent / Math.max(cfg.recent_days, 1);
  const dropPct =
    impressionsBaseline > 0
      ? Math.max(0, 1 - recentDaily / impressionsBaseline)
      : 0;
  const reasons: string[] = [];
  if (
    impressionsBaseline >= cfg.min_baseline_impressions &&
    dropPct >= cfg.impressions_drop_pct
  ) {
    reasons.push(
      `impressions down ${(dropPct * 100).toFixed(0)}% vs ${cfg.baseline_days}d baseline`,
    );
  }
  return {
    healthy: reasons.length === 0,
    configured: true,
    impressionsRecent: recentDaily,
    impressionsBaseline,
    dropPct,
    pacingPct: null,
    reasons,
  };
}

export async function getServingHealth(client: ClientConfig): Promise<{
  testing: CampaignHealth;
  winners: CampaignHealth;
}> {
  const recentDays = client.safeguard.recent_days;
  const baselineDays = client.safeguard.baseline_days;
  const board = await getScoreboard(
    client,
    [recentDays, baselineDays],
    "campaign",
  );
  const recent = board.rows.filter((row) => row.windowDays === recentDays);
  const baseline = board.rows.filter((row) => row.windowDays === baselineDays);

  const unconfigured: CampaignHealth = {
    healthy: true,
    configured: false,
    impressionsRecent: 0,
    impressionsBaseline: 0,
    dropPct: 0,
    pacingPct: null,
    reasons: [],
  };

  return {
    testing: campaignId(client, "testing")
      ? assess(client, recent, baseline, "testing")
      : unconfigured,
    winners: campaignId(client, "winners")
      ? assess(client, recent, baseline, "winners")
      : unconfigured,
  };
}
