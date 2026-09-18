import { randomUUID } from "node:crypto";
import { getDb } from "../db/index";
import type { AgentTrace } from "./trace";

export async function memoryGet(
  clientKey: string,
  keys?: string[],
): Promise<{ key: string; value: string; updatedAt: string }[]> {
  let query = getDb()
    .selectFrom("google_ads_memory")
    .select(["key", "value", "updated_at"])
    .where("client_key", "=", clientKey);
  if (keys && keys.length > 0) {
    query = query.where("key", "in", keys);
  }
  const rows = await query.orderBy("key").execute();
  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at.toISOString(),
  }));
}

export async function memorySet(
  clientKey: string,
  key: string,
  value: string,
): Promise<{ key: string; updatedAt: string }> {
  const row = await getDb()
    .insertInto("google_ads_memory")
    .values({ client_key: clientKey, key, value })
    .onConflict((oc) =>
      oc.columns(["client_key", "key"]).doUpdateSet({
        value,
        updated_at: new Date(),
      }),
    )
    .returning(["key", "updated_at"])
    .executeTakeFirstOrThrow();
  return { key: row.key, updatedAt: row.updated_at.toISOString() };
}

export async function createRun(
  clientKey: string,
  dryRun: boolean,
): Promise<string> {
  const id = `run_${randomUUID()}`;
  await getDb()
    .insertInto("google_ads_runs")
    .values({
      id,
      client_key: clientKey,
      dry_run: dryRun,
      status: "running",
      messages: [],
    })
    .execute();
  return id;
}

export async function finishRun(input: {
  id: string;
  status: "succeeded" | "failed";
  report: string;
  messages: AgentTrace;
}): Promise<void> {
  await getDb()
    .updateTable("google_ads_runs")
    .set({
      status: input.status,
      report: input.report,
      finished_at: new Date(),
      messages: input.messages,
    })
    .where("id", "=", input.id)
    .execute();
}

export async function recordAction(input: {
  clientKey: string;
  runId: string;
  tool: string;
  payload: unknown;
  result: unknown;
  dryRun: boolean;
  reason?: string;
}): Promise<void> {
  await getDb()
    .insertInto("google_ads_actions")
    .values({
      client_key: input.clientKey,
      run_id: input.runId,
      tool: input.tool,
      input: input.payload,
      result: input.result,
      dry_run: input.dryRun,
      reason: input.reason ?? null,
    })
    .execute();
}

export async function listRuns(clientKey: string, limit = 40) {
  return getDb()
    .selectFrom("google_ads_runs")
    .select([
      "id",
      "started_at",
      "finished_at",
      "dry_run",
      "status",
      "report",
    ])
    .where("client_key", "=", clientKey)
    .orderBy("started_at", "desc")
    .limit(limit)
    .execute();
}

export async function getRun(id: string, clientKey: string) {
  return getDb()
    .selectFrom("google_ads_runs")
    .selectAll()
    .where("id", "=", id)
    .where("client_key", "=", clientKey)
    .executeTakeFirst();
}

export async function listActions(runId: string) {
  return getDb()
    .selectFrom("google_ads_actions")
    .selectAll()
    .where("run_id", "=", runId)
    .orderBy("created_at", "asc")
    .execute();
}
