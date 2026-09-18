import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessPromoteBrandGuard,
  containsNamePhrase,
  parseBlockedTerms,
  parseBrandJudgeContent,
  tokenize,
} from "./brand-guard";
import { parseClientConfig } from "./types";
import { sampleClient } from "./test/fixtures";

describe("tokenize / containsNamePhrase", () => {
  it("matches a name as a token, not a substring", () => {
    assert.equal(containsNamePhrase("luma ai generator", ["luma"]), true);
    assert.equal(containsNamePhrase("luminance map", ["luma"]), false);
    assert.equal(containsNamePhrase("klingai prompts", ["kling"]), true);
    assert.equal(containsNamePhrase("runway gen3", ["runway"]), true);
  });

  it("matches a multi-token phrase in order", () => {
    assert.equal(containsNamePhrase("adobe firefly video", ["adobe firefly"]), true);
    assert.equal(containsNamePhrase("adobe stock photos", ["adobe firefly"]), false);
  });

  it("strips punctuation", () => {
    assert.deepEqual(tokenize("Kling-AI!"), ["kling", "ai"]);
  });
});

describe("parseBlockedTerms", () => {
  it("reads a JSON array or { terms } list", () => {
    assert.deepEqual(parseBlockedTerms('["Runway","Kling AI"]'), [
      "Runway",
      "Kling AI",
    ]);
    assert.deepEqual(parseBlockedTerms(""), []);
    assert.deepEqual(parseBlockedTerms('{"terms":["acme","Runway"]}'), [
      "acme",
      "Runway",
    ]);
    assert.deepEqual(parseBlockedTerms('["adobe premiere pro cc"]'), [
      "adobe premiere pro cc",
    ]);
    assert.deepEqual(parseBlockedTerms('{"terms":["procter and gamble"]}'), [
      "procter and gamble",
    ]);
    assert.deepEqual(parseBlockedTerms('{"terms":["DoNotPay"]}'), ["DoNotPay"]);
    assert.deepEqual(parseBlockedTerms('{"terms":["Not Just Travel"]}'), [
      "Not Just Travel",
    ]);
    assert.deepEqual(parseBlockedTerms('{"terms":["Because Animals"]}'), [
      "Because Animals",
    ]);
  });

  it("refuses a non-JSON note", () => {
    assert.throws(
      () => parseBlockedTerms("runway, kling"),
      /must be JSON.*runway, kling/,
    );
    assert.throws(
      () => parseBlockedTerms("Competitors - Runway, Kling, Luma"),
      /must be JSON/,
    );
    assert.throws(
      () => parseBlockedTerms("Blocked brands runway, kling"),
      /must be JSON/,
    );
    assert.throws(
      () => parseBlockedTerms('{"terms": ["runway", "kling ai",]}'),
      /must be JSON/,
    );
  });

  it("rejects a JSON instruction that would never match a search term", () => {
    assert.throws(
      () => parseBlockedTerms('{"terms":["do not promote runway"]}'),
      /instruction, not a name/,
    );
    assert.throws(
      () =>
        parseBlockedTerms('{"terms":["do not promote runway or kling"]}'),
      /instruction, not a name/,
    );
  });

  it("rejects a JSON object that is not a terms list", () => {
    assert.throws(
      () => parseBlockedTerms('{"foo":1}'),
      /got: "\{"foo":1\}"/,
    );
  });

  it("rejects JSON arrays that are not all strings", () => {
    assert.throws(() => parseBlockedTerms("[1, 2]"), /string array/);
    assert.throws(
      () => parseBlockedTerms('{"terms":[{"term":"runway","why":"competitor"}]}'),
      /string array/,
    );
    assert.throws(() => parseBlockedTerms('["runway", 123]'), /string array/);
  });
});

describe("parseBrandJudgeContent", () => {
  it("reads raw and fenced JSON", () => {
    const raw = parseBrandJudgeContent(
      '{"kind":"competitor_brand","confidence":0.9,"reason":"Runway"}',
    );
    assert.equal(raw?.kind, "competitor_brand");
    assert.equal(raw?.confidence, 0.9);

    const fenced = parseBrandJudgeContent(
      '```json\n{"kind":"generic","confidence":0.8,"reason":"category"}\n```',
    );
    assert.equal(fenced?.kind, "generic");
  });

  it("rejects an unknown kind", () => {
    assert.equal(
      parseBrandJudgeContent('{"kind":"maybe","confidence":1,"reason":"x"}'),
      null,
    );
  });
});

describe("assessPromoteBrandGuard", () => {
  const genericJudge = async () => ({
    kind: "generic" as const,
    confidence: 0.95,
    reason: "category",
  });

  it("refuses an own-brand token without calling the judge", async () => {
    let judged = false;
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "graphed analytics",
      judge: async () => {
        judged = true;
        return { kind: "generic", confidence: 1, reason: "should not run" };
      },
    });
    assert.equal(decision.blocked, "own_brand");
    assert.equal(decision.useTermAsHeadline, false);
    assert.equal(judged, false);
  });

  it("refuses a blocked_terms hit even under safe_copy", async () => {
    const decision = await assessPromoteBrandGuard(
      sampleClient({
        promotion: {
          ...sampleClient().promotion,
          competitor_policy: "safe_copy",
        },
      }),
      {
        term: "runway gen",
        blockedTerms: ["runway"],
        judge: genericJudge,
      },
    );
    assert.equal(decision.blocked, "competitor_brand");
    assert.equal(decision.kind, "blocked_term");
    assert.equal(decision.useTermAsHeadline, false);
  });

  it("refuses a competitor_names hit by default", async () => {
    const decision = await assessPromoteBrandGuard(
      sampleClient({
        promotion: {
          ...sampleClient().promotion,
          competitor_names: ["runway"],
        },
      }),
      { term: "runway video", judge: genericJudge },
    );
    assert.equal(decision.blocked, "competitor_brand");
    assert.equal(decision.useTermAsHeadline, false);
  });

  it("safe_copy keeps the bid and strips the term from headlines", async () => {
    const decision = await assessPromoteBrandGuard(
      sampleClient({
        promotion: {
          ...sampleClient().promotion,
          competitor_policy: "safe_copy",
          competitor_names: ["runway"],
        },
      }),
      { term: "runway video", judge: genericJudge },
    );
    assert.equal(decision.blocked, null);
    assert.equal(decision.useTermAsHeadline, false);
    assert.equal(decision.kind, "competitor_brand");
  });

  it("allows a generic term and uses it as a headline", async () => {
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "ai analytics dashboard",
      judge: genericJudge,
    });
    assert.equal(decision.blocked, null);
    assert.equal(decision.useTermAsHeadline, true);
    assert.equal(decision.kind, "generic");
  });

  it("refuses when the judge is down", async () => {
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "mystery tool",
      judge: async () => null,
    });
    assert.equal(decision.blocked, "classifier_unavailable");
    assert.equal(decision.useTermAsHeadline, false);
  });

  it("refuses a low-confidence competitor instead of promoting", async () => {
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "maybe runway",
      judge: async () => ({
        kind: "competitor_brand",
        confidence: 0.2,
        reason: "unsure",
      }),
    });
    assert.equal(decision.blocked, "low_confidence");
  });

  it("bids a low-confidence generic term without using it as a headline", async () => {
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "maybe a brand maybe not",
      judge: async () => ({
        kind: "generic",
        confidence: 0.3,
        reason: "unsure",
      }),
    });
    assert.equal(decision.blocked, null);
    assert.equal(decision.useTermAsHeadline, false);
  });

  it("does not treat brand_headline RSA copy as an own-brand name", async () => {
    let judged = false;
    const decision = await assessPromoteBrandGuard(
      sampleClient({
        display_name: "Acme",
        promotion: {
          ...sampleClient().promotion,
          brand_headline: "Smart Analytics",
        },
      }),
      {
        term: "smart analytics tools",
        judge: async () => {
          judged = true;
          return { kind: "generic", confidence: 0.95, reason: "category" };
        },
      },
    );
    assert.equal(judged, true);
    assert.equal(decision.blocked, null);
    assert.equal(decision.useTermAsHeadline, true);
  });

  it("matches extra own-brand aliases from brand_terms", async () => {
    const decision = await assessPromoteBrandGuard(
      sampleClient({
        display_name: "Acme",
        promotion: {
          ...sampleClient().promotion,
          brand_terms: ["widgetly"],
        },
      }),
      {
        term: "widgetly dashboard",
        judge: async () => ({
          kind: "generic",
          confidence: 1,
          reason: "should not run",
        }),
      },
    );
    assert.equal(decision.blocked, "own_brand");
  });

  it("applies a confident LLM competitor verdict", async () => {
    const decision = await assessPromoteBrandGuard(sampleClient(), {
      term: "kling image to video",
      judge: async () => ({
        kind: "competitor_brand",
        confidence: 0.92,
        reason: "Kling is a video model",
      }),
    });
    assert.equal(decision.blocked, "competitor_brand");
    assert.equal(decision.reason, "Kling is a video model");
  });
});

describe("parseClientConfig promotion defaults", () => {
  it("defaults competitor_policy to refuse when omitted", () => {
    const client = sampleClient();
    const { competitor_policy, competitor_names, brand_terms, ...promotion } =
      client.promotion;
    const parsed = parseClientConfig({
      ...client,
      promotion,
    });
    assert.equal(parsed.promotion.competitor_policy, "refuse");
    assert.deepEqual(parsed.promotion.competitor_names, []);
    assert.deepEqual(parsed.promotion.brand_terms, []);
    assert.deepEqual(parsed.nameListDrops, []);
    assert.equal(competitor_policy, "refuse");
    assert.deepEqual(competitor_names, []);
    assert.deepEqual(brand_terms, []);
  });

  it("drops prose competitor_names or brand_terms without failing config load", () => {
    const client = sampleClient();
    const original = console.warn;
    console.warn = () => {};
    try {
      const parsed = parseClientConfig({
        ...client,
        promotion: {
          ...client.promotion,
          competitor_names: [
            "do not promote runway",
            "Runway",
            "Never Fully Dressed",
          ],
          brand_terms: ["the official product name here", "conduit"],
        },
      });
      assert.deepEqual(parsed.promotion.competitor_names, ["Runway"]);
      assert.deepEqual(parsed.promotion.brand_terms, ["conduit"]);
      assert.deepEqual(parsed.nameListDrops, [
        {
          label: "competitor_names",
          entries: ["do not promote runway", "Never Fully Dressed"],
        },
        {
          label: "brand_terms",
          entries: ["the official product name here"],
        },
      ]);
    } finally {
      console.warn = original;
    }
  });

  it("accepts short competitor_names and brand_terms", () => {
    const client = sampleClient();
    const parsed = parseClientConfig({
      ...client,
      promotion: {
        ...client.promotion,
        competitor_names: ["Runway", "kling ai"],
        brand_terms: ["conduit"],
      },
    });
    assert.deepEqual(parsed.promotion.competitor_names, ["Runway", "kling ai"]);
    assert.deepEqual(parsed.promotion.brand_terms, ["conduit"]);
    assert.deepEqual(parsed.nameListDrops, []);
  });
});
