"use client";

import { useEffect, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FlaskConical, Loader2, RotateCcw, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AgentDecision, ThreadMessage } from "@app/core/outbound/agent";
import { PLAYBOOK_INCOMPLETE_MARKER } from "@app/core/outbound/playbook";
import { savePlaybookAction, testPlaybookAction, type TestState } from "./actions";

const idleTestState: TestState = { status: "idle" };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Save />}
      Save playbook
    </Button>
  );
}

function TestButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          Asking the agent…
        </>
      ) : (
        <>
          <FlaskConical />
          Test this draft
        </>
      )}
    </Button>
  );
}

function DecisionCard({ decision }: { decision: AgentDecision }) {
  if (decision.action === "reply" && decision.reply_body) {
    return (
      <div className="rounded-md border bg-background p-4">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="success">Reply</Badge>
          <span className="text-xs text-muted-foreground">
            Not sent — this was a fake message
          </span>
        </div>
        <div className="text-sm font-medium">
          {decision.reply_subject || "Re:"}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
          {decision.reply_body}
        </p>
      </div>
    );
  }
  if (decision.action === "escalate") {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <Badge variant="warning">Escalate</Badge>
        <p className="mt-2 whitespace-pre-wrap">
          {decision.escalation_reason ||
            "The agent would hand this to a person and send nothing."}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border p-4 text-sm">
      <Badge variant="secondary">Ignore</Badge>
      <p className="mt-2 text-muted-foreground">
        The agent would skip this message (auto-reply, bounce, or out of office).
      </p>
    </div>
  );
}

export function PlaybookStudio({
  instantlyId,
  savedPlaybook,
}: {
  instantlyId: string;
  savedPlaybook: string;
}) {
  const [playbook, setPlaybook] = useState(savedPlaybook);
  const [from, setFrom] = useState("prospect@example.com");
  const [subject, setSubject] = useState("Re: quick question");
  const [message, setMessage] = useState("");
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [testState, testDispatch] = useFormState(
    testPlaybookAction,
    idleTestState,
  );

  useEffect(() => {
    if (testState.status === "ok" && testState.thread) {
      setThread(testState.thread);
      setMessage("");
    }
  }, [testState]);

  const dirty = playbook !== savedPlaybook;
  const incomplete = playbook.includes(PLAYBOOK_INCOMPLETE_MARKER);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Playbook</CardTitle>
              <CardDescription>
                The document the agent follows for this campaign. The test
                uses whatever is in this box, saved or not. Set reply mode
                from the Unibox tab.
              </CardDescription>
            </div>
            {dirty ? (
              <Badge variant="warning">Unsaved</Badge>
            ) : (
              <Badge variant="secondary">Saved</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {incomplete ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              This is still the starter. Delete the “{PLAYBOOK_INCOMPLETE_MARKER}” line
              before turning on drafts or auto-send. You can test it before that.
            </p>
          ) : null}

          <Textarea
            value={playbook}
            onChange={(event) => setPlaybook(event.target.value)}
            className="min-h-[420px] font-mono text-xs leading-relaxed"
            spellCheck={false}
          />

          <form action={savePlaybookAction}>
            <input type="hidden" name="instantlyId" value={instantlyId} />
            <input type="hidden" name="playbook" value={playbook} />
            <SaveButton />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test with a fake message</CardTitle>
          <CardDescription>
            Same prompt the inbox job uses. Nothing is saved and Instantly
            is not contacted.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {thread.length > 0 ? (
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {thread.map((item, index) => (
                <div
                  key={`${item.timestamp}-${index}`}
                  className={
                    item.direction === "inbound"
                      ? "rounded-md border bg-muted/30 p-3 text-sm"
                      : "rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm"
                  }
                >
                  <div className="mb-1 text-xs text-muted-foreground">
                    {item.direction === "inbound" ? item.from : "Agent"}
                    {item.subject ? ` · ${item.subject}` : ""}
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed">{item.body}</p>
                </div>
              ))}
            </div>
          ) : null}

          <form action={testDispatch} className="space-y-3">
            <input type="hidden" name="playbook" value={playbook} />
            <input type="hidden" name="history" value={JSON.stringify(thread)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="from">From</Label>
                <input
                  id="from"
                  name="from"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <input
                  id="subject"
                  name="subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="message">Their message</Label>
              <Textarea
                id="message"
                name="message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Hey — what does this cost, and is there a contract?"
                className="min-h-[120px]"
              />
            </div>
            <div className="flex items-center gap-3">
              <TestButton />
              {thread.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setThread([])}
                >
                  <RotateCcw />
                  New conversation
                </Button>
              ) : null}
            </div>
          </form>

          {testState.status === "error" ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {testState.message}
            </p>
          ) : null}
          {testState.status === "ok" && testState.decision ? (
            <DecisionCard decision={testState.decision} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
