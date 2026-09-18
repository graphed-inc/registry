import { AdsApiError, type AdsClient } from "./client";
import {
  cachedHealth,
  cachedWarehouseLagHours,
  type AgentRunContext,
} from "./context";
import { isWarehouseStale } from "./dates";
import { refuse, type WriteResult } from "./guards";
import { recordAction } from "./store";

export async function runWriteTool(
  ctx: AgentRunContext,
  input: {
    tool: string;
    payload: unknown;
    reason: string;
    campaign?: "testing" | "winners";
    skipSafeguard?: boolean;
  },
  fn: (ads: AdsClient) => Promise<WriteResult>,
): Promise<WriteResult> {
  const dryRun = ctx.dryRun;

  const finish = async (result: WriteResult): Promise<WriteResult> => {
    await recordAction({
      clientKey: ctx.client.client_key,
      runId: ctx.runId,
      tool: input.tool,
      payload: input.payload,
      result,
      dryRun,
      reason: input.reason,
    });
    return result;
  };

  if (!ctx.ads) {
    return finish(refuse("ads_credentials_missing", dryRun));
  }
  if (ctx.writesUsed >= ctx.client.agent.max_writes_per_run) {
    return finish(refuse("write_cap", dryRun));
  }

  if (!input.skipSafeguard) {
    const lagHours = await cachedWarehouseLagHours(ctx);
    if (isWarehouseStale(lagHours)) {
      return finish(
        refuse(
          "warehouse_stale",
          dryRun,
          `warehouse is ${Math.round(lagHours ?? 0)} hours behind`,
        ),
      );
    }

    const health = await cachedHealth(ctx);
    if (!health.testing.healthy && !health.winners.healthy) {
      return finish(
        refuse("safeguard", dryRun, "testing and winners both unhealthy"),
      );
    }
    if (input.campaign) {
      const snap =
        input.campaign === "testing" ? health.testing : health.winners;
      if (!snap.healthy) {
        return finish(refuse("safeguard", dryRun, snap.reasons.join("; ")));
      }
    }
  }

  try {
    const result = await fn(ctx.ads);
    if (result.ok && !result.blocked && !result.error) {
      ctx.writesUsed += 1;
    }
    return finish(result);
  } catch (error) {
    if (error instanceof AdsApiError && error.code === "api_budget") {
      return finish(refuse("api_budget", dryRun));
    }
    return finish({
      ok: false,
      applied: false,
      dryRun,
      error: error instanceof Error ? error.message : "write failed",
    });
  }
}
