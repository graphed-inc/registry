# seo

An SEO content agent for Graphed projects: a keyword queue in Postgres, an
LLM drafting pipeline, direct CMS publishing, and a dashboard
page to watch it all.

## What it does

Every day, the `seo-publish-daily` cron job takes the next `pending`
keyword from `seo_keywords`, generates an article, stores it in
`seo_articles`, and publishes it through the configured CMS adapter.
A second cron, `seo-refresh`, audits articles that are already published
and can rewrite them. See [Refreshing published articles](#refreshing-published-articles).

Generation is a multi-pass pipeline, and every pass's instructions are a
user-editable playbook (markdown, edited from the dashboard's Playbook &
Test tab). Nothing is seeded: defaults live in code (`seo/playbooks.ts`) and
`seo_playbooks` rows are overrides only — "Reset to default" just deletes
the row, so upstream default improvements reach projects that never
customized. The test console on the same tab runs the full pipeline on the
editor's current (even unsaved) contents, so iterating on instructions
never touches the live cron job's playbooks:

0. **Research** — Graphed Tools runs Serper (`serper:search`: top results,
   people-also-ask, related searches) and Exa (`exa:search`: ranking-page
   content extracts). Both are metered on the Graphed account. A source that
   fails is skipped; if both fail, the draft runs ungrounded and the prompts
   tell the model to stay non-specific.
1. **Outline** — title, meta, excerpt, and a 5-8 section plan from the
   keyword + research.
2. **Draft** — the full article from the outline.
3. **Edit** — tighten, cut filler, enforce house style.
4. **Fact-check** — every statistic/date/price/named-product claim must be
   traceable to the research material; anything else is softened or
   removed, with each change logged as a correction.

House rules (no links in body, no em/en dashes, no aging temporal
references, no fabricated first-person) live in code, not the playbook —
models forget rules that sit in editable text.

The dashboard gains an `/seo` console: a metrics strip first — published →
indexed → impressions → clicks for the plugin's own posts, from Google
Search Console in the account warehouse — then the keyword queue with
per-article status (pending → generated → published | failed), CSV import,
a manual run-now trigger per keyword, a slide-over article reader (rendered
+ raw markdown), unpublish (reverts to draft in Ghost/WordPress/Strapi),
and queue removal. All mutations are Next.js server actions calling into
`packages/core/src/seo/manage.ts` — the same functions a job or API route
would use.

Pipeline code lands in `packages/core/src/seo/`, so jobs and dashboard share
it; table types register once in `packages/core/src/db/types.ts`.

## CMS adapters

| CMS | Auth | Publishes as |
|-----|------|--------------|
| Ghost | Admin API key (`id:secret`, hand-rolled HS256 JWT) | Live post |
| WordPress | Application password (Basic auth) | Draft for human review |
| Strapi | Full-access API token (Bearer) | Live entry (v5 draft/publish aware) |
| `none` | — | Drafts only; no CMS calls |

**Strapi needs one extra decision.** Strapi instances define their own
content types — there is no universal "post" shape — so the adapter is
driven by config instead of assumptions: `cms.collection` (the plural API
id), `cms.fields` (which attributes hold the title/slug/excerpt/body/meta
description), and `cms.bodyFormat` (`blocks` for Strapi v5 rich text,
`markdown`, or `html`). The integrating agent inspects the instance's schema
and fills these in; AGENT.md walks through it.

Duplicate protection: before publishing, the adapter checks whether the slug
already exists in the CMS and updates the existing entry instead of
double-posting (Strapi: updates by `documentId`, checking both draft and
published partitions).

Refresh uses a separate body-only update (`updateContent`). It does not
change the title, the slug, or the publish status: a WordPress draft stays
a draft, and a live Ghost or Strapi post stays live.

## Metrics

Every plugin must show what it's doing. `/seo` opens with the funnel:
published posts (local DB) → indexed → impressions → clicks (Google Search
Console, trailing 28 days, scoped to the posts we published), plus the
site-wide GSC totals for context.

GSC data comes from the account's Graphed warehouse — the same
`GRAPHED_WAREHOUSE_URL`/`GRAPHED_TOKEN` the cloud runtime injects (locally:
`graphed dev run -- npm run dev`). Every Search Console source shares one
ClickHouse schema shape (`packages/core/src/seo/metrics.ts` documents the
tables); the only per-client value is the database name, set as
`metrics.searchConsoleSchema` in `client.config.json`
(e.g. `"search_xsbvd7"`). Find it with
`graphed warehouse query -- "SHOW DATABASES"` — it's the `search_*` entry.
GA4 (`ga4_*`, same same-shape rule) is deliberately not wired up yet — add
it for post-click behavior (engaged sessions, key events per article URL)
when the funnel needs it.

## Refreshing published articles

`seo-refresh` runs every morning (`0 6 * * *`, America/New_York), before
the publish job. It loads `seo_articles` rows with `status = published` and,
when `metrics.searchConsoleSchema` is set, trailing-28-day Search Console
page metrics and queries for those URLs (`page_report` and
`keyword_page_report` in that schema).

For each article in the batch it looks up the keyword on Google
(`serper:search`), fetches ranking-page text (`exa:contents`), and asks the
gap model for coverage gaps plus forum insight. If that call fails, a
heading and token heuristic fills in the gaps. A Serper failure records
`leave` and does not rewrite, except for thin articles, which still expand.

Decisions:

- **dedupe** — same normalized title, or a numeric slug suffix (`guide-2`
  beside `guide`), and this URL has fewer impressions. The rewrite points
  at the stronger article. Title and slug stay. Nothing is unpublished.
- **expand** — under 500 words (`SEO_REFRESH_THIN_WORD_THRESHOLD`).
- **refresh** — ranking pages cover topics this article does not. Forum
  insight is added to the reason and the rewrite prompt when a coverage gap
  already triggered the refresh. A forum thread by itself is a leave.
- **leave** — coverage looks aligned, or the SERP lookup failed on a
  full-length article.

Search Console orders the batch and picks the weaker duplicate. It does not
choose expand versus refresh. Posts whose body is missing `content.ctaUrl`
are pulled forward when a CTA is configured. A missing CTA does not bypass
the audit cooldown. The batch defaults to 8. Posts rewritten in the last 30
days are skipped. A post audited in the last 7 days is skipped in both
audit-only and apply mode, except apply mode still retries a non-leave
decision that has not been written yet.

Every decision is stored in `seo_article_audits` (GSC numbers, reason, gap
trace). The article and the CMS are not written unless `SEO_REFRESH_APPLY`
is true or the process is started with `--apply`. A rewrite is discarded
when it is empty, adds an H1, drops the configured CTA link, drops the
canonical article link on a dedupe, lacks `##` / `###` headings, comes back
under the thin-word threshold on an expand, or shrinks below 60% of the
original. A failed CMS update leaves local
markdown unchanged and records `leave`, so the post waits out the 7-day
audit cooldown instead of retrying every night. The run logs how many CMS
updates failed. If every attempted CMS write failed, the job exits
non-zero. A partial failure stays exit 0. The previous body is kept in
`seo_articles.pre_refresh_markdown` the first time a write succeeds.

If Search Console is configured and the warehouse query throws, the job
fails and writes nothing. If the schema is omitted, the loop still runs
and impressions are unknown (duplicate ties fall through to slug order).
`cms.type: "none"` updates local markdown only, and only when apply is on.

Code defaults, not secrets: batch 8, thin threshold 500, minimum age 30
days, gap model `anthropic/claude-sonnet-4.5`, rewrite model
`openai/gpt-4.1` (long rewrites time out on Sonnet through the tools proxy).
The publish job keeps using `OPENROUTER_MODEL`. Override
a refresh default by adding the name to the `seo-refresh` job's `env` list
and running `graphed secrets set`.

## Requirements

- The `primary` database from the base scaffold (three new tables, one
  migration)
- Graphed Tools for drafting and research. `GRAPHED_TOKEN` and
  `GRAPHED_TOOLS_URL` are injected in cloud and by `graphed dev run`. There
  is no OpenRouter, Serper, or Exa API key to set. `OPENROUTER_MODEL`
  (default `anthropic/claude-sonnet-4.5`) selects the model on that proxy.
- CMS secrets only for the CMS you pick (see `plugin.yaml`)
- For metrics: a Google Search Console source on the account and its schema
  name in `client.config.json` (see above)

## Safety

- A run publishes to the configured CMS on every run. If you want
  review-before-publish, point the CMS adapter at drafts instead (the
  WordPress adapter already works that way; one-line change in the
  Ghost/Strapi adapters).
- `retries: 0` in the manifest — a failed publish stays visible in the
  queue (`failed` with its error) and is re-claimable by the next scheduled
  run or the dashboard's "Run now", instead of being retried blindly.
- `seo-refresh` does not write until `SEO_REFRESH_APPLY` is set. The first
  deploys only record audits.

## Deliberately not included

AI-generated feature images and per-keyword rank tracking exist in
Graphed's production SEO systems but were cut to keep this kit readable.
The pipeline has natural seams for both: feature images slot in after the
edit pass, and rank tracking is a query over `keyword_page_report` — the
same warehouse table family the metrics strip already documents.

## Provenance

Distilled from Graphed's production SEO systems: Ghost publishing, a
WordPress draft adapter, a Strapi adapter with blocks conversion,
config-driven CMS selection, and a published-article refresh loop driven
by Search Console and the live SERP.
