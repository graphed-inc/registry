import { Kysely, sql } from "kysely";

// Example table written by the example-daily cron job and rendered by the
// dashboard home page. Replace it with your own schema as you build.
//
// Migrations are numbered TypeScript modules (0002_*.ts, 0003_*.ts, ...)
// exporting up/down, applied once in order by `npm run db:migrate` (Kysely
// Migrator tracks them in its own kysely_migration table). Never edit an
// applied migration — add a new file.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("example_heartbeats")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("message", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("example_heartbeats").execute();
}
