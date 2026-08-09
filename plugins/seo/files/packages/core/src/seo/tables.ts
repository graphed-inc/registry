import type { ColumnType, Generated } from "kysely";

// Row types for the SEO plugin's tables (migration: src/migrations/0000_seo.ts).
// AGENT.md step: register them in packages/core/src/db/types.ts —
//   import type { SeoArticlesTable, SeoKeywordsTable, SeoPlaybooksTable } from "../seo/tables";
//   ...and add `seo_keywords` / `seo_articles` / `seo_playbooks` to the Database interface.
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
