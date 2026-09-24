import { getDb } from "../db/index";
import {
  decideWithGarbleGuard,
  replySubject,
  textToHtml,
  type ThreadMessage,
} from "./agent";
import {
  getThread,
  listUnreadReplies,
  requireInstantlyApiKey,
  sendReply,
  type InstantlyEmail,
} from "./instantly";
import { jobDisposition, type ReplyMode } from "./playbook";

const LOOKBACK_HOURS = 48;
const MAX_THREADS_PER_CAMPAIGN = 10;
const MAX_REPLIES_PER_THREAD = 20;

interface LiveCampaign {
  instantlyId: string;
  name: string;
  replyMode: ReplyMode;
  playbook: string;
  inboxSince: Date | null;
}

function toThreadMessage(email: InstantlyEmail): ThreadMessage {
  return {
    direction: email.ueType === 2 ? "inbound" : "outbound",
    from: email.from,
    subject: email.subject,
    body: email.body,
    timestamp: email.timestamp,
  };
}

async function loadLiveCampaigns(): Promise<LiveCampaign[]> {
  const rows = await getDb()
    .selectFrom("outbound_campaigns")
    .select([
      "instantly_id",
      "name",
      "reply_mode",
      "playbook",
      "inbox_since",
    ])
    .where("reply_mode", "in", ["draft", "send"])
    .execute();

  const campaigns: LiveCampaign[] = [];
  for (const row of rows) {
    if (row.reply_mode !== "draft" && row.reply_mode !== "send") continue;
    campaigns.push({
      instantlyId: row.instantly_id,
      name: row.name,
      replyMode: row.reply_mode,
      playbook: row.playbook,
      inboxSince: row.inbox_since,
    });
  }
  return campaigns;
}

async function pinInboxSince(campaign: LiveCampaign): Promise<string> {
  if (campaign.inboxSince) return campaign.inboxSince.toISOString();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  await getDb()
    .updateTable("outbound_campaigns")
    .set({ inbox_since: since })
    .where("instantly_id", "=", campaign.instantlyId)
    .where("inbox_since", "is", null)
    .execute();
  return since.toISOString();
}

async function alreadyClaimed(emailId: string): Promise<boolean> {
  const row = await getDb()
    .selectFrom("outbound_activity")
    .select("email_id")
    .where("email_id", "=", emailId)
    .executeTakeFirst();
  return row !== undefined;
}

/** Insert the claim row. Returns false when another run already owns it. */
async function claimEmail(input: {
  email: InstantlyEmail;
  campaignId: string;
  outcome: string;
  note?: string | null;
  replySubject?: string | null;
  replyBody?: string | null;
}): Promise<boolean> {
  const inserted = await getDb()
    .insertInto("outbound_activity")
    .values({
      email_id: input.email.id,
      thread_id: input.email.threadId,
      instantly_campaign_id: input.campaignId,
      lead_email: input.email.lead ?? input.email.from,
      outcome: input.outcome,
      subject: input.email.subject,
      inbound_body: input.email.body,
      reply_subject: input.replySubject ?? null,
      reply_body: input.replyBody ?? null,
      note: input.note ?? null,
    })
    .onConflict((oc) => oc.column("email_id").doNothing())
    .returning("email_id")
    .executeTakeFirst();
  return inserted !== undefined;
}

async function finishClaim(input: {
  emailId: string;
  outcome: string;
  note?: string | null;
  replySubject?: string | null;
  replyBody?: string | null;
}): Promise<void> {
  await getDb()
    .updateTable("outbound_activity")
    .set({
      outcome: input.outcome,
      note: input.note ?? null,
      reply_subject: input.replySubject ?? null,
      reply_body: input.replyBody ?? null,
    })
    .where("email_id", "=", input.emailId)
    .execute();
}

async function ensureThread(input: {
  threadId: string;
  campaignId: string;
  leadEmail: string | null;
}): Promise<{ status: string; replyCount: number }> {
  await getDb()
    .insertInto("outbound_threads")
    .values({
      thread_id: input.threadId,
      instantly_campaign_id: input.campaignId,
      lead_email: input.leadEmail,
      status: "open",
      reply_count: 0,
    })
    .onConflict((oc) => oc.column("thread_id").doNothing())
    .execute();

  const row = await getDb()
    .selectFrom("outbound_threads")
    .select(["status", "reply_count"])
    .where("thread_id", "=", input.threadId)
    .executeTakeFirstOrThrow();
  return { status: row.status, replyCount: row.reply_count };
}

async function setThreadStatus(threadId: string, status: string): Promise<void> {
  await getDb()
    .updateTable("outbound_threads")
    .set({ status, updated_at: new Date() })
    .where("thread_id", "=", threadId)
    .execute();
}

async function bumpReplyCount(threadId: string): Promise<void> {
  const row = await getDb()
    .selectFrom("outbound_threads")
    .select("reply_count")
    .where("thread_id", "=", threadId)
    .executeTakeFirst();
  if (!row) return;
  await getDb()
    .updateTable("outbound_threads")
    .set({ reply_count: row.reply_count + 1, updated_at: new Date() })
    .where("thread_id", "=", threadId)
    .execute();
}

async function processEmail(input: {
  apiKey: string;
  campaign: LiveCampaign;
  email: InstantlyEmail;
}): Promise<void> {
  const { apiKey, campaign, email } = input;
  if (await alreadyClaimed(email.id)) return;

  const lead = email.lead ?? email.from;
  const threadState = await ensureThread({
    threadId: email.threadId,
    campaignId: campaign.instantlyId,
    leadEmail: lead,
  });

  if (threadState.status === "escalated" || threadState.status === "declined") {
    await claimEmail({
      email,
      campaignId: campaign.instantlyId,
      outcome: "skipped",
      note: `Thread is ${threadState.status}. The agent stays quiet.`,
    });
    return;
  }

  if (threadState.replyCount >= MAX_REPLIES_PER_THREAD) {
    await setThreadStatus(email.threadId, "escalated");
    await claimEmail({
      email,
      campaignId: campaign.instantlyId,
      outcome: "escalated",
      note: `Reply cap (${MAX_REPLIES_PER_THREAD}) reached.`,
    });
    return;
  }

  const remoteThread = await getThread(apiKey, email.threadId);
  const thread = remoteThread.length > 0 ? remoteThread : [email];
  const latest = thread[thread.length - 1];
  if (latest && latest.ueType !== 2) {
    await claimEmail({
      email,
      campaignId: campaign.instantlyId,
      outcome: "skipped",
      note: "The newest message in the thread is already ours.",
    });
    return;
  }

  const claimed = await claimEmail({
    email,
    campaignId: campaign.instantlyId,
    outcome: "claimed",
  });
  if (!claimed) return;

  try {
    const decision = await decideWithGarbleGuard({
      playbook: campaign.playbook,
      thread: thread.map(toThreadMessage),
      leadEmail: lead,
    });

    if (decision.action === "ignore") {
      await finishClaim({
        emailId: email.id,
        outcome: "ignored",
        note: decision.reasoning,
      });
      return;
    }

    if (decision.action === "escalate" || !decision.reply_body) {
      await setThreadStatus(email.threadId, "escalated");
      await finishClaim({
        emailId: email.id,
        outcome: "escalated",
        note: decision.escalation_reason ?? decision.reasoning,
      });
      return;
    }

    const subject = replySubject(
      decision.reply_subject ?? "",
      email.subject,
    );

    if (campaign.replyMode === "draft") {
      await finishClaim({
        emailId: email.id,
        outcome: "draft",
        replySubject: subject,
        replyBody: decision.reply_body,
        note: "Saved as a draft. Auto-send is off for this campaign.",
      });
      return;
    }

    await sendReply({
      apiKey,
      replyToUuid: email.id,
      eaccount: email.eaccount,
      subject,
      bodyText: decision.reply_body,
      bodyHtml: textToHtml(decision.reply_body),
    });
    await bumpReplyCount(email.threadId);
    if (decision.deal_status === "agreed") {
      await setThreadStatus(email.threadId, "closed");
    } else if (decision.deal_status === "declined") {
      await setThreadStatus(email.threadId, "declined");
    }
    await finishClaim({
      emailId: email.id,
      outcome: "sent",
      replySubject: subject,
      replyBody: decision.reply_body,
      note: decision.summary_for_owner,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishClaim({
      emailId: email.id,
      outcome: "failed",
      note: message,
    });
    console.error(
      `[outbound] ${campaign.name} email ${email.id} failed: ${message}`,
    );
  }
}

/**
 * Poll Instantly for campaigns set to Draft or Auto-send.
 * Off campaigns are ignored. Incomplete starter playbooks are ignored.
 * Draft mode stores the reply and does not call the Instantly reply API.
 */
export async function processOutboundInbox(): Promise<void> {
  const campaigns = await loadLiveCampaigns();
  if (campaigns.length === 0) {
    console.log("[outbound] No campaigns are set to draft or auto-send.");
    return;
  }

  const runnable = campaigns.filter((campaign) => {
    const disposition = jobDisposition(campaign.replyMode, campaign.playbook);
    if (disposition === "skip-incomplete") {
      console.log(
        `[outbound] ${campaign.name} still has the starter playbook — not drafting or sending.`,
      );
      return false;
    }
    return disposition === "draft" || disposition === "send";
  });
  if (runnable.length === 0) return;

  const apiKey = requireInstantlyApiKey();
  for (const campaign of runnable) {
    const sinceIso = await pinInboxSince(campaign);
    const unread = await listUnreadReplies({
      apiKey,
      campaignId: campaign.instantlyId,
      sinceIso,
    });
    const pending: InstantlyEmail[] = [];
    for (const email of unread) {
      if (!(await alreadyClaimed(email.id))) pending.push(email);
      if (pending.length >= MAX_THREADS_PER_CAMPAIGN) break;
    }
    console.log(
      `[outbound] ${campaign.name} mode=${campaign.replyMode} unread=${unread.length} handling=${pending.length}`,
    );
    for (const email of pending) {
      await processEmail({ apiKey, campaign, email });
    }
  }
}
