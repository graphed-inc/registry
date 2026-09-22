import type { ColumnType, Generated, RawBuilder } from "kysely";

// Row types for the SEO plugin's tables (migration: src/migrations/0000_seo.ts).
// AGENT.md step: register them in packages/core/src/db/types.ts —
//   import type { SeoArticleAuditsTable, SeoArticlesTable, SeoKeywordsTable, SeoPlaybooksTable } from "../seo/tables";
//   ...and add `seo_keywords` / `seo_articles` / `seo_playbooks` / `seo_article_audits`
//   to the Database interface.
export interface SeoKeywordsTable {
  id: Generated<number>;
  keyword: string;
  slug: string;
  // DB-defaulted on insert ('pending'), always set on read.
  status: ColumnType<string, string | undefined, string>;
  priority: number | null;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SeoArticlesTable {
  id: Generated<number>;
  keyword_id: number | null;
  slug: string;
  title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  markdown: string | null;
  /** Body captured the first time a refresh overwrites markdown. */
  pre_refresh_markdown: string | null;
  cms: string | null;
  cms_post_id: string | null;
  public_url: string | null;
  // DB-defaulted on insert ('generated'), always set on read.
  status: ColumnType<string, string | undefined, string>;
  published_at: Date | null;
  last_error: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SeoPlaybooksTable {
  stage: string;
  content: string;
  updated_at: Generated<Date>;
}

export interface SeoArticleAuditsTable {
  slug: string;
  title: string | null;
  dupe_of: string | null;
  word_count: number;
  impressions_28d: number | null;
  clicks_28d: number | null;
  ctr_28d: number | null;
  avg_position_28d: number | null;
  decision: string;
  decision_reason: string;
  gap_trace: ColumnType<
    Record<string, unknown>,
    RawBuilder<unknown>,
    RawBuilder<unknown>
  >;
  audited_at: Date;
  refreshed_at: Date | null;
}
