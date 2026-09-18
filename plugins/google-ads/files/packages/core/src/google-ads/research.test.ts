import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  filterResearchKeywords,
  KEYWORD_IDEAS_TOOL,
  researchSeedKeywords,
  SITE_KEYWORDS_TOOL,
  type ResearchKeyword,
} from "./research";
import { sampleClient } from "./test/fixtures";

describe("filterResearchKeywords", () => {
  it("keeps hand-written rows with no search volume", () => {
    const rows: ResearchKeyword[] = [
      {
        term: "ai data analyst",
        searchVolume: 0,
        volumeKnown: false,
        cpc: null,
        competition: null,
        source: "site",
      },
    ];
    assert.equal(filterResearchKeywords(rows, sampleClient()).length, 1);
  });

  it("drops catalog rows below min_search_volume", () => {
    const rows: ResearchKeyword[] = [
      {
        term: "ai data analyst",
        searchVolume: 2,
        volumeKnown: true,
        cpc: null,
        competition: null,
        source: "site",
      },
    ];
    assert.equal(filterResearchKeywords(rows, sampleClient()).length, 0);
  });

  it("drops catalog rows with unknown volume", () => {
    const rows: ResearchKeyword[] = [
      {
        term: "ai data analyst",
        searchVolume: 0,
        volumeKnown: false,
        cpc: null,
        competition: null,
        source: "site",
      },
    ];
    assert.equal(
      filterResearchKeywords(rows, sampleClient(), { dropUnknownVolume: true })
        .length,
      0,
    );
  });
});

describe("researchSeedKeywords", () => {
  it("does not call keyword ideas when the site catalog is large but volume-filtered", async () => {
    const tools: string[] = [];
    const payload = {
      keywords: Array.from({ length: 15 }, (_, index) => ({
        keyword: `ai analytics tool ${index + 1}`,
      })),
    };
    const result = await researchSeedKeywords(
      sampleClient({
        seed: {
          ...sampleClient().seed,
          target: "example.com",
        },
      }),
      {
        target: "example.com",
        run: async (tool) => {
          tools.push(tool);
          return payload;
        },
      },
    );
    assert.deepEqual(tools, [SITE_KEYWORDS_TOOL]);
    assert.ok(!tools.includes(KEYWORD_IDEAS_TOOL));
    assert.equal(result.keywords.length, 0);
    assert.match(result.error ?? "", /known search volume/);
    assert.match(result.error ?? "", /--terms/);
  });

  it("explains an empty catalog after the ideas fallback also yields nothing", async () => {
    const result = await researchSeedKeywords(
      sampleClient({
        seed: {
          ...sampleClient().seed,
          target: "example.com",
        },
      }),
      {
        target: "example.com",
        run: async () => ({ keywords: [] }),
      },
    );
    assert.equal(result.keywords.length, 0);
    assert.match(result.error ?? "", /no usable keywords/);
    assert.match(result.error ?? "", /--terms/);
  });
});
