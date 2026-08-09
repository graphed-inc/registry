"use client";

// Playbook studio — editor and test console on one page. All five stages'
// contents live in client state, so a test run sends the CURRENT (possibly
// unsaved) playbooks over the wire: you can iterate against real output
// without touching what the live cron job will use, then save when happy.
//
// useFormState (react-dom) is the React 18 / Next 14 form-state hook;
// React 19 renamed it useActionState.
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { FlaskConical, Loader2, RotateCcw, Save } from "lucide-react";
import { markdownToHtml } from "@app/core/seo/markdown";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  savePlaybookAction,
  resetPlaybookAction,
  testKeywordAction,
  type PlaybookSaveState,
  type TestRunState,
} from "./actions";

interface StudioProps {
  stages: readonly { key: string; label: string }[];
  // Code defaults (for "reset" and the dirty indicator baseline).
  defaults: Record<string, string>;
  // Effective contents at load (default + override applied).
  initial: Record<string, string>;
  overridden: string[];
  initialStage?: string;
}

function SaveButtons({
  overridden,
  onReset,
}: {
  overridden: boolean;
  onReset: (payload: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center gap-2">
      {overridden ? (
        <Button
          type="submit"
          variant="outline"
          size="sm"
          formAction={onReset}
          disabled={pending}
        >
          <RotateCcw />
          Reset to default
        </Button>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />}
        Save
      </Button>
    </div>
  );
}

function RunButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          Running — a couple of minutes
        </>
      ) : (
        <>
          <FlaskConical />
          Run pipeline
        </>
      )}
    </Button>
  );
}

const idleSave: PlaybookSaveState = { status: "idle" };
const idleTest: TestRunState = { status: "idle" };

export function PlaybookStudio({
  stages,
  defaults,
  initial,
  overridden,
  initialStage,
}: StudioProps) {
  const [active, setActive] = useState(
    initialStage && stages.some((s) => s.key === initialStage)
      ? initialStage
      : stages[0].key,
  );
  const [contents, setContents] = useState(initial);
  // Last-persisted contents — the dirty indicator diffs against this.
  const [saved, setSaved] = useState(initial);
  const [overrides, setOverrides] = useState(new Set(overridden));

  const contentsRef = useRef(contents);
  contentsRef.current = contents;

  const [saveState, saveDispatch] = useFormState(savePlaybookAction, idleSave);
  const [resetState, resetDispatch] = useFormState(resetPlaybookAction, idleSave);

  useEffect(() => {
    if (saveState.status === "ok" && saveState.stage) {
      const stage = saveState.stage;
      setSaved((prev) => ({ ...prev, [stage]: contentsRef.current[stage] }));
      setOverrides((prev) => new Set(prev).add(stage));
    }
  }, [saveState]);

  useEffect(() => {
    if (resetState.status === "ok" && resetState.stage) {
      const stage = resetState.stage;
      setContents((prev) => ({ ...prev, [stage]: defaults[stage] }));
      setSaved((prev) => ({ ...prev, [stage]: defaults[stage] }));
      setOverrides((prev) => {
        const next = new Set(prev);
        next.delete(stage);
        return next;
      });
    }
  }, [resetState, defaults]);

  const [testState, testDispatch] = useFormState(testKeywordAction, idleTest);

  const dirty = contents[active] !== saved[active];
  const overriddenActive = overrides.has(active);
  const actionMessage =
    saveState.status !== "idle" && saveState.stage === active
      ? saveState
      : resetState.status !== "idle" && resetState.stage === active
        ? resetState
        : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Playbook</CardTitle>
          <CardDescription>
            The instructions each generation stage follows (research → outline
            → draft → edit → fact-check). Edit freely — nothing here affects
            the live job until you save; the test below runs on your unsaved
            text.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1">
            {stages.map((stage) => (
              <button
                key={stage.key}
                type="button"
                onClick={() => setActive(stage.key)}
                className={
                  stage.key === active
                    ? "inline-flex items-center gap-1.5 rounded-sm bg-background px-3 py-1 text-xs font-medium shadow-sm"
                    : "inline-flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                }
              >
                {stage.label}
                {overrides.has(stage.key) ? (
                  <span
                    title="Customized"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70"
                  />
                ) : null}
              </button>
            ))}
          </div>
          <form action={saveDispatch} className="mt-4">
            <input type="hidden" name="stage" value={active} />
            <input type="hidden" name="content" value={contents[active]} />
            <textarea
              key={active}
              rows={9}
              value={contents[active]}
              onChange={(event) =>
                setContents((prev) => ({
                  ...prev,
                  [active]: event.target.value,
                }))
              }
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {actionMessage ? (
                  <span
                    className={
                      actionMessage.status === "error"
                        ? "text-red-400"
                        : "text-emerald-400"
                    }
                  >
                    {actionMessage.message}
                  </span>
                ) : (
                  <>
                    {overriddenActive ? "Customized" : "Using the default"}
                    {dirty ? " · unsaved changes" : ""}. Hard rules (no links,
                    no dashes, no aging dates) live in code, not here.
                  </>
                )}
              </p>
              <SaveButtons overridden={overriddenActive} onReset={resetDispatch} />
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Test the pipeline</CardTitle>
          <CardDescription>
            Run research → outline → draft → edit → fact-check on any keyword
            with the playbooks exactly as they are on this page — saved or
            not. Writes nothing: no queue row, no article, no CMS call.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={testDispatch} className="flex gap-2">
            {stages.map((stage) => (
              <input
                key={stage.key}
                type="hidden"
                name={`pb_${stage.key}`}
                value={contents[stage.key]}
              />
            ))}
            <input
              name="keyword"
              type="text"
              required
              placeholder="e.g. best crm for plumbers"
              className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <RunButton />
          </form>
        </CardContent>
      </Card>

      {testState.status === "error" ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {testState.error}
        </div>
      ) : null}

      {testState.status === "done" && testState.article ? (
        <>
          {testState.events && testState.events.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Stage log</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2">
                  {testState.events.map((event, i) => (
                    <li key={i} className="flex items-baseline gap-3 text-sm">
                      <Badge variant="secondary" className="shrink-0 font-mono">
                        {event.stage}
                      </Badge>
                      <span className="text-muted-foreground">
                        {event.detail}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {testState.article.title}
              </CardTitle>
              <CardDescription className="italic">
                {testState.article.meta_description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className="[&_a]:text-sky-400 [&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_li]:text-sm [&_li]:text-foreground/80 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-foreground/80 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{
                  __html: markdownToHtml(testState.article.markdown),
                }}
              />
              <details className="mt-6 rounded-md border">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
                  Raw markdown
                </summary>
                <pre className="overflow-x-auto border-t px-3 py-3 text-xs text-muted-foreground">
                  {testState.article.markdown}
                </pre>
              </details>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
