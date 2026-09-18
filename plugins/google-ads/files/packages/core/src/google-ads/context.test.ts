import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cachedWarehouseLagHours, type AgentRunContext } from "./context";
import { resetCampaignStatsSyncedProbe } from "./scoreboard";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";

function runContext(input?: {
  warehouseLagHours?: number | null;
  warehouseLagChecked?: boolean;
}): AgentRunContext {
  return {
    client: sampleClient(),
    runId: "run-1",
    dryRun: true,
    ads: null,
    writesUsed: 0,
    health: null,
    warehouseLagHours: input?.warehouseLagHours,
    warehouseLagChecked: input?.warehouseLagChecked,
  };
}

describe("cachedWarehouseLagHours", () => {
  afterEach(() => {
    resetCampaignStatsSyncedProbe();
  });

  it("does not treat an unchecked null as a known miss", async () => {
    const ctx = runContext({ warehouseLagHours: null });
    let calls = 0;
    const lag = await withWarehouseQuery(
      async () => {
        calls += 1;
        return {
          columns: ["max_d", "last_synced"],
          results: [
            { max_d: "2026-09-18", last_synced: "2026-09-18 20:00:00" },
          ],
        };
      },
      () => cachedWarehouseLagHours(ctx),
    );

    assert.equal(calls, 1);
    assert.equal(typeof lag, "number");
    assert.equal(ctx.warehouseLagChecked, true);
  });

  it("records a failed lag read so later writes do not re-query", async () => {
    const ctx = runContext();
    let calls = 0;
    const lag = await withWarehouseQuery(
      async () => {
        calls += 1;
        throw new Error("warehouse unavailable");
      },
      async () => {
        const first = await cachedWarehouseLagHours(ctx);
        const second = await cachedWarehouseLagHours(ctx);
        return { first, second };
      },
    );

    assert.equal(lag.first, null);
    assert.equal(lag.second, null);
    assert.equal(calls, 1);
    assert.equal(ctx.warehouseLagChecked, true);
  });

  it("reuses a finite cached lag without asking again", async () => {
    const ctx = runContext({
      warehouseLagHours: 3.5,
      warehouseLagChecked: true,
    });
    let calls = 0;
    const lag = await withWarehouseQuery(
      async () => {
        calls += 1;
        return { columns: [], results: [] };
      },
      () => cachedWarehouseLagHours(ctx),
    );

    assert.equal(lag, 3.5);
    assert.equal(calls, 0);
    assert.equal(ctx.warehouseLagChecked, true);
  });
});
