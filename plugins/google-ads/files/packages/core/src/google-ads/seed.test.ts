import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { previewTestingSeeds } from "./seed";
import { sampleClient } from "./test/fixtures";

describe("previewTestingSeeds --from-json", () => {
  it("explains when a payload has rows but none survive filtering", async () => {
    const preview = await previewTestingSeeds(sampleClient(), {
      fromPayload: {
        payload: { keywords: [{ keyword: "ads" }] },
        source: "site",
      },
      classify: async () => [],
    });
    assert.equal(preview.keywords.length, 0);
    assert.match(preview.error ?? "", /payload had 1 rows/);
    assert.match(preview.error ?? "", /--terms/);
  });

  it("explains an unrecognised or empty payload", async () => {
    const preview = await previewTestingSeeds(sampleClient(), {
      fromPayload: {
        payload: { terms: ["ai ads agent"] },
        source: "site",
      },
      classify: async () => [],
    });
    assert.equal(preview.keywords.length, 0);
    assert.match(preview.error ?? "", /no keyword rows found/);
    assert.match(preview.error ?? "", /--terms/);
  });

  it("keeps a flat --from-json list without volumes", async () => {
    const preview = await previewTestingSeeds(sampleClient(), {
      fromPayload: {
        payload: { keywords: [{ keyword: "ai advertising tools" }] },
        source: "site",
      },
      classify: async () => [],
    });
    assert.deepEqual(
      preview.keywords.map((row) => row.term),
      ["ai advertising tools"],
    );
    assert.equal(preview.error, undefined);
  });
});
