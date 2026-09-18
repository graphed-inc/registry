export type AgentTraceEvent = {
  type: "text" | "tool";
  name?: string;
  input?: unknown;
  output?: unknown;
  text?: string;
  startedAt?: string;
  durationMs?: number;
};

export type AgentTrace = {
  events: AgentTraceEvent[];
  model?: string;
};

export function emptyTrace(): AgentTrace {
  return { events: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTraceEvent(value: unknown): value is AgentTraceEvent {
  if (!isRecord(value)) return false;
  return value.type === "text" || value.type === "tool";
}

export function parseStoredTrace(value: unknown): AgentTrace {
  if (!isRecord(value)) return emptyTrace();
  const events = Array.isArray(value.events)
    ? value.events.filter(isTraceEvent)
    : [];
  return {
    events,
    model: typeof value.model === "string" ? value.model : undefined,
  };
}

type StepLike = {
  text?: string;
  toolCalls?: {
    payload?: { toolCallId?: string; toolName?: string; args?: unknown };
  }[];
  toolResults?: {
    payload?: { toolCallId?: string; toolName?: string; result?: unknown };
  }[];
  response?: { modelId?: string };
};

export function extractTrace(result: {
  text?: string;
  steps?: StepLike[];
}): AgentTrace {
  const events: AgentTraceEvent[] = [];
  let model: string | undefined;

  for (const step of result.steps ?? []) {
    model ??= step.response?.modelId;
    for (const call of step.toolCalls ?? []) {
      const payload = call.payload;
      const match = step.toolResults?.find(
        (row) => row.payload?.toolCallId === payload?.toolCallId,
      );
      events.push({
        type: "tool",
        name: payload?.toolName,
        input: payload?.args,
        output: match?.payload?.result,
      });
    }
    if (step.text?.trim()) {
      events.push({ type: "text", text: step.text });
    }
  }

  if (events.length === 0 && result.text?.trim()) {
    events.push({ type: "text", text: result.text });
  }

  return { events, model };
}
