import { sql, type RawBuilder } from "kysely";
import { getDb } from "../db/index";
import { loadClientConfig, loadSeoRefreshSettings } from "./config";
import { markdownToHtml } from "./markdown";
import { resolveAdapter } from "./pipeline";
import { fetchExaPageText, searchSerperHits } from "./research";
import {
  analyzeRankingGaps,
  type GapPage,
} from "./refresh-gap";
import { fetchPageMetrics28d, fetchQueriesForPage } from "./refresh-gsc";
import { draftRefreshRewrite } from "./refresh-rewrite";
import {
  articleHasCta,
  decideArticleRefresh,
  emptyGsc,
  findMissingSubtopics,
  headingsFromPageText,
  isPendingRefreshWrite,
  orderRefreshBatch,
  refreshSkipReason,
  wordCountFromMarkdown,
  type CorpusArticle,
  type GscMetrics,
  type RefreshDecision,
  type RefreshDecisionKind,
  type RefreshSkipReason,
} from "./refresh";
import { toolsConfigured } from "./tools";
import type { UpdateContentInput } from "./types";

const MISSING_TOOLS =
  "Graphed Tools is not configured. Run through `graphed dev run -- <command>` locally, or deploy, so GRAPHED_TOKEN and GRAPHED_TOOLS_URL are injected.";

export interface RefreshRunOptions {
  /** Write accepted rewrites. Also enabled by SEO_REFRESH_APPLY=true. */
  apply?: boolean;
  /** One slug, bypassing age and cooldown gates. */
  slug?: string;
}

export interface RefreshRunResult {
  apply: boolean;
  corpus: number;
  eligible: number;
  batch: number;
  decisions: Record<RefreshDecisionKind, number>;
  skipReasons: Record<RefreshSkipReason, number>;
  /** CMS updateContent calls in this batch. */
  cmsWrites: number;
  /** CMS updateContent calls that threw. Recorded as leave. */
  cmsFailures: number;
}

interface PublishedRow {
  id: number;
  slug: string;
  title: string | null;
  markdown: string | null;
  keyword: string | null;
  published_at: Date | null;
  pre_refresh_markdown: string | null;
  public_url: string | null;
  cms_post_id: string | null;
}

function asJsonb(value: unknown): RawBuilder<unknown> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function canonicalUrl(
  slug: string,
  corpus: CorpusArticle[],
  siteUrl: string,
): string | null {
  const other = corpus.find((row) => row.slug === slug);
  if (other?.public_url) return other.public_url;
  const base = siteUrl.replace(/\/$/, "");
  return base ? `${base}/${slug}` : null;
}

export async function runSeoRefresh(
  options: RefreshRunOptions = {},
): Promise<RefreshRunResult> {
  if (!toolsConfigured()) throw new Error(MISSING_TOOLS);

  const settings = loadSeoRefreshSettings();
  const apply = settings.apply || options.apply === true;
  const onlySlug = options.slug?.trim() || undefined;
  const client = loadClientConfig();
  const db = getDb();
  const now = new Date();
  const ctaUrl = client.content.ctaUrl?.trim() || undefined;

  const schema = client.metrics?.searchConsoleSchema?.trim() || "";
  let gscByUrl = new Map<string, GscMetrics>();

  const posts = await db
    .selectFrom("seo_articles as a")
    .leftJoin("seo_keywords as k", "k.id", "a.keyword_id")
    .select([
      "a.id",
      "a.slug",
      "a.title",
      "a.markdown",
      "k.keyword",
      "a.published_at",
      "a.pre_refresh_markdown",
      "a.public_url",
      "a.cms_post_id",
    ])
    .where("a.status", "=", "published")
    .execute();

  if (schema) {
    const urls = posts
      .map((post) => post.public_url)
      .filter((url): url is string => Boolean(url));
    try {
      gscByUrl = await fetchPageMetrics28d(schema, urls);
      console.log(`[seo-refresh] GSC page rows matched: ${gscByUrl.size}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Search Console warehouse query failed; refresh wrote nothing: ${message}`,
      );
    }
  } else {
    console.log(
      "[seo-refresh] metrics.searchConsoleSchema is unset; continuing without Search Console.",
    );
  }

  const corpus: CorpusArticle[] = posts.map((post) => ({
    slug: post.slug,
    title: post.title ?? post.slug,
    impressions_28d: post.public_url
      ? gscByUrl.get(post.public_url)?.impressions_28d ?? null
      : null,
    public_url: post.public_url,
  }));

  const audits = await db
    .selectFrom("seo_article_audits")
    .select(["slug", "refreshed_at", "audited_at", "decision"])
    .execute();
  const auditBySlug = new Map(audits.map((row) => [row.slug, row]));

  const skipReasons: Record<RefreshSkipReason, number> = {
    "no-published-at": 0,
    "recently-refreshed": 0,
    "recently-audited": 0,
    "missing-html": 0,
  };

  type Eligible = PublishedRow & {
    wordCount: number;
    needsCta: boolean;
    pendingApply: boolean;
  };
  const eligible: Eligible[] = [];
  for (const post of posts) {
    const markdown = post.markdown ?? "";
    const wordCount = wordCountFromMarkdown(markdown);
    const needsCta = !articleHasCta(markdown, ctaUrl);
    const existing = auditBySlug.get(post.slug);
    const reason = refreshSkipReason({
      publishedAt: post.published_at,
      refreshedAt: existing?.refreshed_at ?? null,
      auditedAt: existing?.audited_at ?? null,
      wordCount,
      now,
      minAgeDays: settings.minAgeDays,
      lastDecision: existing?.decision ?? null,
      apply,
    });
    if (reason && post.slug !== onlySlug) {
      skipReasons[reason] += 1;
      continue;
    }
    eligible.push({
      ...post,
      wordCount,
      needsCta,
      pendingApply: isPendingRefreshWrite(
        existing
          ? {
              auditedAt: existing.audited_at,
              refreshedAt: existing.refreshed_at,
              decision: existing.decision,
            }
          : null,
      ),
    });
  }

  let batch: Eligible[];
  if (onlySlug) {
    batch = eligible.filter((post) => post.slug === onlySlug);
    if (!batch.length) {
      throw new Error(
        `--slug=${onlySlug} is not among published articles`,
      );
    }
    console.log(`[seo-refresh] --slug=${onlySlug}: age and cooldown gates bypassed`);
  } else {
    batch = orderRefreshBatch(
      eligible.map((post) => ({
        ...post,
        impressions: post.public_url
          ? gscByUrl.get(post.public_url)?.impressions_28d ?? -1
          : -1,
      })),
      settings.batchSize,
    );
  }

  console.log(
    `[seo-refresh] corpus=${posts.length} eligible=${eligible.length} batch=${batch.length} apply=${apply}`,
  );
  console.log(`[seo-refresh] skip_reasons ${JSON.stringify(skipReasons)}`);

  const counts: Record<RefreshDecisionKind, number> = {
    refresh: 0,
    expand: 0,
    dedupe: 0,
    leave: 0,
  };
  let cmsWrites = 0;
  let cmsFailures = 0;
  const adapter = apply ? resolveAdapter(client) : null;

  for (const post of batch) {
    const title = post.title ?? post.slug;
    const markdown = post.markdown ?? "";
    const keyword = post.keyword ?? title;
    const gsc = (post.public_url ? gscByUrl.get(post.public_url) : undefined) ?? emptyGsc();

    const serper = await searchSerperHits(keyword)
      .then((hits) => ({ hits, error: null as string | null }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[seo-refresh] ${post.slug}: serper error (no rewrite): ${message}`);
        return {
          hits: [] as { url: string; title: string; snippet: string | null }[],
          error: message,
        };
      });

    let pages: GapPage[] = serper.hits.map((hit, index) => ({
      rank: index + 1,
      title: hit.title,
      url: hit.url,
      snippet: hit.snippet,
      text: "",
    }));
    if (!serper.error && serper.hits.length) {
      try {
        const extracted = await fetchExaPageText(serper.hits.map((hit) => hit.url));
        const byUrl = new Map(extracted.map((row) => [row.url, row]));
        pages = serper.hits.map((hit, index) => {
          const page = byUrl.get(hit.url);
          return {
            rank: index + 1,
            title: page?.title || hit.title,
            url: hit.url,
            snippet: hit.snippet,
            text: page?.text ?? "",
          };
        });
      } catch (error) {
        console.error(
          `[seo-refresh] ${post.slug}: ranking-page text failed (non-fatal): ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    const hits = pages.map((page) => ({
      url: page.url,
      title: page.title,
      snippet: page.snippet,
      headings: headingsFromPageText(page.text ?? ""),
    }));

    let gapAnalysis: Awaited<ReturnType<typeof analyzeRankingGaps>> | undefined;
    if (!serper.error && pages.length) {
      try {
        gapAnalysis = await analyzeRankingGaps({
          keyword,
          title,
          markdown,
          pages,
          model: settings.gapModel,
        });
      } catch (error) {
        console.error(
          `[seo-refresh] ${post.slug}: gap analysis failed, using heuristic: ${error instanceof Error ? error.message : error}`,
        );
        gapAnalysis = {
          gaps: findMissingSubtopics(markdown, hits, keyword, client.client.siteUrl),
          forumInsights: [],
          source: "heuristic",
        };
      }
    }

    let gscQueries: Awaited<ReturnType<typeof fetchQueriesForPage>> = [];
    if (schema && post.public_url) {
      gscQueries = await fetchQueriesForPage(schema, post.public_url).catch((error: unknown) => {
        console.error(
          `[seo-refresh] ${post.slug}: gsc queries failed (non-fatal): ${error instanceof Error ? error.message : error}`,
        );
        return [];
      });
    }

    let decision = decideArticleRefresh(
      {
        slug: post.slug,
        title,
        publicUrl: post.public_url,
        word_count: post.wordCount,
        keyword,
        siteUrl: client.client.siteUrl,
        gsc,
        gsc_queries: gscQueries,
        serper: { hits, error: serper.error },
        corpus,
        bodyText: markdown,
        gapAnalysis,
      },
      { thinWordThreshold: settings.thinWordThreshold },
    );

    let planned: string | null = null;
    const rewriteKind = decision.decision;
    const shouldRewrite =
      rewriteKind === "expand" ||
      rewriteKind === "refresh" ||
      rewriteKind === "dedupe";
    // Draft only when the result will be written. A slug-only dry run audits
    // the decision and does not pay for a rewrite that would be discarded.
    if (shouldRewrite && apply) {
      const gaps =
        decision.gap_trace.serper.status === "ok"
          ? decision.gap_trace.serper.missing_subtopics ?? []
          : [];
      const forumInsights =
        decision.gap_trace.serper.status === "ok"
          ? decision.gap_trace.serper.forum_insights ?? []
          : [];
      const canonical =
        decision.dupe_of != null
          ? canonicalUrl(decision.dupe_of, corpus, client.client.siteUrl)
          : null;
      try {
        const rewrite = await draftRefreshRewrite({
          keyword,
          title,
          slug: post.slug,
          decision: rewriteKind,
          missingSubtopics: gaps,
          forumInsights,
          rankingPages: pages.map((page) => ({
            url: page.url,
            title: page.title,
            snippet: page.snippet,
            text: page.text,
          })),
          gscQueries,
          markdown,
          brandVoice: client.client.brandVoice,
          audience: client.client.audience,
          ctaText: client.content.ctaText,
          ctaUrl,
          canonicalUrl: canonical,
          model: settings.rewriteModel,
          thinWordThreshold: settings.thinWordThreshold,
        });
        if ("rejection" in rewrite) {
          decision = {
            ...decision,
            decision: "leave",
            decision_reason: `Rewrite rejected (no write): ${rewrite.rejection}`,
          };
        } else {
          planned = rewrite.markdown;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        decision = {
          ...decision,
          decision: "leave",
          decision_reason: `Rewrite failed (no write): ${message}`,
        };
      }
    }

    let applied = false;
    if (apply && planned) {
      const allowUrls = [
        ctaUrl,
        decision.dupe_of
          ? canonicalUrl(decision.dupe_of, corpus, client.client.siteUrl)
          : null,
      ].filter((url): url is string => Boolean(url));
      let cmsOk = adapter === null;
      if (adapter) {
        cmsWrites += 1;
        try {
          const found = post.cms_post_id
            ? post.cms_post_id
            : (await adapter.findBySlug(post.slug))?.id;
          if (!found) {
            throw new Error("No CMS post id for this article.");
          }
          const update: UpdateContentInput = {
            id: found,
            markdown: planned,
            html: markdownToHtml(planned, { allowUrls }),
            allowUrls,
          };
          await adapter.updateContent(update);
          cmsOk = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          cmsFailures += 1;
          console.error(
            `[seo-refresh] ${post.slug}: CMS update failed, local markdown unchanged: ${message}`,
          );
          // Same convention as a rejected rewrite: record finished work so the
          // audit cooldown applies. Leaving a non-leave decision unwritten
          // would keep the post at the front of every nightly batch.
          decision = {
            ...decision,
            decision: "leave",
            decision_reason: `CMS update failed (no write): ${message}`,
          };
        }
      }
      if (cmsOk) {
        await db
          .updateTable("seo_articles")
          .set({
            pre_refresh_markdown: post.pre_refresh_markdown ?? markdown,
            markdown: planned,
            updated_at: now,
          })
          .where("id", "=", post.id)
          .execute();
        applied = true;
        console.log(`[seo-refresh] ${post.slug}: wrote updated article`);
      }
    }

    counts[decision.decision] += 1;
    await upsertAudit(post.slug, title, post.wordCount, gsc, decision, now, applied);
    console.log(`[seo-refresh] ${post.slug}: ${decision.decision} — ${decision.decision_reason}`);
  }

  console.log(`[seo-refresh] done apply=${apply} decisions=${JSON.stringify(counts)}`);
  if (cmsFailures > 0) {
    console.error(
      `[seo-refresh] ${cmsFailures} of ${cmsWrites} CMS updates failed; those posts wait out the audit cooldown.`,
    );
  }
  return {
    apply,
    corpus: posts.length,
    eligible: onlySlug ? batch.length : eligible.length,
    batch: batch.length,
    decisions: counts,
    skipReasons,
    cmsWrites,
    cmsFailures,
  };
}

async function upsertAudit(
  slug: string,
  title: string,
  wordCount: number,
  gsc: GscMetrics,
  decision: RefreshDecision,
  now: Date,
  applied: boolean,
): Promise<void> {
  const db = getDb();
  const gap = asJsonb(decision.gap_trace);
  const row = {
    slug,
    title,
    dupe_of: decision.dupe_of,
    word_count: wordCount,
    impressions_28d: gsc.impressions_28d,
    clicks_28d: gsc.clicks_28d,
    ctr_28d: gsc.ctr_28d,
    avg_position_28d: gsc.avg_position_28d,
    decision: decision.decision,
    decision_reason: decision.decision_reason,
    gap_trace: gap,
    audited_at: now,
    refreshed_at: applied ? now : null,
  };
  await db
    .insertInto("seo_article_audits")
    .values(row)
    .onConflict((oc) =>
      oc.column("slug").doUpdateSet({
        title: row.title,
        dupe_of: row.dupe_of,
        word_count: row.word_count,
        impressions_28d: row.impressions_28d,
        clicks_28d: row.clicks_28d,
        ctr_28d: row.ctr_28d,
        avg_position_28d: row.avg_position_28d,
        decision: row.decision,
        decision_reason: row.decision_reason,
        gap_trace: gap,
        audited_at: now,
        ...(applied ? { refreshed_at: now } : {}),
      }),
    )
    .execute();
}
