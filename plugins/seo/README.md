# seo

An SEO content agent for Graphed projects: a keyword queue in Postgres, an
LLM drafting pipeline, direct CMS publishing, and a dashboard
page to watch it all.

## What it does

Every day, the `seo-publish-daily` cron job takes the next `pending`
keyword from `seo_keywords`, generates an article, stores it in
`seo_articles`, and publishes it through the configured CMS adapter.

Generation is a multi-pass pipeline, and every pass's instructions are a
user-editable playbook (markdown, edited from the dashboard's Playbook &
Test tab). Nothing is seeded: defaults live in code (`seo/playbooks.ts`) and
`seo_playbooks` rows are overrides only — "Reset to default" just deletes
the row, so upstream default improvements reach projects that never
customized. The test console on the same tab runs the full pipeline on the
editor's current (even unsaved) contents, so iterating on instructions
never touches the live cron job's playbooks:

0. **Research** — Serper (`SERPER_API_KEY`: top results, people-also-ask,
   related searches) and Exa (`EXA_API_KEY`: ranking-page content extracts)
   build a compact research brief. Both optional; missing keys run
   ungrounded, and the prompts tell the model to stay non-specific.
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

## Requirements

- The `primary` database from the base scaffold (two new tables, one
  migration)
- `OPENROUTER_API_KEY`
- CMS secrets only for the CMS you pick (see `plugin.yaml`)
- For metrics: a Google Search Console source on the account and its schema
  name in `client.config.json` (see above)

## Safety

- Publishing is always on — there is no dry-run mode to reason about. If
  you want review-before-publish, point the CMS adapter at drafts instead
  (the WordPress adapter already works that way; one-line change in the
  Ghost/Strapi adapters).
- `retries: 0` in the manifest — a failed run stays visible in the queue
  (`failed` with its error) and is re-claimable by the next scheduled run
  or the dashboard's "Run now", instead of being retried blindly.

## Deliberately not included

AI-generated feature images and per-keyword rank tracking exist in
Graphed's production SEO systems but were cut to keep this kit readable.
The pipeline has natural seams for both: feature images slot in after the
edit pass, and rank tracking is a query over `keyword_page_report` — the
same warehouse table family the metrics strip already documents.

## Provenance

Distilled from the Graphed client-systems fleet (Ghost pipeline from the
Eden/client-systems lineage; WordPress adapter from the NutraCap lineage;
Strapi adapter and blocks conversion from the Wurthy/Styleframe lineage;
config-driven CMS selection from the seo-agent pattern).
