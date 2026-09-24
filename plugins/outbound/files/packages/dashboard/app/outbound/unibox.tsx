import { Badge } from "@/components/ui/badge";
import type { OutboundActivity } from "@app/core/outbound/campaigns";
import type { InstantlyEmail } from "@app/core/outbound/instantly";
import { PLAYBOOK_INCOMPLETE_MARKER, playbookReady, type ReplyMode } from "@app/core/outbound/playbook";
import { ThreadComposer } from "./composer";
import { ReplyModeControl } from "./reply-mode";

export interface UniboxThread {
  threadId: string;
  lead: string;
  subject: string;
  preview: string;
  timestamp: string;
  unread: boolean;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= 140) return flat;
  return `${flat.slice(0, 137)}…`;
}

export function threadsFromEmails(emails: InstantlyEmail[]): UniboxThread[] {
  const sorted = [...emails].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );
  const threads: UniboxThread[] = [];
  const seen = new Set<string>();
  for (const email of sorted) {
    if (seen.has(email.threadId)) continue;
    seen.add(email.threadId);
    const inbound = email.ueType === 2;
    threads.push({
      threadId: email.threadId,
      lead: email.lead || (inbound ? email.from : email.to) || "Unknown",
      subject: email.subject || "(no subject)",
      preview: previewOf(email.body) || "(empty)",
      timestamp: email.timestamp,
      unread: email.isUnread,
    });
    if (threads.length >= 40) break;
  }
  return threads;
}

function outcomeVariant(
  outcome: string,
): "secondary" | "info" | "success" | "warning" | "destructive" {
  if (outcome === "sent") return "success";
  if (outcome === "draft") return "info";
  if (outcome === "escalated") return "warning";
  if (outcome === "failed") return "destructive";
  return "secondary";
}

export function Unibox({
  instantlyId,
  mode,
  playbook,
  threads,
  selectedId,
  messages,
  activity,
  error,
  hrefFor,
}: {
  instantlyId: string;
  mode: ReplyMode;
  playbook: string;
  threads: UniboxThread[];
  selectedId: string | null;
  messages: InstantlyEmail[];
  activity: OutboundActivity[];
  error: string | null;
  hrefFor: (threadId: string) => string;
}) {
  const incomplete = mode !== "off" && !playbookReady(playbook);
  const ordered = [...messages].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const manualDraft = [...activity]
    .reverse()
    .find(
      (item) =>
        item.outcome === "draft" && item.emailId.startsWith("manual-draft:"),
    );
  const canReply = ordered.some((email) => email.ueType === 2);

  return (
    <div className="space-y-4">
      <ReplyModeControl
        instantlyId={instantlyId}
        mode={mode}
        threadId={selectedId ?? undefined}
      />
      {incomplete ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          The inbox job skips this campaign until the playbook no longer
          contains “{PLAYBOOK_INCOMPLETE_MARKER}”.
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[560px] overflow-hidden rounded-lg border lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="max-h-[70vh] overflow-y-auto border-b lg:border-b-0 lg:border-r">
          {threads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No mail in this campaign yet.
            </p>
          ) : (
            threads.map((thread) => {
              const active = thread.threadId === selectedId;
              return (
                <a
                  key={thread.threadId}
                  href={hrefFor(thread.threadId)}
                  className={
                    active
                      ? "block border-b bg-accent px-3 py-3"
                      : "block border-b px-3 py-3 hover:bg-accent/50"
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {thread.unread ? "● " : ""}
                      {thread.lead}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatWhen(thread.timestamp)}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-foreground/80">
                    {thread.subject}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {thread.preview}
                  </div>
                </a>
              );
            })
          )}
        </aside>
        <section className="flex h-[70vh] min-h-[420px] flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {selectedId && ordered.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">
              This thread has no messages in the latest pull.
            </p>
          ) : null}
          {ordered.map((email) => {
            const inbound = email.ueType === 2;
            return (
              <div
                key={email.id}
                className={
                  inbound
                    ? "rounded-md border bg-muted/30 p-3 text-sm"
                    : "rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm"
                }
              >
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{inbound ? email.from || email.lead : email.eaccount || "Sent"}</span>
                  <span>{formatWhen(email.timestamp)}</span>
                  {email.subject ? <span className="truncate">{email.subject}</span> : null}
                </div>
                <p className="whitespace-pre-wrap leading-relaxed">
                  {email.body || "(empty)"}
                </p>
              </div>
            );
          })}
          {activity.map((item) => (
            <div key={item.emailId} className="rounded-md border border-dashed p-3 text-sm">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={outcomeVariant(item.outcome)}>{item.outcome}</Badge>
                <span className="text-xs text-muted-foreground">
                  {item.emailId.startsWith("manual-") ? "You" : "Agent"}
                  {" · "}
                  {formatWhen(item.createdAt.toISOString())}
                </span>
              </div>
              {item.replyBody ? (
                <p className="whitespace-pre-wrap leading-relaxed">{item.replyBody}</p>
              ) : item.note ? (
                <p className="text-muted-foreground">{item.note}</p>
              ) : null}
            </div>
          ))}
          </div>
          {selectedId && canReply ? (
            <ThreadComposer
              key={`${selectedId}:${manualDraft?.emailId ?? ""}:${manualDraft?.replyBody ?? ""}`}
              instantlyId={instantlyId}
              threadId={selectedId}
              initialBody={manualDraft?.replyBody ?? ""}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}
