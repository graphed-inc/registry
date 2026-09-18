import { createAdsClient, type AdsClient } from "./client";
import { getServingHealth, type CampaignHealth } from "./health";
import { getWarehouseLagHours } from "./scoreboard";
import type { ClientConfig } from "./types";
import { writesEnabled } from "./types";

export type AgentRunContext = {
  client: ClientConfig;
  runId: string;
  dryRun: boolean;
  ads: AdsClient | null;
  writesUsed: number;
  health: { testing: CampaignHealth; winners: CampaignHealth } | null;
  warehouseLagHours?: number | null;
  /** True after this run has asked the warehouse for lag, including a miss. */
  warehouseLagChecked?: boolean;
};

export async function createRunContext(
  client: ClientConfig,
  runId: string,
): Promise<AgentRunContext> {
  return {
    client,
    runId,
    dryRun: !writesEnabled(client),
    ads: await createAdsClient(client, client.agent.max_api_operations_per_run),
    writesUsed: 0,
    health: null,
  };
}

export async function cachedHealth(
  ctx: AgentRunContext,
): Promise<{ testing: CampaignHealth; winners: CampaignHealth }> {
  ctx.health ??= await getServingHealth(ctx.client);
  return ctx.health;
}

export async function cachedWarehouseLagHours(
  ctx: AgentRunContext,
): Promise<number | null> {
  if (ctx.warehouseLagChecked) return ctx.warehouseLagHours ?? null;
  try {
    ctx.warehouseLagHours = await getWarehouseLagHours(ctx.client);
  } catch {
    ctx.warehouseLagHours = null;
  }
  ctx.warehouseLagChecked = true;
  return ctx.warehouseLagHours ?? null;
}
