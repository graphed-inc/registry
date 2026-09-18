import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  getWarehouseLagHours,
  resetCampaignStatsSyncedProbe,
} from "./scoreboard";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";

describe("loadCampaignStatsAsOf probe", () => {
  afterEach(() => {
    resetCampaignStatsSyncedProbe();
  });

  it("does not re-probe _fivetran_synced after an unknown-column miss", async () => {
    const sqls: string[] = [];
    await withWarehouseQuery(
      async (sql) => {
        sqls.push(sql);
        if (sql.includes("_fivetran_synced")) {
          throw new Error(
            "Unknown expression identifier `_fivetran_synced`",
          );
        }
        return {
          columns: ["max_d"],
          results: [{ max_d: "2026-09-17" }],
        };
      },
      async () => {
        await getWarehouseLagHours(sampleClient());
        await getWarehouseLagHours(sampleClient());
      },
    );

    assert.equal(
      sqls.filter((sql) => sql.includes("_fivetran_synced")).length,
      1,
    );
    assert.equal(sqls.filter((sql) => !sql.includes("_fivetran_synced")).length, 2);
  });
});
