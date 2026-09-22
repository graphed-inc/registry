import { type Kysely, sql } from "kysely";

// The whole SEO plugin schema in one file — this is a kit template, and the
// number is a placeholder: the integrating agent renames it to the project's
// next free migration number (see AGENT.md).
//
//   seo_keywords        the queue the daily publish job consumes
//   seo_articles        one row per generated article, keyed by slug
//   seo_playbooks       dashboard-edited overrides for the pipeline stage
//                       instructions (defaults live in code — seo/playbooks.ts)
//   seo_article_audits  one row per slug from the refresh job (decision,
//                       Search Console snapshot, gap trace)
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("seo_keywords")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("keyword", "text", (col) => col.notNull())
    .addColumn("slug", "text", (col) => col.notNull().unique())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("priority", "integer")
    .addColumn("last_error", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("seo_articles")
    .addColumn("id", "bigserial", (col) => col.primaryKey())
    .addColumn("keyword_id", "bigint", (col) =>
      col.references("seo_keywords.id").onDelete("set null"),
    )
    .addColumn("slug", "text", (col) => col.notNull().unique())
    .addColumn("title", "text")
    .addColumn("meta_description", "text")
    .addColumn("excerpt", "text")
    .addColumn("markdown", "text")
    .addColumn("pre_refresh_markdown", "text")
    .addColumn("cms", "text")
    .addColumn("cms_post_id", "text")
    .addColumn("public_url", "text")
    .addColumn("status", "text", (col) => col.notNull().defaultTo("generated"))
    .addColumn("published_at", "timestamptz")
    .addColumn("last_error", "text")
    .addColumn("created_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("seo_playbooks")
    .addColumn("stage", "text", (col) => col.primaryKey())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createTable("seo_article_audits")
    .addColumn("slug", "text", (col) => col.primaryKey())
    .addColumn("title", "text")
    .addColumn("dupe_of", "text")
    .addColumn("word_count", "integer", (col) => col.notNull())
    .addColumn("impressions_28d", "double precision")
    .addColumn("clicks_28d", "double precision")
    .addColumn("ctr_28d", "double precision")
    .addColumn("avg_position_28d", "double precision")
    .addColumn("decision", "text", (col) => col.notNull())
    .addColumn("decision_reason", "text", (col) => col.notNull())
    .addColumn("gap_trace", "jsonb", (col) => col.notNull())
    .addColumn("audited_at", "timestamptz", (col) => col.notNull())
    .addColumn("refreshed_at", "timestamptz")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("seo_article_audits").execute();
  await db.schema.dropTable("seo_playbooks").execute();
  await db.schema.dropTable("seo_articles").execute();
  await db.schema.dropTable("seo_keywords").execute();
}
