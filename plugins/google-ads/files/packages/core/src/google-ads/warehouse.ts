import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";

// Platform-level ClickHouse access. The cloud runtime (and `graphed dev run`
// locally) injects GRAPHED_WAREHOUSE_URL and GRAPHED_TOKEN; this posts
// read-only SQL to the warehouse query endpoint and returns typed rows.
//
// Lives in the google-ads kit for copy-paste simplicity, but nothing here is
// ads-specific — if another plugin (or a newer scaffold) already provides
// packages/core/src/warehouse.ts, keep one copy and delete this file.

export interface WarehouseQueryResult {
  columns: string[];
  results: Record<string, unknown>[];
  /** Set by `warehouseQueryAllowMissing` when ClickHouse has no such table. */
  missingTable?: boolean;
}

export class WarehouseQueryError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Warehouse query failed: ${status} ${body.slice(0, 500)}`);
    this.name = "WarehouseQueryError";
    this.status = status;
    this.body = body;
  }
}

export type WarehouseQueryFn = (
  sql: string,
  parameters?: Record<string, string>,
) => Promise<WarehouseQueryResult>;

const queryOverride = new AsyncLocalStorage<WarehouseQueryFn>();

/** Run `fn` with a warehouse query stand-in. */
export function withWarehouseQuery<T>(
  query: WarehouseQueryFn,
  fn: () => Promise<T>,
): Promise<T> {
  return queryOverride.run(query, fn);
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
  const override = queryOverride.getStore();
  if (override) return override(sql, parameters);

  const { envSlice } = await import("../config");
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
    throw new WarehouseQueryError(response.status, await response.text());
  }
  return (await response.json()) as WarehouseQueryResult;
}

export function quoteSchema(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid warehouse schema name: ${schema}`);
  }
  return schema;
}

/** ClickHouse identifier for `client.metrics.googleAdsSchema`, or null if unset. */
export function schemaFromClient(client: {
  metrics: { googleAdsSchema: string };
}): string | null {
  const raw = client.metrics.googleAdsSchema.trim();
  return raw ? quoteSchema(raw) : null;
}

function warehouseErrorText(error: unknown): string {
  if (error instanceof WarehouseQueryError) return error.body;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isUnknownTableError(error: unknown): boolean {
  return /unknown table/i.test(warehouseErrorText(error));
}

/** Missing ClickHouse column — do not match on the SQL text we sent. */
export function isUnknownColumnError(error: unknown): boolean {
  return /unknown (expression )?identifier|there('| i)s no column|missing columns?:/i.test(
    warehouseErrorText(error),
  );
}

/**
 * Same as `warehouseQuery`, but a missing Fivetran table returns empty
 * rows with `missingTable: true` so callers can fall back to Ads search.
 */
export async function warehouseQueryAllowMissing(
  sql: string,
  parameters: Record<string, string> = {},
): Promise<WarehouseQueryResult> {
  try {
    return await warehouseQuery(sql, parameters);
  } catch (error) {
    if (isUnknownTableError(error)) {
      return { columns: [], results: [], missingTable: true };
    }
    throw error;
  }
}

/** Digits-only id for interpolating into warehouse SQL. Strips Ads dashes. */
export function quoteNumericId(value: string, label = "id"): string {
  const id = value.replace(/-/g, "");
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return id;
}
