"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { replyModeLabel, type ReplyMode } from "@app/core/outbound/playbook";
import { saveReplyModeAction } from "./actions";

const MODES: { id: ReplyMode; hint: string }[] = [
  { id: "off", hint: "The inbox job ignores this campaign." },
  {
    id: "draft",
    hint: "Replies are written and stored here. Nothing is sent.",
  },
  {
    id: "send",
    hint: "Replies are sent from the Instantly inbox that received them.",
  },
];

function modeVariant(mode: ReplyMode): "secondary" | "info" | "success" {
  if (mode === "send") return "success";
  if (mode === "draft") return "info";
  return "secondary";
}

function SaveButton({ unchanged }: { unchanged: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || unchanged}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      Save
    </Button>
  );
}

export function ReplyModeControl({
  instantlyId,
  mode,
  threadId,
}: {
  instantlyId: string;
  mode: ReplyMode;
  threadId?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<ReplyMode>(mode);

  useEffect(() => {
    setSelected(mode);
  }, [mode]);

  function open() {
    setSelected(mode);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open}>
        Configure auto-response
        <Badge variant={modeVariant(mode)}>{replyModeLabel(mode)}</Badge>
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="w-[min(28rem,calc(100%-2rem))] rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/70"
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        onClose={() => setSelected(mode)}
      >
        <form action={saveReplyModeAction} className="space-y-4 p-5">
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              Configure auto-response
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Current mode: {replyModeLabel(mode)}
            </p>
          </div>
          <input type="hidden" name="instantlyId" value={instantlyId} />
          <input type="hidden" name="thread" value={threadId ?? ""} />
          <fieldset className="space-y-2">
            <legend className="sr-only">Auto-response mode</legend>
            {MODES.map((item) => {
              const active = selected === item.id;
              return (
                <label
                  key={item.id}
                  className={
                    active
                      ? "flex cursor-pointer gap-3 rounded-md border border-foreground/20 bg-accent px-3 py-2.5"
                      : "flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 hover:bg-accent/60"
                  }
                >
                  <input
                    type="radio"
                    name="replyMode"
                    value={item.id}
                    checked={active}
                    onChange={() => setSelected(item.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {replyModeLabel(item.id)}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={close}>
              Cancel
            </Button>
            <SaveButton unchanged={selected === mode} />
          </div>
        </form>
      </dialog>
    </>
  );
}
