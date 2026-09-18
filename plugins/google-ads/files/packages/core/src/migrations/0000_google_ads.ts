import { type Kysely, sql } from "kysely";

// The whole Google Ads plugin schema in one file — this is a kit template,
// and the number is a placeholder: the integrating agent renames it to the
// project's next free migration number (see AGENT.md).
//
//   google_ads_memory   standing notes the agent rewrites each run
//   google_ads_runs     one row per daily (or manual) agent session
//   google_ads_actions  every write-tool attempt, blocked or applied
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("google_ads_memory")
    .addColumn("client_key", "text", (col) => col.notNull())
    .addColumn("key", "text", (col) => col.notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint("google_ads_memory_pkey", ["client_key", "key"])
    .execute();

  await db.schema
    .createTable("google_ads_runs")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("client_key", "text", (col) => col.notNull())
    .addColumn("started_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("finished_at", "timestamptz")
    .addColumn("dry_run", "boolean", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("report", "text")
    .addColumn("messages", "jsonb", (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .execute();

  await db.schema
    .createIndex("google_ads_runs_client_started_idx")
    .on("google_ads_runs")
    .columns(["client_key", "started_at"])
    .execute();

  await db.schema
    .createTable("google_ads_actions")
    .addColumn("id", "uuid", (col) =>
      col.primaryKey().defaultTo(sql`gen_random_uuid()`),
    )
    .addColumn("client_key", "text", (col) => col.notNull())
    .addColumn("run_id", "text", (col) => col.notNull())
    .addColumn("tool", "text", (col) => col.notNull())
    .addColumn("input", "jsonb", (col) => col.notNull())
    .addColumn("result", "jsonb", (col) => col.notNull())
    .addColumn("dry_run", "boolean", (col) => col.notNull())
    .addColumn("reason", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("google_ads_actions_run_idx")
    .on("google_ads_actions")
    .column("run_id")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("google_ads_actions").execute();
  await db.schema.dropTable("google_ads_runs").execute();
  await db.schema.dropTable("google_ads_memory").execute();
}
