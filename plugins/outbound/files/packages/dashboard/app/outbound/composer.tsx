"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { composeReplyAction } from "./actions";

function DraftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="intent"
      value="draft"
      variant="outline"
      size="sm"
      disabled={disabled || pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : null}
      Save draft
    </Button>
  );
}

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="intent"
      value="send"
      size="sm"
      disabled={disabled || pending}
      onClick={(event) => {
        if (!window.confirm("Send this reply through Instantly?")) {
          event.preventDefault();
        }
      }}
    >
      Send
    </Button>
  );
}

export function ThreadComposer({
  instantlyId,
  threadId,
  initialBody,
}: {
  instantlyId: string;
  threadId: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const empty = body.trim().length === 0;

  return (
    <form action={composeReplyAction} className="space-y-2 border-t bg-card/40 p-3">
      <input type="hidden" name="instantlyId" value={instantlyId} />
      <input type="hidden" name="threadId" value={threadId} />
      <Textarea
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Write a reply…"
        className="min-h-[96px] bg-background"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Save draft keeps it on this thread. Send delivers it now from the
          Instantly inbox that received the reply.
        </p>
        <div className="flex items-center gap-2">
          <DraftButton disabled={empty} />
          <SendButton disabled={empty} />
        </div>
      </div>
    </form>
  );
}
