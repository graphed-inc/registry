import type { Generated } from "kysely";

export interface ExampleHeartbeatsTable {
  id: Generated<number>;
  message: string;
  created_at: Generated<Date>;
}

// The single source of truth for table types — dashboard pages and jobs both
// query through this. Add a row type per migration (plugins do this too).
// (Applied migrations are tracked in kysely's own kysely_migration table,
// which is intentionally not part of this schema.)
export interface Database {
  example_heartbeats: ExampleHeartbeatsTable;
}
