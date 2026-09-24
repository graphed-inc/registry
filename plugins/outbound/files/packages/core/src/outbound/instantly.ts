import { loadLocalEnv } from "../config";
import { stripHtml } from "./agent";

const BASE_URL = "https://api.instantly.ai/api/v2";

export function readInstantlyApiKey(): string | null {
  loadLocalEnv();
  const value = process.env.INSTANTLY_API_KEY?.trim();
  return value ? value : null;
}

export function requireInstantlyApiKey(): string {
  const key = readInstantlyApiKey();
  if (!key) {
    throw new Error(
      "INSTANTLY_API_KEY is not set. That is the only credential this agent needs. Add it with `graphed secrets set INSTANTLY_API_KEY` and list the name on the dashboard service and the outbound-replies job.",
    );
  }
  return key;
}

export interface InstantlyCampaign {
  id: string;
  name: string;
  status: number | null;
}

export interface InstantlyEmail {
  id: string;
  threadId: string;
  campaignId: string | null;
  lead: string | null;
  eaccount: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  timestamp: string;
  /** 2 = received. Other values are mail we sent. */
  ueType: number;
  isUnread: boolean;
}

export interface CampaignAnalytics {
  campaignId: string;
  leads: number;
  contacted: number;
  sent: number;
  opens: number;
  replies: number;
  bounced: number;
  unsubscribed: number;
}

export interface InstantlyLead {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  status: number | null;
  interestStatus: number | null;
  openCount: number;
  replyCount: number;
  lastContact: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = readString(record, key).trim();
  return value.length > 0 ? value : null;
}

function readCount(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function readOptionalNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function request(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 400);
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Instantly rejected the API key (${response.status}). Check INSTANTLY_API_KEY.`,
      );
    }
    throw new Error(
      `Instantly ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body}`,
    );
  }
  return response.json();
}

function readItems(value: unknown): {
  items: Record<string, unknown>[];
  next: string | null;
} {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new Error("Instantly response did not include an items list.");
  }
  const items = value.items.filter(isRecord);
  const next =
    typeof value.next_starting_after === "string" &&
    value.next_starting_after.length > 0
      ? value.next_starting_after
      : null;
  return { items, next };
}

function readCampaign(record: Record<string, unknown>): InstantlyCampaign {
  const id = readString(record, "id");
  if (!id) throw new Error("Instantly campaign is missing an id.");
  const status = record.status;
  return {
    id,
    name: readString(record, "name") || "(untitled campaign)",
    status: typeof status === "number" ? status : null,
  };
}

function readEmailBody(record: Record<string, unknown>): string {
  const body = record.body;
  if (!isRecord(body)) return "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text) return text;
  const html = typeof body.html === "string" ? body.html : "";
  return stripHtml(html);
}

function readEmail(record: Record<string, unknown>): InstantlyEmail | null {
  const id = readString(record, "id");
  if (!id) return null;
  const ueType = record.ue_type;
  return {
    id,
    threadId: readString(record, "thread_id") || id,
    campaignId: readString(record, "campaign_id") || null,
    lead: readString(record, "lead") || null,
    eaccount: readString(record, "eaccount"),
    subject: readString(record, "subject"),
    from: readString(record, "from_address_email") || readString(record, "eaccount"),
    to: readString(record, "to_address_email_list"),
    body: readEmailBody(record),
    timestamp: readString(record, "timestamp_email") || readString(record, "timestamp_created"),
    ueType: typeof ueType === "number" ? ueType : 0,
    isUnread: record.is_unread === true,
  };
}

function readAnalytics(record: Record<string, unknown>): CampaignAnalytics | null {
  const campaignId = readString(record, "campaign_id");
  if (!campaignId) return null;
  return {
    campaignId,
    leads: readCount(record, ["leads_count"]),
    contacted: readCount(record, ["contacted_count"]),
    sent: readCount(record, ["emails_sent_count"]),
    opens: readCount(record, ["open_count_unique", "open_count"]),
    replies: readCount(record, ["reply_count_unique", "reply_count"]),
    bounced: readCount(record, ["bounced_count"]),
    unsubscribed: readCount(record, ["unsubscribed_count"]),
  };
}

function readAnalyticsList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.items)) {
    return value.items.filter(isRecord);
  }
  if (isRecord(value) && typeof value.campaign_id === "string") return [value];
  throw new Error("Instantly analytics response was not a list.");
}

function readLead(record: Record<string, unknown>): InstantlyLead | null {
  const id = readString(record, "id");
  if (!id) return null;
  return {
    id,
    email: readOptionalString(record, "email"),
    firstName: readOptionalString(record, "first_name"),
    lastName: readOptionalString(record, "last_name"),
    companyName: readOptionalString(record, "company_name"),
    status: readOptionalNumber(record, "status"),
    interestStatus: readOptionalNumber(record, "lt_interest_status"),
    openCount: readCount(record, ["email_open_count"]),
    replyCount: readCount(record, ["email_reply_count"]),
    lastContact: readOptionalString(record, "timestamp_last_contact"),
  };
}

export async function listCampaigns(apiKey: string): Promise<InstantlyCampaign[]> {
  const campaigns: InstantlyCampaign[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const { items, next } = readItems(
      await request(apiKey, `/campaigns?${query.toString()}`),
    );
    campaigns.push(...items.map(readCampaign));
    if (!next || items.length === 0) break;
    startingAfter = next;
  }
  return campaigns;
}

export async function listUnreadReplies(input: {
  apiKey: string;
  campaignId: string;
  sinceIso: string;
}): Promise<InstantlyEmail[]> {
  const emails: InstantlyEmail[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const query = new URLSearchParams({
      limit: "100",
      campaign_id: input.campaignId,
      email_type: "received",
      is_unread: "true",
      min_timestamp_created: input.sinceIso,
      sort_order: "asc",
    });
    if (startingAfter) query.set("starting_after", startingAfter);
    const { items, next } = readItems(
      await request(input.apiKey, `/emails?${query.toString()}`),
    );
    for (const item of items) {
      const email = readEmail(item);
      if (email && email.ueType === 2) emails.push(email);
    }
    if (!next || items.length === 0) break;
    startingAfter = next;
  }
  return emails;
}

export async function getThread(
  apiKey: string,
  threadId: string,
): Promise<InstantlyEmail[]> {
  const query = new URLSearchParams({
    limit: "100",
    search: `thread:${threadId}`,
    sort_order: "asc",
  });
  const { items } = readItems(
    await request(apiKey, `/emails?${query.toString()}`),
  );
  const emails: InstantlyEmail[] = [];
  for (const item of items) {
    const email = readEmail(item);
    if (email && email.threadId === threadId) emails.push(email);
  }
  return emails;
}

/** One call for every campaign. Missing ids simply have no row. */
export async function getCampaignAnalytics(
  apiKey: string,
): Promise<CampaignAnalytics[]> {
  const rows = readAnalyticsList(
    await request(apiKey, "/campaigns/analytics"),
  );
  const stats: CampaignAnalytics[] = [];
  for (const row of rows) {
    const parsed = readAnalytics(row);
    if (parsed) stats.push(parsed);
  }
  return stats;
}

export async function listCampaignEmails(input: {
  apiKey: string;
  campaignId: string;
  emailType: "received" | "sent" | "manual";
  limit?: number;
}): Promise<InstantlyEmail[]> {
  const query = new URLSearchParams({
    limit: String(input.limit ?? 50),
    campaign_id: input.campaignId,
    email_type: input.emailType,
    sort_order: "desc",
  });
  const { items } = readItems(
    await request(input.apiKey, `/emails?${query.toString()}`),
  );
  const emails: InstantlyEmail[] = [];
  for (const item of items) {
    const email = readEmail(item);
    if (email) emails.push(email);
  }
  return emails;
}

export async function listCampaignLeads(input: {
  apiKey: string;
  campaignId: string;
  startingAfter?: string | null;
  limit?: number;
}): Promise<{ leads: InstantlyLead[]; next: string | null }> {
  const body: Record<string, string | number> = {
    campaign: input.campaignId,
    limit: input.limit ?? 100,
  };
  if (input.startingAfter) body.starting_after = input.startingAfter;
  const { items, next } = readItems(
    await request(input.apiKey, "/leads/list", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  const leads: InstantlyLead[] = [];
  for (const item of items) {
    const lead = readLead(item);
    if (lead) leads.push(lead);
  }
  return { leads, next };
}

export async function sendReply(input: {
  apiKey: string;
  replyToUuid: string;
  eaccount: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}): Promise<void> {
  await request(input.apiKey, "/emails/reply", {
    method: "POST",
    body: JSON.stringify({
      reply_to_uuid: input.replyToUuid,
      eaccount: input.eaccount,
      subject: input.subject,
      body: { text: input.bodyText, html: input.bodyHtml },
    }),
  });
}
