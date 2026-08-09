import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { coreEnv } from "../config";
import type { Database } from "./types";

// One pool per process. The globalThis stash survives Next.js dev hot-reloads
// and is harmless in short-lived job processes.
const globalForDb = globalThis as unknown as { __appDb?: Kysely<Database> };

export function getDb(): Kysely<Database> {
  if (!globalForDb.__appDb) {
    globalForDb.__appDb = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: coreEnv().DATABASE_URL }),
      }),
    });
  }
  return globalForDb.__appDb;
}

/** Job entrypoints must call this before exiting, or the pool keeps the process alive. */
export async function destroyDb(): Promise<void> {
  if (!globalForDb.__appDb) return;
  await globalForDb.__appDb.destroy();
  globalForDb.__appDb = undefined;
}
