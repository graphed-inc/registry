import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleClient } from "./test/fixtures";
import { withWarehouseQuery } from "./warehouse";
import { parseBlockedTerms } from "./brand-guard";
import {
  RSA_MAX_HEADLINES,
  promoteSearchTerm,
  rsaHeadlineAssets,
} from "./writes";

function rsaHeadlineTexts(operations: unknown[]): string[] {
  const texts: string[] = [];
  for (const op of operations) {
    if (!op || typeof op !== "object") continue;
    if (!("adGroupAdOperation" in op)) continue;
    const adOp = op.adGroupAdOperation;
    if (!adOp || typeof adOp !== "object" || !("create" in adOp)) continue;
    const created = adOp.create;
    if (!created || typeof created !== "object" || !("ad" in created)) continue;
    const ad = created.ad;
    if (!ad || typeof ad !== "object" || !("responsiveSearchAd" in ad)) continue;
    const rsa = ad.responsiveSearchAd;
    if (!rsa || typeof rsa !== "object" || !("headlines" in rsa)) continue;
    const headlines = rsa.headlines;
    if (!Array.isArray(headlines)) continue;
    for (const row of headlines) {
      if (!row || typeof row !== "object" || !("text" in row)) continue;
      if (typeof row.text === "string") texts.push(row.text);
    }
  }
  return texts;
}

function warehouseForPromote(term: string) {
  return async (query: string) => {
    if (query.includes("max(toDate(date))")) {
      return { columns: [], results: [{ max_d: "2026-09-18" }] };
    }
    if (query.includes("search_term AS term")) {
      return {
        columns: [],
        results: [
          {
            term,
            campaign_id: "1",
            ad_group_id: "10",
            spend: 50,
            clicks: 10,
            impressions: 100,
            conversions: 2,
          },
        ],
      };
    }
    return { columns: [], results: [] };
  };
}

describe("rsaHeadlineAssets", () => {
  it("dedupes, pins the first, and caps at the Ads RSA limit", () => {
    const pool = Array.from({ length: 20 }, (_, index) => `Headline ${index + 1}`);
    const headlines = rsaHeadlineAssets(["Brand", "Brand", ...pool]);
    assert.equal(headlines.length, RSA_MAX_HEADLINES);
    assert.equal(headlines[0]?.pinnedField, "HEADLINE_1");
    assert.equal(headlines[0]?.text, "Brand");
    assert.equal(new Set(headlines.map((row) => row.text.toLowerCase())).size, 15);
  });
});

describe("promoteSearchTerm brand guard", () => {
  it("refuses a competitor brand before mutate", async () => {
    let mutated = 0;
    const ads = {
      search: async () => [],
      mutate: async () => {
        mutated += 1;
        return { resourceNames: ["x"] };
      },
    };
    const result = await withWarehouseQuery(
      warehouseForPromote("kling image to video"),
      () =>
        promoteSearchTerm(ads, sampleClient(), {
          term: "kling image to video",
          dryRun: true,
          loadBlocked: async () => [],
          judge: async () => ({
            kind: "competitor_brand",
            confidence: 0.95,
            reason: "Kling is a competitor",
          }),
        }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "competitor_brand");
    assert.equal(result.applied, false);
    assert.equal(mutated, 0);
  });

  it("safe_copy mutates without putting the competitor term in headlines", async () => {
    let operations: unknown[] = [];
    const ads = {
      search: async () => [],
      mutate: async (ops: unknown[]) => {
        operations = ops;
        return { resourceNames: ["x"] };
      },
    };
    const client = sampleClient({
      promotion: {
        ...sampleClient().promotion,
        competitor_policy: "safe_copy",
      },
    });
    const result = await withWarehouseQuery(
      warehouseForPromote("runway gen"),
      () =>
        promoteSearchTerm(ads, client, {
          term: "runway gen",
          dryRun: true,
          loadBlocked: async () => [],
          judge: async () => ({
            kind: "competitor_brand",
            confidence: 0.9,
            reason: "Runway",
          }),
        }),
    );
    assert.equal(result.ok, true);
    const headlines = rsaHeadlineTexts(operations);
    assert.ok(headlines.length >= 3);
    assert.equal(
      headlines.some((text) => text.toLowerCase().includes("runway")),
      false,
    );
    assert.equal(headlines[0], "Graphed");
  });

  it("pins a generic term as headline 1", async () => {
    let operations: unknown[] = [];
    const ads = {
      search: async () => [],
      mutate: async (ops: unknown[]) => {
        operations = ops;
        return { resourceNames: ["x"] };
      },
    };
    const result = await withWarehouseQuery(
      warehouseForPromote("ai analytics dashboard"),
      () =>
        promoteSearchTerm(ads, sampleClient(), {
          term: "ai analytics dashboard",
          dryRun: true,
          loadBlocked: async () => [],
          judge: async () => ({
            kind: "generic",
            confidence: 0.9,
            reason: "category",
          }),
        }),
    );
    assert.equal(result.ok, true);
    const headlines = rsaHeadlineTexts(operations);
    assert.equal(headlines[0], "ai analytics dashboard");
  });

  it("omits a low-confidence generic term from headlines but still mutates", async () => {
    let operations: unknown[] = [];
    const ads = {
      search: async () => [],
      mutate: async (ops: unknown[]) => {
        operations = ops;
        return { resourceNames: ["x"] };
      },
    };
    const result = await withWarehouseQuery(
      warehouseForPromote("maybe a brand maybe not"),
      () =>
        promoteSearchTerm(ads, sampleClient(), {
          term: "maybe a brand maybe not",
          dryRun: true,
          loadBlocked: async () => [],
          judge: async () => ({
            kind: "generic",
            confidence: 0.3,
            reason: "unsure",
          }),
        }),
    );
    assert.equal(result.ok, true);
    const headlines = rsaHeadlineTexts(operations);
    assert.equal(headlines[0], "Graphed");
    assert.equal(
      headlines.some((text) => text.toLowerCase().includes("maybe")),
      false,
    );
  });

  it("refuses when blocked_terms memory cannot be read", async () => {
    let mutated = 0;
    const ads = {
      search: async () => [],
      mutate: async () => {
        mutated += 1;
        return { resourceNames: ["x"] };
      },
    };
    const result = await withWarehouseQuery(
      warehouseForPromote("ai analytics dashboard"),
      () =>
        promoteSearchTerm(ads, sampleClient(), {
          term: "ai analytics dashboard",
          dryRun: true,
          loadBlocked: async () => {
            throw new Error("memory down");
          },
          judge: async () => ({
            kind: "generic",
            confidence: 0.9,
            reason: "category",
          }),
        }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "blocked_terms_unreadable");
    assert.equal(mutated, 0);
  });

  it("refuses when blocked_terms JSON is structurally invalid", async () => {
    const ads = {
      search: async () => [],
      mutate: async () => ({ resourceNames: ["x"] }),
    };
    const result = await withWarehouseQuery(
      warehouseForPromote("ai analytics dashboard"),
      () =>
        promoteSearchTerm(ads, sampleClient(), {
          term: "ai analytics dashboard",
          dryRun: true,
          loadBlocked: async () => parseBlockedTerms('{"blocked":["runway"]}'),
          judge: async () => ({
            kind: "generic",
            confidence: 0.9,
            reason: "category",
          }),
        }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.blocked, "blocked_terms_invalid");
  });
});
