import type { AgentTrace, AgentTraceEvent } from "@app/core/google-ads/trace";

import { Badge } from "@/components/ui/badge";

function preview(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ToolEvent({ event }: { event: AgentTraceEvent }) {
  return (
    <div className="rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="font-mono text-xs text-emerald-600 dark:text-emerald-300">
            {event.name ?? "tool"}
          </span>
        </div>
        {event.durationMs != null ? (
          <span className="text-[11px] text-muted-foreground">
            {event.durationMs}ms
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Input
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
            {preview(event.input)}
          </pre>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Output
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/80">
            {preview(event.output)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export function SessionTrace({
  trace,
  report,
}: {
  trace: AgentTrace;
  report: string | null;
}) {
  const tools = trace.events.filter((event) => event.type === "tool");

  return (
    <div className="space-y-5">
      {trace.model ? (
        <Badge variant="info" className="font-mono">
          {trace.model}
        </Badge>
      ) : null}

      {report ? (
        <div className="rounded-xl border bg-muted/20 p-5">
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Final report
          </div>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
            {report}
          </pre>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Mastra trace</h3>
          <span className="text-xs text-muted-foreground">
            {tools.length} tool {tools.length === 1 ? "call" : "calls"}
          </span>
        </div>
        {trace.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tool events were persisted for this run.
          </p>
        ) : (
          <ol className="space-y-3">
            {trace.events.map((event, index) => (
              <li key={`${event.type}-${index}`}>
                {event.type === "tool" ? (
                  <ToolEvent event={event} />
                ) : (
                  <div className="rounded-lg border px-4 py-3 text-sm leading-relaxed text-foreground/85">
                    {event.text}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
