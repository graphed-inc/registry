import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendDroppedNameListNote, keepNameShaped } from "./name-list";
import { parseClientConfig } from "./types";
import { sampleClient } from "./test/fixtures";

function withWarnStub(run: (warns: string[]) => void): void {
  const warns: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => {
    warns.push(message);
  };
  try {
    run(warns);
  } finally {
    console.warn = original;
  }
}

describe("keepNameShaped", () => {
  it("returns kept and dropped entries and warns once", () => {
    withWarnStub((warns) => {
      const first = keepNameShaped(
        ["do not promote runway", "Runway", "Never Fully Dressed"],
        "competitor_names",
      );
      const second = keepNameShaped(
        ["do not promote runway", "Runway", "Never Fully Dressed"],
        "competitor_names",
      );
      assert.deepEqual(first.kept, ["Runway"]);
      assert.deepEqual(first.dropped, [
        "do not promote runway",
        "Never Fully Dressed",
      ]);
      assert.deepEqual(second, first);
      assert.equal(warns.length, 1);
      assert.match(warns[0] ?? "", /competitor_names: ignoring non-name/);
    });
  });

  it("returns no drops when every entry is a name", () => {
    withWarnStub((warns) => {
      const filtered = keepNameShaped(["Runway"], "competitor_names");
      assert.deepEqual(filtered, { kept: ["Runway"], dropped: [] });
      assert.equal(warns.length, 0);
    });
  });
});

describe("appendDroppedNameListNote", () => {
  it("appends the note so the first line stays the report headline", () => {
    const drops = [
      {
        label: "competitor_names",
        entries: ["do not promote runway", "Never Fully Dressed"],
      },
    ];
    const report = appendDroppedNameListNote(
      "Promoted 2 terms.\nPaused 1 group.",
      drops,
    );
    assert.equal(report.startsWith("Promoted 2 terms."), true);
    assert.match(
      report,
      /competitor_names \("do not promote runway", "Never Fully Dressed"\)/,
    );
    assert.match(report, /Fix the list in client\.config\.json/);
  });

  it("leaves the report unchanged when nothing was dropped", () => {
    assert.equal(appendDroppedNameListNote("ok", []), "ok");
  });
});

describe("parseClientConfig", () => {
  it("hangs name-list drops on the parsed client", () => {
    withWarnStub(() => {
      const parsed = parseClientConfig({
        ...sampleClient(),
        promotion: {
          ...sampleClient().promotion,
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
    });
  });
});
