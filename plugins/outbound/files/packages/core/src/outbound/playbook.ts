/** Present in the starter document. The inbox job will not draft or send
 *  until a person deletes this line. The test console ignores it. */
export const PLAYBOOK_INCOMPLETE_MARKER = "FILL IN BEFORE GOING LIVE";

export const REPLY_MODES = ["off", "draft", "send"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export function isReplyMode(value: string): value is ReplyMode {
  return value === "off" || value === "draft" || value === "send";
}

export function replyModeLabel(mode: ReplyMode): string {
  if (mode === "off") return "Off";
  if (mode === "draft") return "Draft replies";
  return "Auto-send";
}

/** Instantly campaign status codes. */
export function instantlyStatusLabel(status: number | null): string {
  if (status === 0) return "Draft";
  if (status === 1) return "Active";
  if (status === 2) return "Paused";
  if (status === 3) return "Completed";
  if (status === 4) return "Subsequences";
  if (status === -1) return "Unhealthy";
  if (status === -2) return "Bounce protect";
  if (status === -99) return "Suspended";
  if (status === null) return "Unknown";
  return `Status ${status}`;
}

export const STARTER_PLAYBOOK = `Status: ${PLAYBOOK_INCOMPLETE_MARKER}

# Reply playbook

You are continuing a cold email thread. This document is the only source of truth for the offer, the voice, and the limits. If it does not say something, do not invent it — escalate.

## Who you are

- Sender name: (your name)
- Company: (company and website)
- Role: Partnerships
- Sign every reply with the sender name.
- If they write in another language, reply in that language.

## What we sell

(Two or three sentences. Who it is for, what it does, how it is priced.)

## The offer

- Opening terms:
- What they get:
- The only link you may send:

## Limits you must not cross

| Lever | Opening | Maximum | Notes |
| --- | --- | --- | --- |
|  |  |  |  |

Anything outside this table is an escalation, not a negotiation.

## How to handle the thread

1. First reply: thank them, restate the offer in their words, ask one question.
2. Objection: answer it once from this document, then stop pitching.
3. Yes: confirm the terms in one short paragraph and send the link above.
4. No: thank them, leave the door open, and treat the deal as declined.
5. Auto-replies, out-of-office, bounces: ignore.
6. Unsubscribe or "stop emailing me": escalate so a person can remove them.

## Tone

- Short. Two to four paragraphs.
- A real person, not a newsletter.
- One question per email.
- No markdown, no bullet lists, no emojis unless they used them first.

## Answer these without escalating

- Question: answer

## Always escalate when

- They ask for more than the limits.
- They want a call, a contract, custom legal terms, or a different inbox.
- They are angry, mention spam, or threaten anything.
- The thread has gone four rounds without a decision.
- You are not sure.

When you escalate, send nothing.
`;

export function playbookReady(playbook: string): boolean {
  const text = playbook.trim();
  if (text.length < 40) return false;
  return !text.includes(PLAYBOOK_INCOMPLETE_MARKER);
}

/** What the inbox job should do with a campaign's saved settings. */
export function jobDisposition(
  mode: ReplyMode,
  playbook: string,
): "skip-off" | "skip-incomplete" | "draft" | "send" {
  if (mode === "off") return "skip-off";
  if (!playbookReady(playbook)) return "skip-incomplete";
  return mode;
}
