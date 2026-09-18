import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listKeywords } from "./keywords";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";

describe("listKeywords", () => {
  it("filters REMOVED campaign negatives in the Ads fallback", async () => {
    let gaql = "";
    const ads = {
      search: async <T>(query: string): Promise<T[]> => {
        gaql = query;
        return [];
      },
    };

    await withWarehouseQuery(async (query) => {
      if (query.includes("campaign_criterion_history")) {
        return { columns: [], results: [], missingTable: true };
      }
      return { columns: [], results: [] };
    }, () => listKeywords(sampleClient(), "testing", "negatives", ads));

    assert.match(gaql, /campaign_criterion.status != 'REMOVED'/);
  });

  it("does not call Ads when campaign_criterion_history exists and is empty", async () => {
    let called = false;
    const ads = {
      search: async <T>(): Promise<T[]> => {
        called = true;
        return [];
      },
    };

    await withWarehouseQuery(
      async () => ({ columns: [], results: [] }),
      () => listKeywords(sampleClient(), "testing", "negatives", ads),
    );

    assert.equal(called, false);
  });
});
