import { getDb } from "../db/index";
import { createGhostAdapter } from "./cms/ghost";
import { createStrapiAdapter } from "./cms/strapi";
import { createWordPressAdapter } from "./cms/wordpress";
import {
  ghostCredentials,
  loadSeoConfig,
  strapiCredentials,
  wordpressCredentials,
} from "./config";
import { generateArticle } from "./generate";
import { markdownToHtml } from "./markdown";
import type { ClientConfig, CmsAdapter } from "./types";

export interface PipelineResult {
  keyword: string;
  slug: string;
  status: "generated" | "published" | "noop";
  publicUrl: string | null;
}

// Takes the client config (not the full SeoConfig) so callers that never
// generate text — like unpublish from the dashboard — don't need
// OPENROUTER_API_KEY set.
export function resolveAdapter(client: ClientConfig): CmsAdapter | null {
  if (client.cms.type === "ghost") {
    return createGhostAdapter(ghostCredentials());
  }
  if (client.cms.type === "wordpress") {
    return createWordPressAdapter(wordpressCredentials());
  }
  if (client.cms.type === "strapi") {
    return createStrapiAdapter({ ...strapiCredentials(), client });
  }
  return null; // "none": generate drafts, publishing handled elsewhere
}

// One run: take the next queued keyword (or a specific one, when triggered
// manually from the dashboard), draft an article, and publish it through
// the CMS adapter. With cms.type "none" the draft is stored locally and
// publishing is left to whoever syncs it out. Failed keywords are
// claimable again: a run is a retry.
export async function runSeoPipeline(
  options: { keywordId?: number } = {},
): Promise<PipelineResult> {
  const config = loadSeoConfig();
  const db = getDb();

  const claimable = db
    .selectFrom("seo_keywords")
    .select(["id", "keyword", "slug"])
    .where("status", "in", ["pending", "failed"]);

  const keyword = options.keywordId
    ? await claimable.where("id", "=", options.keywordId).executeTakeFirst()
    : await claimable
        .orderBy("priority", "asc")
        .orderBy("created_at", "asc")
        .limit(1)
        .executeTakeFirst();

  if (!keyword) {
    if (options.keywordId) {
      throw new Error(
        `Keyword ${options.keywordId} is not pending or failed — nothing to run.`,
      );
    }
    console.log("No pending keywords — nothing to do.");
    return { keyword: "", slug: "", status: "noop", publicUrl: null };
  }

  console.log(`Drafting article for "${keyword.keyword}"...`);
  await db
    .updateTable("seo_keywords")
    .set({ status: "generating", updated_at: new Date() })
    .where("id", "=", keyword.id)
    .execute();

  try {
    const article = await generateArticle({
      keyword: keyword.keyword,
      config: config.client,
      apiKey: config.openRouterApiKey,
      model: config.openRouterModel,
      serperApiKey: config.serperApiKey,
      exaApiKey: config.exaApiKey,
    });

    await db
      .insertInto("seo_articles")
      .values({
        keyword_id: keyword.id,
        slug: keyword.slug,
        title: article.title,
        meta_description: article.meta_description,
        excerpt: article.excerpt,
        markdown: article.markdown,
        status: "generated",
      })
      .onConflict((oc) =>
        oc.column("slug").doUpdateSet({
          title: article.title,
          meta_description: article.meta_description,
          excerpt: article.excerpt,
          markdown: article.markdown,
          status: "generated",
          updated_at: new Date(),
        }),
      )
      .execute();

    const adapter = resolveAdapter(config.client);
    if (!adapter) {
      await markKeyword(keyword.id, "generated");
      console.log(
        'cms.type is "none" — draft stored. Pick a CMS in the client config to publish.',
      );
      return { keyword: keyword.keyword, slug: keyword.slug, status: "generated", publicUrl: null };
    }

    const existing = await adapter.findBySlug(keyword.slug);
    const result =
      existing ??
      (await adapter.publish({
        slug: keyword.slug,
        article,
        html: markdownToHtml(article.markdown),
      }));

    await db
      .updateTable("seo_articles")
      .set({
        cms: adapter.name,
        cms_post_id: result.id,
        public_url: result.url,
        status: "published",
        published_at: new Date(),
        updated_at: new Date(),
      })
      .where("slug", "=", keyword.slug)
      .execute();
    await markKeyword(keyword.id, "published");

    console.log(
      `Published "${article.title}" via ${adapter.name}: ${result.url ?? "(draft)"}`,
    );
    return {
      keyword: keyword.keyword,
      slug: keyword.slug,
      status: "published",
      publicUrl: result.url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markKeyword(keyword.id, "failed", message);
    throw error;
  }
}

async function markKeyword(
  id: number,
  status: string,
  lastError?: string,
): Promise<void> {
  await getDb()
    .updateTable("seo_keywords")
    .set({
      status,
      last_error: lastError ?? null,
      updated_at: new Date(),
    })
    .where("id", "=", id)
    .execute();
}
