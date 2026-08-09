import type { ClientConfig, GeneratedArticle } from "./types";
import { loadPlaybooks, type Playbooks } from "./playbooks";
import { buildResearchBrief } from "./research";

// Multi-pass article generation:
//
//   0. research   Serper + Exa fetch SERP context (research.ts) — optional
//   1. outline    keyword + research → title, meta, excerpt, section plan
//   2. draft      outline + research → full markdown article
//   3. edit       draft → tightened, house-rules-enforced final copy
//   4. factcheck  edit output vs research material → unsupported claims
//                 softened or removed, corrections logged
//
// Every stage's user-editable instructions come from the playbook
// (seo_playbooks table, edited in the dashboard). The house rules below are
// NOT in the playbook on purpose — they exist because models reliably
// forget them when they live in editable text (stripDashes still catches
// what slips).

const HOUSE_RULES = `Hard rules (never violated):
- No hyperlinks or URLs anywhere in the article body.
- No em dashes or en dashes anywhere; use commas, periods, or colons.
- No temporal references that age: no "this year", "currently", "recently", "as of".
- No fabricated first-person experience: never "in my experience" or "clients tell me".`;

function stripDashes(value: string): string {
  return value
    .replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2")
    .replace(/\s*[—–]\s*/g, ", ");
}

function truncateMetaDescription(value: string): string {
  if (value.length <= 180) return value;
  const truncated = value.slice(0, 177);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 120 ? lastSpace : 177).trimEnd()}...`;
}

function parseGeneratedJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

function isGeneratedArticle(value: unknown): value is GeneratedArticle {
  if (typeof value !== "object" || value === null) return false;
  const article = value as Record<string, unknown>;
  return (
    typeof article.title === "string" &&
    article.title.length >= 10 &&
    typeof article.meta_description === "string" &&
    article.meta_description.length >= 40 &&
    typeof article.excerpt === "string" &&
    article.excerpt.length >= 40 &&
    article.excerpt.length <= 400 &&
    typeof article.markdown === "string" &&
    article.markdown.length >= 800
  );
}

interface Outline {
  title: string;
  meta_description: string;
  excerpt: string;
  sections: { heading: string; points: string[] }[];
}

function isOutline(value: unknown): value is Outline {
  if (typeof value !== "object" || value === null) return false;
  const outline = value as Record<string, unknown>;
  return (
    typeof outline.title === "string" &&
    typeof outline.meta_description === "string" &&
    typeof outline.excerpt === "string" &&
    Array.isArray(outline.sections) &&
    outline.sections.length >= 3 &&
    outline.sections.every(
      (section: unknown) =>
        typeof section === "object" &&
        section !== null &&
        typeof (section as Record<string, unknown>).heading === "string" &&
        Array.isArray((section as Record<string, unknown>).points),
    )
  );
}

interface LlmOptions {
  apiKey: string;
  model: string;
}

/** One OpenRouter chat completion that must return a JSON object. */
async function chatJson(
  llm: LlmOptions,
  system: string,
  user: string,
): Promise<unknown> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${llm.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: llm.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter call failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content.");
  return parseGeneratedJson(content);
}

function researchBlock(brief: string | null): string {
  return brief
    ? `## SERP research (what currently ranks for this keyword)\n\n${brief}`
    : `## SERP research\n\nNo research material is available for this run. Stay non-specific: no statistics, dates, prices, or named-product capability claims.`;
}

/** Per-stage progress events, surfaced by the dashboard's test console. */
export interface GenerationEvent {
  stage: "research" | "outline" | "draft" | "edit" | "factcheck";
  detail: string;
}

export async function generateArticle(options: {
  keyword: string;
  config: ClientConfig;
  apiKey: string;
  model: string;
  serperApiKey?: string;
  exaApiKey?: string;
  // Playbooks normally come from the DB; the dashboard's test console passes
  // the editor's current (possibly unsaved) contents over the wire instead,
  // so testing never touches what the live cron job will use.
  playbooks?: Playbooks;
  onEvent?: (event: GenerationEvent) => void;
}): Promise<GeneratedArticle> {
  const { keyword, config } = options;
  const llm = { apiKey: options.apiKey, model: options.model };
  const playbooks = options.playbooks ?? (await loadPlaybooks());
  const emit = (event: GenerationEvent): void => {
    console.log(`${event.stage}: ${event.detail}`);
    options.onEvent?.(event);
  };

  // Pass 0: SERP research (skipped silently when no keys are configured).
  const research = await buildResearchBrief(keyword, {
    serperApiKey: options.serperApiKey,
    exaApiKey: options.exaApiKey,
  });
  emit({
    stage: "research",
    detail: research
      ? `${research.sources.length || "SERP"} sources, ${research.text.length} chars`
      : "none — running ungrounded",
  });

  const cta =
    config.content.ctaText && config.content.ctaUrl
      ? `\n- End the article with one short call to action pointing readers at "${config.content.ctaText}". Do not include the URL in the body; it is rendered separately.`
      : "";

  const voice = `You are writing original SEO content for ${config.client.name} (${config.client.siteUrl}).
Voice: ${config.client.brandVoice}
Audience (never deviate from this): ${config.client.audience}

${HOUSE_RULES}

Return only valid JSON.`;

  // Pass 1: outline.
  const outlineRaw = await chatJson(
    llm,
    voice,
    `Plan an original blog article for the keyword "${keyword}".

${researchBlock(research?.text ?? null)}

## Stage instructions
${playbooks.outline}

Return JSON with exactly these keys: title, meta_description, excerpt, sections.
- title includes the keyword naturally; meta_description ≤ 160 characters; excerpt 1-2 sentences (40-400 chars).
- sections: array of { heading, points } — headings are H2s, points are the specific claims the section must make.`,
  );
  if (!isOutline(outlineRaw)) {
    throw new Error("Outline pass returned an invalid outline.");
  }
  const outline = outlineRaw;
  emit({ stage: "outline", detail: `"${outline.title}" (${outline.sections.length} sections)` });

  // Pass 2: draft.
  const draftRaw = await chatJson(
    llm,
    voice,
    `Write the full article from this outline, for the keyword "${keyword}".

## Outline
${JSON.stringify(outline, null, 2)}

${researchBlock(research?.text ?? null)}

## Stage instructions
${playbooks.draft}

- Target roughly ${config.content.defaultWordCount} words.${cta}

Return JSON with exactly one key: markdown (the publication-ready article, H2 headings matching the outline).`,
  );
  const draft = (draftRaw as { markdown?: unknown }).markdown;
  if (typeof draft !== "string" || draft.length < 800) {
    throw new Error("Draft pass returned an invalid article body.");
  }
  emit({ stage: "draft", detail: `${draft.length} chars` });

  // Pass 3: edit.
  const editedRaw = await chatJson(
    llm,
    voice,
    `Edit this draft. Keep the structure, keep every claim that matters, cut everything that doesn't earn its place.

## Draft
${draft}

## Current metadata
${JSON.stringify({ title: outline.title, meta_description: outline.meta_description, excerpt: outline.excerpt })}

## Stage instructions
${playbooks.edit}

Return JSON with exactly these keys: title, meta_description, excerpt, markdown (the edited article).`,
  );
  if (!isGeneratedArticle(editedRaw)) {
    throw new Error("Edit pass failed validation (title/meta/excerpt/markdown lengths).");
  }
  emit({ stage: "edit", detail: `${editedRaw.markdown.length} chars` });

  // Pass 4: fact-check against the research material.
  const checkedRaw = await chatJson(
    llm,
    voice,
    `Fact-check this article against the research material. Fix or remove unsupported claims per the stage instructions; change nothing else.

## Article
${editedRaw.markdown}

${researchBlock(research?.text ?? null)}

## Stage instructions
${playbooks.factcheck}

Return JSON with exactly these keys: markdown (the corrected article), corrections (array of strings, one per change made — empty if none).`,
  );
  const checked = checkedRaw as { markdown?: unknown; corrections?: unknown };
  if (typeof checked.markdown !== "string" || checked.markdown.length < 800) {
    throw new Error("Fact-check pass returned an invalid article body.");
  }
  const corrections = Array.isArray(checked.corrections)
    ? checked.corrections.filter((c): c is string => typeof c === "string")
    : [];
  emit({
    stage: "factcheck",
    detail:
      corrections.length > 0
        ? `${corrections.length} correction(s): ${corrections.join(" · ")}`
        : "clean",
  });

  return {
    title: stripDashes(editedRaw.title),
    excerpt: stripDashes(editedRaw.excerpt),
    markdown: stripDashes(checked.markdown),
    meta_description: truncateMetaDescription(
      stripDashes(editedRaw.meta_description),
    ),
  };
}
