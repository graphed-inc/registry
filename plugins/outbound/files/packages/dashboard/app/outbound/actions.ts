"use server";

import { redirect } from "next/navigation";
import { testPlaybook, type AgentDecision, type ThreadMessage } from "@app/core/outbound/agent";
import {
  saveCampaignPlaybook,
  saveCampaignReplyMode,
  syncInstantlyCampaigns,
} from "@app/core/outbound/campaigns";
import { composeThreadMessage } from "@app/core/outbound/compose";
import { isReplyMode } from "@app/core/outbound/playbook";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function overview(params: Record<string, string>): never {
  const query = new URLSearchParams(params).toString();
  redirect(query ? `/outbound?${query}` : "/outbound");
}

function campaign(
  instantlyId: string,
  params: Record<string, string>,
): never {
  const query = new URLSearchParams(params).toString();
  const path = `/outbound/${encodeURIComponent(instantlyId)}`;
  redirect(query ? `${path}?${query}` : path);
}

export async function syncCampaignsAction(): Promise<void> {
  let params: Record<string, string>;
  try {
    const { synced } = await syncInstantlyCampaigns();
    params = {
      notice: `Synced ${synced} Instantly campaign${synced === 1 ? "" : "s"}. New ones start Off.`,
    };
  } catch (error) {
    params = { error: messageOf(error) };
  }
  overview(params);
}

export async function savePlaybookAction(formData: FormData): Promise<void> {
  const instantlyId = String(formData.get("instantlyId") ?? "");
  const playbook = String(formData.get("playbook") ?? "");
  try {
    await saveCampaignPlaybook({ instantlyId, playbook });
    campaign(instantlyId, {
      tab: "playbook",
      notice: "Playbook saved. The next inbox run uses this document.",
    });
  } catch (error) {
    campaign(instantlyId, { tab: "playbook", error: messageOf(error) });
  }
}

export async function saveReplyModeAction(formData: FormData): Promise<void> {
  const instantlyId = String(formData.get("instantlyId") ?? "");
  const replyMode = String(formData.get("replyMode") ?? "");
  const thread = String(formData.get("thread") ?? "");
  const params: Record<string, string> = { tab: "unibox" };
  if (thread) params.thread = thread;
  try {
    if (!isReplyMode(replyMode)) {
      throw new Error("Pick Off, Draft replies, or Auto-send.");
    }
    await saveCampaignReplyMode({ instantlyId, replyMode });
    params.notice = `Reply mode is ${replyMode === "off" ? "Off" : replyMode === "draft" ? "Draft replies" : "Auto-send"}.`;
  } catch (error) {
    params.error = messageOf(error);
  }
  campaign(instantlyId, params);
}

export async function composeReplyAction(formData: FormData): Promise<void> {
  const instantlyId = String(formData.get("instantlyId") ?? "");
  const threadId = String(formData.get("threadId") ?? "");
  const body = String(formData.get("body") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const params: Record<string, string> = { tab: "unibox" };
  if (threadId) params.thread = threadId;
  try {
    if (intent !== "draft" && intent !== "send") {
      throw new Error("Choose Save draft or Send.");
    }
    await composeThreadMessage({ instantlyId, threadId, body, intent });
    params.notice =
      intent === "draft"
        ? "Draft saved on this thread. Nothing was sent."
        : "Sent through Instantly.";
  } catch (error) {
    params.error = messageOf(error);
  }
  campaign(instantlyId, params);
}

export interface TestState {
  status: "idle" | "ok" | "error";
  message?: string;
  decision?: AgentDecision;
  thread?: ThreadMessage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHistory(value: FormDataEntryValue | null): ThreadMessage[] {
  if (typeof value !== "string" || value.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const messages: ThreadMessage[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const direction = item.direction;
    if (direction !== "inbound" && direction !== "outbound") continue;
    const body = typeof item.body === "string" ? item.body : "";
    if (!body) continue;
    messages.push({
      direction,
      from: typeof item.from === "string" ? item.from : "",
      subject: typeof item.subject === "string" ? item.subject : "",
      body,
      timestamp: typeof item.timestamp === "string" ? item.timestamp : "",
    });
  }
  return messages.slice(-12);
}

/** Runs the live prompt against the editor's current playbook. Does not
 *  read or write the saved document, and does not call Instantly. */
export async function testPlaybookAction(
  _previous: TestState,
  formData: FormData,
): Promise<TestState> {
  try {
    const result = await testPlaybook({
      playbook: String(formData.get("playbook") ?? ""),
      history: readHistory(formData.get("history")),
      inbound: {
        from: String(formData.get("from") ?? ""),
        subject: String(formData.get("subject") ?? ""),
        body: String(formData.get("message") ?? ""),
      },
    });
    return {
      status: "ok",
      decision: result.decision,
      thread: result.thread,
    };
  } catch (error) {
    return { status: "error", message: messageOf(error) };
  }
}
