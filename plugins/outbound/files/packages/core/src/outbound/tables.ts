import type { ColumnType, Generated } from "kysely";

// Row types for the outbound plugin (migration: src/migrations/0000_outbound.ts).
// AGENT.md step: register them in packages/core/src/db/types.ts.

export interface OutboundCampaignsTable {
  id: Generated<number>;
  instantly_id: string;
  name: string;
  instantly_status: number | null;
  // off | draft | send. New rows default to off.
  reply_mode: ColumnType<string, string | undefined, string>;
  playbook: ColumnType<string, string | undefined, string>;
  // Pinned on the first poll so a restart does not slide the lookback window.
  inbox_since: Date | null;
  last_synced_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboundThreadsTable {
  thread_id: string;
  instantly_campaign_id: string;
  lead_email: string | null;
  // open | escalated | closed | declined
  status: ColumnType<string, string | undefined, string>;
  reply_count: ColumnType<number, number | undefined, number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OutboundActivityTable {
  email_id: string;
  thread_id: string;
  instantly_campaign_id: string;
  lead_email: string | null;
  // claimed | draft | sent | escalated | ignored | failed | skipped
  outcome: string;
  subject: string | null;
  inbound_body: string | null;
  reply_subject: string | null;
  reply_body: string | null;
  note: string | null;
  created_at: Generated<Date>;
}
