import { createAdsAgent } from "./agent";
import { loadClientConfig } from "./config";
import { createRunContext, type AgentRunContext } from "./context";
import { appendDroppedNameListNote } from "./name-list";
import { createRun, finishRun } from "./store";
import { extractTrace } from "./trace";
import { writesEnabled, type LoadedClientConfig } from "./types";

function withDropNote(report: string, client: LoadedClientConfig): string {
  return appendDroppedNameListNote(report, client.nameListDrops);
}

export type AdsAgentRunResult = {
  runId: string;
  status: "succeeded" | "failed";
  report: string;
  infrastructure: boolean;
};

export async function runAdsAgent(): Promise<AdsAgentRunResult> {
  const client = loadClientConfig();
  const dryRun = !writesEnabled(client);
  const runId = await createRun(client.client_key, dryRun);
  let ctx: AgentRunContext;
  try {
    ctx = await createRunContext(client, runId);
  } catch (error) {
    // Malformed GOOGLE_ADS_SA_KEY_JSON (and similar setup errors) must
    // not strand a `running` row — finishRun never ran when this sat
    // above the try.
    const report = withDropNote(
      error instanceof Error ? error.message : "bad Ads config",
      client,
    );
    await finishRun({
      id: runId,
      status: "failed",
      report,
      messages: { events: [{ type: "text", text: report }] },
    });
    return { runId, status: "failed", report, infrastructure: true };
  }
  const today = new Date().toISOString().slice(0, 10);
  const prompt = [
    `Run today's account review for ${client.client_key}.`,
    `Date: ${today}.`,
    `WRITES_ENABLED=${writesEnabled(client)}.`,
    `LOOP_OWNS_PROMOTIONS=${client.agent.loop_owns_promotions}.`,
  ].join(" ");

  try {
    const agent = createAdsAgent(ctx);
    const result = await agent.generate(prompt, { maxSteps: 24, runId });
    const trace = extractTrace(result);
    const report = withDropNote(
      result.text.trim() || "No report produced.",
      client,
    );
    const status = result.error ? "failed" : "succeeded";
    await finishRun({ id: runId, status, report, messages: trace });
    return {
      runId,
      status,
      report,
      infrastructure: Boolean(result.error),
    };
  } catch (error) {
    const report = withDropNote(
      error instanceof Error ? error.message : "agent failed",
      client,
    );
    await finishRun({
      id: runId,
      status: "failed",
      report,
      messages: { events: [{ type: "text", text: report }] },
    });
    return { runId, status: "failed", report, infrastructure: true };
  }
}
