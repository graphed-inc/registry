import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUnknownColumnError,
  isUnknownTableError,
  warehouseQueryAllowMissing,
  WarehouseQueryError,
  withWarehouseQuery,
} from "./warehouse";

describe("warehouse error shapes", () => {
  it("detects a missing table without matching SQL text", () => {
    assert.equal(
      isUnknownTableError(
        new Error(
          "Warehouse query failed: 400 Unknown table expression identifier 'google_ads_example.campaign_budget_history'",
        ),
      ),
      true,
    );
  });

  it("does not treat a 401 that echoes _fivetran_synced as a missing column", () => {
    assert.equal(
      isUnknownColumnError(
        new Error(
          "Warehouse query failed: 401 SELECT max(_fivetran_synced) FROM campaign_stats",
        ),
      ),
      false,
    );
  });

  it("detects a missing column identifier", () => {
    assert.equal(
      isUnknownColumnError(
        new Error(
          "Warehouse query failed: 400 Unknown expression identifier `foo`",
        ),
      ),
      true,
    );
  });

  it("matches unknown table on the unsliced body, not the 500-char message", () => {
    const body = `${"SELECT ".padEnd(520, "x")} Unknown table expression identifier 'campaign_criterion_history'`;
    const error = new WarehouseQueryError(400, body);
    assert.equal(error.message.includes("Unknown table"), false);
    assert.equal(isUnknownTableError(error), true);
  });

  it("matches unknown column on the unsliced body", () => {
    const body = `${"SELECT ".padEnd(520, "x")} Unknown expression identifier \`_fivetran_synced\``;
    const error = new WarehouseQueryError(400, body);
    assert.equal(isUnknownColumnError(error), true);
  });

  it("marks a missing table instead of returning a silent empty result", async () => {
    const result = await withWarehouseQuery(
      async () => {
        throw new Error("Unknown table expression identifier 'foo'");
      },
      () => warehouseQueryAllowMissing("SELECT 1"),
    );
    assert.equal(result.missingTable, true);
    assert.deepEqual(result.results, []);
  });
});
