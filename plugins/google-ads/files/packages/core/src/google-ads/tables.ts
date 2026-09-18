import type { ColumnType, Generated } from "kysely";

// Row types for the Google Ads plugin tables (migration: 0000_google_ads.ts).
// AGENT.md step: register them in packages/core/src/db/types.ts —
//   import type {
//     GoogleAdsActionsTable,
//     GoogleAdsMemoryTable,
//     GoogleAdsRunsTable,
//   } from "../google-ads/tables";
//   ...and add google_ads_memory / google_ads_runs / google_ads_actions.

export interface GoogleAdsMemoryTable {
  client_key: string;
  key: string;
  value: string;
  updated_at: Generated<Date>;
}

export interface GoogleAdsActionsTable {
  id: Generated<string>;
  client_key: string;
  run_id: string;
  tool: string;
  input: ColumnType<unknown, unknown, unknown>;
  result: ColumnType<unknown, unknown, unknown>;
  dry_run: boolean;
  reason: string | null;
  created_at: Generated<Date>;
}

export interface GoogleAdsRunsTable {
  id: string;
  client_key: string;
  started_at: Generated<Date>;
  finished_at: Date | null;
  dry_run: boolean;
  status: string;
  report: string | null;
  messages: ColumnType<unknown, unknown, unknown>;
}
