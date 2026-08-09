import { z } from "zod";
import { envSlice } from "../config";

// Platform-level ClickHouse access. The cloud runtime (and `graphed dev run`
// locally) injects GRAPHED_WAREHOUSE_URL and GRAPHED_TOKEN; this posts
// read-only SQL to the warehouse query endpoint and returns typed rows.
//
// Lives in the seo kit for copy-paste simplicity, but nothing here is
// seo-specific — if another plugin (or a newer scaffold) already provides
// packages/core/src/warehouse.ts, keep one copy and delete this file.

export interface WarehouseQueryResult {
  columns: string[];
  results: Record<string, unknown>[];
}

const warehouseEnvSchema = z.object({
  GRAPHED_WAREHOUSE_URL: z.string().url(),
  GRAPHED_TOKEN: z.string().min(1),
});

/** True when warehouse env vars are present (cloud runtime / dev run). */
export function warehouseConfigured(): boolean {
  const parsed = warehouseEnvSchema.safeParse(process.env);
  return parsed.success;
}

export async function warehouseQuery(
  sql: string,
  parameters: Record<string, string> = {},
): Promise<WarehouseQueryResult> {
  const env = envSlice(warehouseEnvSchema);
  const response = await fetch(env.GRAPHED_WAREHOUSE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GRAPHED_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql, parameters }),
  });
  if (!response.ok) {
    throw new Error(
      `Warehouse query failed: ${response.status} ${(await response.text()).slice(0, 500)}`,
    );
  }
  return (await response.json()) as WarehouseQueryResult;
}
