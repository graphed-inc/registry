import { getDb } from "../db/index";
import { loadClientConfig } from "./config";
import { resolveAdapter } from "./pipeline";

// Queue management operations, used by the dashboard's server actions
// (packages/dashboard/app/seo/actions.ts). The cron job never calls these —
// it only consumes the queue via runSeoPipeline().

export interface ImportSummary {
  imported: number;
  skipped: number;
}

export function slugifyKeyword(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Imports keywords from CSV text — one `keyword[, slug[, priority]]` per
 * line, optional `keyword,slug,priority` header. Rows whose slug already
 * exists are skipped (import is idempotent; re-running the same CSV is a
 * no-op).
 */
export async function importKeywordsCsv(csv: string): Promise<ImportSummary> {
  const db = getDb();
  let imported = 0;
  let skipped = 0;

  const lines = csv
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0] && /^keyword\s*,/i.test(lines[0])) lines.shift();

  for (const line of lines) {
    const [keywordRaw, slugRaw, priorityRaw] = line
      .split(",")
      .map((part) => part.trim());
    const slug = slugifyKeyword(slugRaw || keywordRaw || "");
    if (!keywordRaw || !slug) {
      skipped += 1;
      continue;
    }
    const parsed = priorityRaw ? Number.parseInt(priorityRaw, 10) : NaN;
    const result = await db
      .insertInto("seo_keywords")
      .values({
        keyword: keywordRaw,
        slug,
        priority: Number.isFinite(parsed) ? parsed : null,
      })
      .onConflict((oc) => oc.column("slug").doNothing())
      .executeTakeFirst();
    if (Number(result.numInsertedOrUpdatedRows ?? 0) > 0) {
      imported += 1;
    } else {
      skipped += 1;
    }
  }

  return { imported, skipped };
}

/**
 * Removes a keyword and its generated articles from the queue. Deliberately
 * local-only: if an article was already published, the CMS post stays live —
 * unpublish first (unpublishArticle) when that's what the user wants.
 */
export async function deleteKeyword(keywordId: number): Promise<void> {
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("seo_articles")
      .where("keyword_id", "=", keywordId)
      .execute();
    await trx
      .deleteFrom("seo_keywords")
      .where("id", "=", keywordId)
      .execute();
  });
}

/**
 * Reverts a published article to a draft. Calls the CMS adapter's unpublish
 * when one exists (Ghost/WordPress/Strapi all support draft reversion),
 * then resets local state so the pipeline can republish it later.
 */
export async function unpublishArticle(
  articleId: number,
): Promise<{ note: string }> {
  const db = getDb();
  const article = await db
    .selectFrom("seo_articles")
    .selectAll()
    .where("id", "=", articleId)
    .executeTakeFirst();
  if (!article) throw new Error(`Article ${articleId} not found.`);
  if (article.status !== "published") {
    return { note: "Article is not published — nothing to unpublish." };
  }

  let note = "Reverted to draft locally.";
  const adapter = resolveAdapter(loadClientConfig());
  if (adapter && article.cms_post_id) {
    if (adapter.unpublish) {
      await adapter.unpublish(article.cms_post_id);
      note = `Reverted to draft in ${adapter.name}.`;
    } else {
      note = `The ${adapter.name} adapter cannot unpublish — reverted locally only; the post is still live.`;
    }
  }

  await db
    .updateTable("seo_articles")
    .set({
      status: "generated",
      public_url: null,
      published_at: null,
      updated_at: new Date(),
    })
    .where("id", "=", articleId)
    .execute();

  if (article.keyword_id) {
    await db
      .updateTable("seo_keywords")
      .set({ status: "generated", updated_at: new Date() })
      .where("id", "=", article.keyword_id)
      .execute();
  }

  return { note };
}
