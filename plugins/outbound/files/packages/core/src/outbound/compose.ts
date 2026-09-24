import { randomUUID } from "node:crypto";

import { getDb } from "../db/index";
import { replySubject, textToHtml } from "./agent";
import { getOutboundCampaign } from "./campaigns";
import {
  getThread,
  requireInstantlyApiKey,
  sendReply,
  type InstantlyEmail,
} from "./instantly";

const DRAFT_PREFIX = "manual-draft:";

function draftId(threadId: string): string {
  return `${DRAFT_PREFIX}${threadId}`;
}

function latestInbound(emails: InstantlyEmail[]): InstantlyEmail | null {
  const inbound = emails.filter((email) => email.ueType === 2);
  return inbound.length > 0 ? inbound[inbound.length - 1] : null;
}

/** A person writing in the unibox. Draft stores the text on the thread.
 *  Send delivers it through Instantly from the inbox that received the lead. */
export async function composeThreadMessage(input: {
  instantlyId: string;
  threadId: string;
  body: string;
  intent: "draft" | "send";
}): Promise<void> {
  const body = input.body.trim();
  if (!body) throw new Error("Write a message first.");
  if (body.length > 8000) throw new Error("Keep the message under 8,000 characters.");
  if (!input.threadId) throw new Error("Open a thread before writing.");

  const campaign = await getOutboundCampaign(input.instantlyId);
  if (!campaign) {
    throw new Error("That campaign is not in the local list. Sync from Instantly first.");
  }

  const apiKey = requireInstantlyApiKey();
  const thread = await getThread(apiKey, input.threadId);
  const inCampaign = thread.filter((email) => email.campaignId === input.instantlyId);
  if (inCampaign.length === 0) {
    throw new Error("That thread is not in this campaign.");
  }

  const inbound = latestInbound(inCampaign);
  if (!inbound) {
    throw new Error("There is no message from the lead to reply to yet.");
  }
  if (!inbound.eaccount) {
    throw new Error("Instantly did not say which inbox received this thread.");
  }

  const subject = replySubject("", inbound.subject);
  const lead = inbound.lead ?? inbound.from ?? null;
  const db = getDb();

  if (input.intent === "draft") {
    await db
      .insertInto("outbound_activity")
      .values({
        email_id: draftId(input.threadId),
        thread_id: input.threadId,
        instantly_campaign_id: input.instantlyId,
        lead_email: lead,
        outcome: "draft",
        subject: inbound.subject || null,
        inbound_body: null,
        reply_subject: subject,
        reply_body: body,
        note: "Written in the unibox. Not sent.",
      })
      .onConflict((oc) =>
        oc.column("email_id").doUpdateSet({
          lead_email: lead,
          outcome: "draft",
          subject: inbound.subject || null,
          reply_subject: subject,
          reply_body: body,
          note: "Written in the unibox. Not sent.",
        }),
      )
      .execute();
    return;
  }

  await sendReply({
    apiKey,
    replyToUuid: inbound.id,
    eaccount: inbound.eaccount,
    subject,
    bodyText: body,
    bodyHtml: textToHtml(body),
  });

  await db
    .deleteFrom("outbound_activity")
    .where("email_id", "=", draftId(input.threadId))
    .execute();

  await db
    .insertInto("outbound_activity")
    .values({
      email_id: `manual-send:${randomUUID()}`,
      thread_id: input.threadId,
      instantly_campaign_id: input.instantlyId,
      lead_email: lead,
      outcome: "sent",
      subject: inbound.subject || null,
      inbound_body: null,
      reply_subject: subject,
      reply_body: body,
      note: "Sent from the unibox.",
    })
    .execute();
}
