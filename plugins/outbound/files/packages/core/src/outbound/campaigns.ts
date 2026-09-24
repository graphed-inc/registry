import { getDb } from "../db/index";
import {
  listCampaigns,
  readInstantlyApiKey,
  requireInstantlyApiKey,
} from "./instantly";
import {
  isReplyMode,
  STARTER_PLAYBOOK,
  type ReplyMode,
} from "./playbook";

export interface OutboundCampaign {
  id: number;
  instantlyId: string;
  name: string;
  instantlyStatus: number | null;
  replyMode: ReplyMode;
  playbook: string;
  lastSyncedAt: Date | null;
}

export interface OutboundActivity {
  emailId: string;
  threadId: string;
  leadEmail: string | null;
  outcome: string;
  subject: string | null;
  replySubject: string | null;
  replyBody: string | null;
  note: string | null;
  createdAt: Date;
}

function asReplyMode(value: string): ReplyMode {
  return isReplyMode(value) ? value : "off";
}

interface CampaignRow {
  id: number;
  instantly_id: string;
  name: string;
  instantly_status: number | null;
  reply_mode: string;
  playbook: string;
  last_synced_at: Date | null;
}

function toCampaign(row: CampaignRow): OutboundCampaign {
  return {
    id: row.id,
    instantlyId: row.instantly_id,
    name: row.name,
    instantlyStatus: row.instantly_status,
    replyMode: asReplyMode(row.reply_mode),
    playbook: row.playbook,
    lastSyncedAt: row.last_synced_at,
  };
}

const campaignColumns = [
  "id",
  "instantly_id",
  "name",
  "instantly_status",
  "reply_mode",
  "playbook",
  "last_synced_at",
] as const;

export async function listOutboundCampaigns(): Promise<OutboundCampaign[]> {
  const rows = await getDb()
    .selectFrom("outbound_campaigns")
    .select(campaignColumns)
    .orderBy("name")
    .execute();

  return rows.map(toCampaign);
}

export async function getOutboundCampaign(
  instantlyId: string,
): Promise<OutboundCampaign | null> {
  const row = await getDb()
    .selectFrom("outbound_campaigns")
    .select(campaignColumns)
    .where("instantly_id", "=", instantlyId)
    .executeTakeFirst();
  return row ? toCampaign(row) : null;
}

export async function listCampaignActivity(
  instantlyId: string,
): Promise<OutboundActivity[]> {
  const rows = await getDb()
    .selectFrom("outbound_activity")
    .select([
      "email_id",
      "thread_id",
      "lead_email",
      "outcome",
      "subject",
      "reply_subject",
      "reply_body",
      "note",
      "created_at",
    ])
    .where("instantly_campaign_id", "=", instantlyId)
    .orderBy("created_at", "desc")
    .limit(12)
    .execute();

  return rows.map((row) => ({
    emailId: row.email_id,
    threadId: row.thread_id,
    leadEmail: row.lead_email,
    outcome: row.outcome,
    subject: row.subject,
    replySubject: row.reply_subject,
    replyBody: row.reply_body,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export function instantlyConnected(): boolean {
  return readInstantlyApiKey() !== null;
}

/** Pull Instantly campaigns. New rows start Off, with the starter playbook.
 *  A sync never changes a playbook or a reply mode that is already saved. */
export async function syncInstantlyCampaigns(): Promise<{ synced: number }> {
  const apiKey = requireInstantlyApiKey();
  const remote = await listCampaigns(apiKey);
  const db = getDb();

  for (const campaign of remote) {
    await db
      .insertInto("outbound_campaigns")
      .values({
        instantly_id: campaign.id,
        name: campaign.name,
        instantly_status: campaign.status,
        reply_mode: "off",
        playbook: STARTER_PLAYBOOK,
        last_synced_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("instantly_id").doUpdateSet((eb) => ({
          name: eb.ref("excluded.name"),
          instantly_status: eb.ref("excluded.instantly_status"),
          last_synced_at: new Date(),
          updated_at: new Date(),
        })),
      )
      .execute();
  }

  return { synced: remote.length };
}

async function updateCampaign(
  instantlyId: string,
  patch: { playbook?: string; reply_mode?: ReplyMode },
): Promise<void> {
  const result = await getDb()
    .updateTable("outbound_campaigns")
    .set({ ...patch, updated_at: new Date() })
    .where("instantly_id", "=", instantlyId)
    .executeTakeFirst();

  const updated = result.numUpdatedRows ?? 0n;
  if (updated === 0n) {
    throw new Error(
      `No campaign ${instantlyId}. Sync from Instantly, then save.`,
    );
  }
}

export async function saveCampaignPlaybook(input: {
  instantlyId: string;
  playbook: string;
}): Promise<void> {
  await updateCampaign(input.instantlyId, { playbook: input.playbook });
}

export async function saveCampaignReplyMode(input: {
  instantlyId: string;
  replyMode: ReplyMode;
}): Promise<void> {
  await updateCampaign(input.instantlyId, { reply_mode: input.replyMode });
}

export async function listThreadActivity(
  instantlyId: string,
  threadId: string,
): Promise<OutboundActivity[]> {
  const rows = await getDb()
    .selectFrom("outbound_activity")
    .select([
      "email_id",
      "thread_id",
      "lead_email",
      "outcome",
      "subject",
      "reply_subject",
      "reply_body",
      "note",
      "created_at",
    ])
    .where("instantly_campaign_id", "=", instantlyId)
    .where("thread_id", "=", threadId)
    .orderBy("created_at", "asc")
    .limit(20)
    .execute();

  return rows.map((row) => ({
    emailId: row.email_id,
    threadId: row.thread_id,
    leadEmail: row.lead_email,
    outcome: row.outcome,
    subject: row.subject,
    replySubject: row.reply_subject,
    replyBody: row.reply_body,
    note: row.note,
    createdAt: row.created_at,
  }));
}
