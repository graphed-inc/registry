import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listCampaignBudgets } from "./account-state";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";

describe("listCampaignBudgets", () => {
  it("fills only the campaigns the warehouse omitted", async () => {
    let gaql = "";
    const ads = {
      search: async <T>(query: string): Promise<T[]> => {
        gaql = query;
        return [
          {
            campaign: { id: "3" },
            campaignBudget: {
              resourceName: "customers/8751573727/campaignBudgets/30",
              amountMicros: "10000000",
            },
          },
        ] as T[];
      },
    };

    const rows = await withWarehouseQuery(
      async () => ({
        columns: ["campaign_id", "budget_id", "amount_micros"],
        results: [
          { campaign_id: "1", budget_id: "10", amount_micros: 5_000_000 },
          { campaign_id: "2", budget_id: "20", amount_micros: 8_000_000 },
        ],
      }),
      () => listCampaignBudgets(sampleClient(), ["1", "2", "3"], ads),
    );

    assert.match(gaql, /campaign\.id IN \(3\)/);
    assert.deepEqual(
      rows.map((row) => ({ id: row.campaignId, daily: row.daily })),
      [
        { id: "1", daily: 5 },
        { id: "2", daily: 8 },
        { id: "3", daily: 10 },
      ],
    );
  });

  it("does not call Ads when every requested campaign is in the warehouse", async () => {
    let called = false;
    const ads = {
      search: async <T>(): Promise<T[]> => {
        called = true;
        return [];
      },
    };

    const rows = await withWarehouseQuery(
      async () => ({
        columns: ["campaign_id", "budget_id", "amount_micros"],
        results: [
          { campaign_id: "1", budget_id: "10", amount_micros: 5_000_000 },
        ],
      }),
      () => listCampaignBudgets(sampleClient(), ["1"], ads),
    );

    assert.equal(called, false);
    assert.equal(rows.length, 1);
  });

  it("falls back entirely when the budget table is missing", async () => {
    let gaql = "";
    const ads = {
      search: async <T>(query: string): Promise<T[]> => {
        gaql = query;
        return [
          {
            campaign: { id: "1" },
            campaignBudget: {
              resourceName: "customers/8751573727/campaignBudgets/10",
              amountMicros: "2000000",
            },
          },
        ] as T[];
      },
    };

    const rows = await withWarehouseQuery(
      async () => ({ columns: [], results: [], missingTable: true }),
      () => listCampaignBudgets(sampleClient(), ["1", "2"], ads),
    );

    assert.match(gaql, /campaign\.id IN \(1, 2\)/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.daily, 2);
  });
});
