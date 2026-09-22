import { chatCompletion } from "./tools";
import {
  isForumUrl,
  refreshRejectionReason,
  stripRewriteFences,
  wordCountFromMarkdown,
  type RefreshDecisionKind,
} from "./refresh";

const PROMPT_BODY_MAX_CHARS = 30_000;
const RANKING_EXCERPT_CHARS = 2_000;

export interface RankingPageForRewrite {
  url: string;
  title: string;
  snippet?: string | null;
  text?: string | null;
}

function rankingBlock(pages: RankingPageForRewrite[]): {
  articles: string;
  forums: string;
} {
  const articles: string[] = [];
  const forums: string[] = [];
  for (const [index, page] of pages.slice(0, 10).entries()) {
    const excerpt = (page.text || page.snippet || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, RANKING_EXCERPT_CHARS);
    const block = `${index + 1}. ${page.title} — ${page.url}${excerpt ? `\n${excerpt}` : ""}`;
    if (isForumUrl(page.url)) forums.push(block);
    else articles.push(block);
  }
  return {
    articles: articles.length ? articles.join("\n\n") : "(none)",
    forums: forums.length ? forums.join("\n\n") : "(none)",
  };
}

export function buildRefreshRewritePrompt(input: {
  keyword: string;
  title: string;
  slug: string;
  decision: Exclude<RefreshDecisionKind, "leave">;
  missingSubtopics: string[];
  forumInsights?: string[];
  rankingPages?: RankingPageForRewrite[];
  gscQueries?: Array<{
    query: string;
    impressions_28d: number;
    clicks_28d: number;
    avg_position_28d: number;
  }>;
  markdown: string;
  brandVoice: string;
  audience: string;
  ctaText?: string | null;
  ctaUrl?: string | null;
  canonicalUrl?: string | null;
}): string {
  const originalWords = wordCountFromMarkdown(input.markdown);
  const gaps = input.missingSubtopics.length
    ? input.missingSubtopics.map((gap, index) => `${index + 1}. ${gap}`).join("\n")
    : "(no named coverage gaps)";
  const insights = input.forumInsights?.length
    ? input.forumInsights.map((row, index) => `${index + 1}. ${row}`).join("\n")
    : "(none)";
  const ranking = rankingBlock(input.rankingPages ?? []);
  const workingQueries = input.gscQueries?.length
    ? input.gscQueries
        .slice(0, 10)
        .map(
          (row) =>
            `- "${row.query}" (${row.impressions_28d} impressions, ${row.clicks_28d} clicks, avg position ${row.avg_position_28d.toFixed(1)})`,
        )
        .join("\n")
    : "(none)";
  const ctaUrl = input.ctaUrl?.trim() ?? "";
  const ctaText = input.ctaText?.trim() || "Learn more";
  const ctaRule = ctaUrl
    ? `Include this markdown link at least once, and no other URLs except a canonical pointer when the goal names one: [${ctaText}](${ctaUrl})`
    : "Do not include any URLs or hyperlinks.";

  const goal =
    input.decision === "expand"
      ? `The current article is thin (${originalWords} words). Expand it past ${Math.max(800, originalWords)} words while keeping the original angle. Cover every named gap as its own heading.`
      : input.decision === "refresh"
        ? "Keep the original angle and title. Close the coverage gaps using the ranking-page content below. Answer the questions in the forum insight. Do not pad. Do not copy competitor copy."
        : `This article is a weaker duplicate. Keep the title and slug. Add one short paragraph near the top that points readers to ${input.canonicalUrl ?? "the canonical article"} as the fuller guide. Do not unpublish. Do not retitle. Keep the rest of the article.`;

  return `Revise the existing blog article for the keyword "${input.keyword}".

Current title (keep it; do not retitle, do not add an H1): ${input.title}
Slug (do not change): ${input.slug}

Brand voice: ${input.brandVoice}
Audience: ${input.audience}

Goal: ${goal}

Coverage gaps (ranking content we do not cover):
${gaps}

Forum and social insight (how readers talk about this keyword; use for positioning, not as an outline to copy):
${insights}

Ranking pages for this keyword (align coverage, do not copy):
${ranking.articles}

Forum and social threads that rank:
${ranking.forums}

Queries already bringing impressions to this page (Google Search Console, last 28 days). Keep the article aligned with these; do not pivot away from what already works:
${workingQueries}

Hard rules:
- ${ctaRule}
- No em dashes or en dashes; use commas, periods, or colons.
- No temporal references that age: no "this year", "currently", "recently", "as of".
- No fabricated first-person experience.
- Use ## and ### for section headings. Never use # (the CMS already renders the title).
- Return only the full revised article in Markdown. No commentary. Do not wrap it in code fences.

Current article:

${input.markdown.slice(0, PROMPT_BODY_MAX_CHARS)}`;
}

export async function draftRefreshRewrite(input: {
  keyword: string;
  title: string;
  slug: string;
  decision: Exclude<RefreshDecisionKind, "leave">;
  missingSubtopics: string[];
  forumInsights?: string[];
  rankingPages?: RankingPageForRewrite[];
  gscQueries?: Array<{
    query: string;
    impressions_28d: number;
    clicks_28d: number;
    avg_position_28d: number;
  }>;
  markdown: string;
  brandVoice: string;
  audience: string;
  ctaText?: string | null;
  ctaUrl?: string | null;
  canonicalUrl?: string | null;
  model: string;
  thinWordThreshold: number;
}): Promise<{ markdown: string } | { rejection: string }> {
  const raw = await chatCompletion({
    model: input.model,
    temperature: 0.3,
    system:
      "You revise an existing SEO article in Markdown. You keep the title and slug, and you return only the article.",
    user: buildRefreshRewritePrompt(input),
  });
  const markdown = stripRewriteFences(raw);
  const rejection = refreshRejectionReason({
    original: input.markdown,
    refreshed: markdown,
    ctaUrl: input.ctaUrl,
    canonicalUrl: input.canonicalUrl,
    decision: input.decision,
    thinWordThreshold: input.thinWordThreshold,
  });
  if (rejection) return { rejection };
  return { markdown };
}
