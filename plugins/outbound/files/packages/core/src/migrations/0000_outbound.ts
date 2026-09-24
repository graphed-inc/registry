import { type Kysely, sql } from "kysely";

// The whole outbound plugin schema in one file. The number is a placeholder:
// the integrating agent renames it to the project's next free migration
// (see AGENT.md).
//
//   outbound_campaigns  one row per Instantly campaign, with its playbook
//                       document and reply mode (off | draft | send)
//   outbound_threads    live thread status and reply count
//   outbound_activity   one row per inbound email the job has claimed
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("outbound_campaigns")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("instantly_id", "text", (col) => col.notNull().unique())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("instantly_status", "integer")
    .addColumn("reply_mode", "text", (col) => col.notNull().defaultTo("off"))
    .addColumn("playbook", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("inbox_since", "timestamptz")
    .addColumn("last_synced_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("outbound_threads")
    .addColumn("thread_id", "text", (col) => col.primaryKey())
    .addColumn("instantly_campaign_id", "text", (col) => col.notNull())
    .addColumn("lead_email", "text")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("open"))
    .addColumn("reply_count", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("outbound_activity")
    .addColumn("email_id", "text", (col) => col.primaryKey())
    .addColumn("thread_id", "text", (col) => col.notNull())
    .addColumn("instantly_campaign_id", "text", (col) => col.notNull())
    .addColumn("lead_email", "text")
    .addColumn("outcome", "text", (col) => col.notNull())
    .addColumn("subject", "text")
    .addColumn("inbound_body", "text")
    .addColumn("reply_subject", "text")
    .addColumn("reply_body", "text")
    .addColumn("note", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex("outbound_activity_campaign_created")
    .on("outbound_activity")
    .columns(["instantly_campaign_id", "created_at"])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("outbound_activity").execute();
  await db.schema.dropTable("outbound_threads").execute();
  await db.schema.dropTable("outbound_campaigns").execute();
}
