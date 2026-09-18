import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asDateString,
  computeWarehouseLagHours,
  isWarehouseStale,
  parseWarehouseTimestamp,
} from "./dates";

describe("parseWarehouseTimestamp", () => {
  it("reads ClickHouse DateTime64 strings as UTC", () => {
    const parsed = parseWarehouseTimestamp("2026-09-17 23:46:05.667000");
    assert.ok(parsed);
    assert.equal(parsed.toISOString(), "2026-09-17T23:46:05.667Z");
  });

  it("keeps an explicit offset instead of appending Z", () => {
    const parsed = parseWarehouseTimestamp("2026-09-17 23:46:05+00:00");
    assert.ok(parsed);
    assert.equal(parsed.toISOString(), "2026-09-17T23:46:05.000Z");
  });
});

describe("computeWarehouseLagHours", () => {
  const nowMs = Date.parse("2026-09-18T00:31:00.000Z");

  it("uses last Fivetran sync when present and data is current", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-17",
      lastSynced: "2026-09-17 23:46:05.667000",
      nowMs,
    });
    assert.ok(hours != null);
    assert.ok(hours > 0.7 && hours < 0.8);
  });

  it("does not treat today's max(date) as 24h stale after UTC midnight", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-17",
      nowMs,
    });
    assert.ok(hours != null);
    assert.ok(hours < 1, `expected <1h from end of asOf day, got ${hours}`);
  });

  it("reports multi-day lag when max(date) is actually old", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-15",
      nowMs,
    });
    assert.ok(hours != null);
    // 48h from end-of-day minus the one-day Ads reporting slack.
    assert.ok(hours > 24 && hours < 25);
  });

  it("does not refuse a morning run on yesterday's max(date) without a sync time", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-17",
      nowMs: Date.parse("2026-09-18T12:00:00.000Z"),
    });
    assert.ok(hours != null);
    assert.equal(isWarehouseStale(hours), false);
  });

  it("does not let a fresh sync hide a stale max(date)", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-15",
      lastSynced: "2026-09-17 23:46:05.667000",
      nowMs,
    });
    assert.ok(hours != null);
    assert.ok(hours > 24, `expected data-age to dominate, got ${hours}`);
    assert.ok(isWarehouseStale(hours));
  });

  it("returns 0 when asOf is still the current UTC day and there is no sync time", () => {
    const hours = computeWarehouseLagHours({
      asOfDate: "2026-09-18",
      nowMs,
    });
    assert.equal(hours, 0);
  });
});

describe("asDateString", () => {
  it("keeps a YYYY-MM-DD prefix", () => {
    assert.equal(asDateString("2026-09-17 00:00:00"), "2026-09-17");
  });
});

describe("isWarehouseStale", () => {
  it("treats null lag as not stale", () => {
    assert.equal(isWarehouseStale(null), false);
    assert.equal(isWarehouseStale(12), false);
    assert.equal(isWarehouseStale(12.1), true);
  });
});
