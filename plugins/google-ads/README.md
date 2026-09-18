# google-ads

A Google Ads agent for Graphed projects: a Mastra daily loop with a locked
tool belt, warehouse KPIs, and a dashboard to watch every run.

## What it does

Every morning (8:00 AM America/New_York), `google-ads-daily` starts a
Mastra agent with an interpolated system prompt. The prompt is the Testing
→ Winners playbook. The only I/O is tools:

| Tool | Role |
|------|------|
| `memory_get` / `memory_set` | Standing notes (baselines, watch_items, changes_log, gotchas) |
| `get_scoreboard` | Warehouse spend / conv / CPA by campaign or ad group |
| `list_search_terms` | Warehouse waste and converter hunt |
| `list_keywords` | Warehouse positives; campaign negatives via Ads if that history table is missing |
| `get_serving_health` | Recent vs baseline impressions |
| `add_negative` / `remove_negative` | Testing campaign / Winners ad-group negatives |
| `promote_search_term` | Testing converter → Winners exact + RSA. Refuses own-brand / competitor-brand terms (LLM judge). |
| `pause_ad_group` | Demote a Winners group (never the last one) |
| `rebalance_budgets` | Shift Testing/Winners daily budgets inside the cap |
| `classify_terms` | LLM off-intent check (null = skip the decision) |

The dashboard at `/google-ads` has a segmented control:

1. **Overview** — 7d/30d KPI cards, daily spend, serving health, campaign table
2. **Sessions** — persisted Mastra traces for every run

Pipeline code lands in `packages/core/src/google-ads/`, so jobs and
dashboard share it; table types register once in
`packages/core/src/db/types.ts`.

## Safety

Default `clients/google-ads/client.config.json` has
`writes.enabled: false`. Write tools still run, but Ads mutates use
`validateOnly: true` and `applied` stays false. Brand is never writable.
Total daily budget cannot be raised. Warehouse lag over 12 hours, missing
campaign IDs, or missing Ads credentials all refuse writes.
`promote_search_term` also refuses own-brand (`display_name` +
`promotion.brand_terms`) and competitor-brand terms (default
`promotion.competitor_policy: "refuse"`) so a winning competitor query
cannot be copied into Winners RSA headlines. Set `safe_copy` to still
bid but omit the term from headlines. A down brand judge refuses
(`classifier_unavailable`). A below-threshold competitor/own-brand
verdict refuses (`low_confidence`). Low-confidence generic still bids
but omits the term from headlines. An unreadable `blocked_terms` note refuses
(`blocked_terms_unreadable`). A structurally invalid note refuses
(`blocked_terms_invalid`) until a human fixes the key — the note must be
a JSON string array (`["runway","kling ai"]`) or `{ "terms": [...] }`,
each entry a name of at most 4 words. Config
`promotion.competitor_names` / `brand_terms` use the same name heuristic
but drop a bad entry instead of failing config load. The Overview badge
and the run report name what was dropped.

There is no DRY_RUN environment flag. Turning on live writes is a config
change (`writes.enabled: true`) after the service-account JSON is set.

## Setup keywords (coding agent, not Mastra)

The daily Mastra agent only manages an already-seeded account. First
Testing keywords are setup work in `AGENT.md`: list what is already in
the Ads warehouse, or pull DataForSEO `keywords_for_site`, review with
the user, then seed.

Reliable form (bypasses npm script arg forwarding):

```bash
graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --from-account
graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --terms "ai ads agent,warehouse analytics"
graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --target graphed.com
graphed dev run -- npx tsx packages/jobs/src/google-ads-seed.ts --from-json clients/google-ads/seed.example.json
```

A bare run (no `--target` / `--from-json` / `--terms`) only lists
warehouse keywords. DataForSEO does not run unless `--target` or
`--from-json` is set. `--apply` needs `--terms`, `--target`, or
`--from-json`.

`seed.example.json` is a filtered live pull for graphed.com. `--apply`
is validateOnly until `writes.enabled` is true. Do not apply the
example against a production Ads account.

## Requirements

- The `primary` database from the base scaffold (three new tables, one
  migration)
- `@mastra/core`, `@ai-sdk/openai`, `@graphed-inc/sdk`, `google-auth-library`
  (see AGENT.md)
- For KPIs: a Google Ads source on the account and its schema name in
  `metrics.googleAdsSchema`
- For Ads API search + writes: `GOOGLE_ADS_SA_KEY_JSON` on the daily
  job only (optional until live mutates). Do not inject it on the
  dashboard. Scoreboard, search terms, positives, and ad groups come
  from the warehouse. Campaign negatives and budgets use Ads search when
  those Fivetran history tables are missing. REST version is v25
  (v19 is sunset). No developer-token header — the service account is
  enough.
- For the LLM: Graphed Tools OpenRouter. `GRAPHED_TOKEN` is injected in
  cloud and by `graphed dev run` — no OpenRouter API key.

## Deliberately not included

A Cursor/coding agent, raw GAQL, shell, git, or a second Ads account
inside one process. Another account is another client config (or project).

## Provenance

Distilled from the Graphed Internal `google-ads-agent` Cloud project
(Mastra tools + shadcn Overview/Sessions dashboard) and the Conduit
Testing → Winners loop.
