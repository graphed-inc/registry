import {
  isForumUrl,
  parseGapAnalysisJson,
  type RankingGapAnalysis,
} from "./refresh";
import { chatCompletion } from "./tools";

const ARTICLE_MAX_CHARS = 12_000;
const PAGE_EXCERPT_CHARS = 2_500;
const MAX_GAPS = 10;
const MAX_INSIGHTS = 8;

export interface GapPage {
  rank: number;
  title: string;
  url: string;
  snippet?: string | null;
  text?: string | null;
}

export function buildGapAnalysisPrompt(input: {
  keyword: string;
  title: string;
  markdown: string;
  pages: GapPage[];
}): string {
  const ranking: string[] = [];
  const forums: string[] = [];
  for (const page of input.pages) {
    const excerpt = (page.text || page.snippet || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PAGE_EXCERPT_CHARS);
    const block = [
      `Rank ${page.rank}: ${page.title}`,
      `URL: ${page.url}`,
      excerpt ? `Content:\n${excerpt}` : "Content: (title/snippet only; page body unavailable)",
    ].join("\n");
    if (isForumUrl(page.url)) forums.push(block);
    else ranking.push(block);
  }

  return `Keyword: "${input.keyword}"
Our article title (frozen; do not suggest retitling): ${input.title}

Compare our article to the pages that currently rank for this keyword.

A gap is content they cover that we do not: products, vendors, topics, comparisons, workflows, FAQs, proof. Same-angle wording that we already cover is not a gap.

Forum and social threads are not pages to clone. Use them as insight: what readers ask, confuse, or care about, and how we should position.

Return JSON only:
{"gaps":["..."],"forumInsights":["..."]}
- gaps: 0-${MAX_GAPS} short strings
- forumInsights: 0-${MAX_INSIGHTS} short strings (empty if no forums)
No markdown, no commentary.

Our article:

${input.markdown.slice(0, ARTICLE_MAX_CHARS)}

Ranking pages (articles, vendors, tools):

${ranking.length ? ranking.join("\n\n---\n\n") : "(none)"}

Forum and social threads (positioning insight only):

${forums.length ? forums.join("\n\n---\n\n") : "(none)"}`;
}

export async function analyzeRankingGaps(input: {
  keyword: string;
  title: string;
  markdown: string;
  pages: GapPage[];
  model: string;
}): Promise<RankingGapAnalysis> {
  const raw = await chatCompletion({
    model: input.model,
    temperature: 0.2,
    json: true,
    system:
      "You compare ranking-page content to an existing SEO article and return JSON only. Gaps are coverage differences. Forums are buyer-language insight, not competitor outlines to copy.",
    user: buildGapAnalysisPrompt(input),
  });
  const parsed = parseGapAnalysisJson(raw);
  return { ...parsed, source: "model" };
}
