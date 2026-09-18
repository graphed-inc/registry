import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listSearchTerms } from "./search-terms";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";

describe("listSearchTerms", () => {
  it("puts conversion and minSpend filters in HAVING, not WHERE", async () => {
    const sql: string[] = [];
    await withWarehouseQuery(async (query) => {
      sql.push(query);
      if (query.includes("max(toDate(date))")) {
        return { columns: [], results: [{ max_d: "2026-05-13" }] };
      }
      return { columns: [], results: [] };
    }, () =>
      listSearchTerms(sampleClient(), {
        campaign: "testing",
        lookbackDays: 30,
        sort: "conversions",
        conversions: "zero",
        minSpend: 25,
      }),
    );

    const hunt = sql.find((query) => query.includes("search_term AS term"));
    assert.ok(hunt);
    assert.match(hunt, /HAVING conversions = 0 AND spend >= 25/);
    assert.match(hunt, /toString\(campaign_id\) = '1'/);
  });

  it("quotes a dashed campaign id", async () => {
    const sql: string[] = [];
    await withWarehouseQuery(async (query) => {
      sql.push(query);
      if (query.includes("max(toDate(date))")) {
        return { columns: [], results: [{ max_d: "2026-05-13" }] };
      }
      return { columns: [], results: [] };
    }, () =>
      listSearchTerms(
        sampleClient({
          campaigns: {
            testing_campaign_id: "123-456-7890",
            testing_campaign_name: "testing",
            winners_campaign_id: "2",
            winners_campaign_name: "winners",
            brand_protection_campaign_id: "3",
            brand_protection_campaign_name: "brand",
          },
        }),
        {
          campaign: "testing",
          lookbackDays: 7,
          sort: "spend",
        },
      ),
    );

    const hunt = sql.find((query) => query.includes("search_term AS term"));
    assert.ok(hunt);
    assert.match(hunt, /toString\(campaign_id\) = '1234567890'/);
  });
});
