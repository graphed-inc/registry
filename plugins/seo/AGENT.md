# Integrate: seo

You are integrating the SEO agent plugin into this Graphed project. Work the
steps in order. The `files/` directory beside this runbook is tested
reference source — adapt it into the project, don't rewrite it.

What gets built: a keyword queue (`seo_keywords`) feeding a daily cron job
that drafts articles with an LLM and publishes them to the client's CMS,
plus a dashboard console at `/seo` — a Search Console metrics strip
(published → indexed → impressions → clicks for the posts we shipped), CSV
import, run-now per keyword, article slide-over reader,
unpublish-to-draft, queue removal.

## Decide with the user first

Ask which CMS to publish to: **Ghost**, **WordPress**, **Strapi**, or
**none** (generate drafts only, wire a CMS later). This choice determines
the client config and which secrets the job needs. Default to `none` if the
user is unsure.

## Steps

1. **Copy the pipeline source.**
   - `files/packages/core/src/seo/` → `packages/core/src/seo/`
   - `files/packages/jobs/src/seo-publish-daily.ts` → `packages/jobs/src/seo-publish-daily.ts`
   - `files/clients/seo/client.config.json` → `clients/seo/client.config.json`

2. **Add the migration.** Copy
   `files/packages/core/src/migrations/0000_seo.ts` into
   `packages/core/src/migrations/`. The kit ships the whole plugin schema in
   this one file; `0000` is a placeholder — **rename it to the project's next
   free migration number** (e.g. `0002_seo.ts` in a fresh scaffold). It's a
   TypeScript migration (Kysely schema builder, `up`/`down` exports) like
   every other migration in the project.

3. **Register table types — one place only.** In
   `packages/core/src/db/types.ts`:

   ```ts
   import type { SeoArticlesTable, SeoKeywordsTable, SeoPlaybooksTable } from "../seo/tables";

   export interface Database {
     // ... existing tables ...
     seo_keywords: SeoKeywordsTable;
     seo_articles: SeoArticlesTable;
     seo_playbooks: SeoPlaybooksTable;
   }
   ```

   The dashboard and jobs share this registry via `@app/core` — do not
   duplicate the types anywhere else.

4. **Add the npm scripts.** In `packages/jobs/package.json`:

   ```json
   "job:seo-publish-daily": "tsx src/seo-publish-daily.ts"
   ```

   and a root `package.json` proxy:

   ```json
   "job:seo-publish-daily": "npm run -w @app/jobs job:seo-publish-daily"
   ```

5. **Fill in the client config.** Edit `clients/seo/client.config.json` with
   the user's real brand: `client.name`, `siteUrl`, `brandVoice`, `audience`,
   CTA, and the `cms.type` chosen above.

   **If the CMS is Strapi, you must also map the schema** — every Strapi
   instance defines its own content types, so you have to look at the
   instance and figure out where each article field goes:

   a. **Find the collection and its attributes.** Any of:
      - The user's Strapi repo:
        `src/api/<name>/content-types/<name>/schema.json` lists every
        attribute with its type — read it.
      - The Strapi admin UI → Content-Type Builder (ask the user to open it
        or paste the field list).
      - If entries already exist:
        `curl "$STRAPI_API_URL/api/<collection>?pagination[pageSize]=1" -H "Authorization: Bearer $STRAPI_API_TOKEN"`
        and inspect the attribute keys. (API tokens cannot read the
        Content-Type Builder API — that is admin-only — which is exactly why
        this mapping lives in config rather than being probed at runtime.)
   b. **Set `cms.collection`** to the plural API id (e.g. `articles` →
      requests hit `/api/articles`).
   c. **Set `cms.fields`** to map our concepts onto the instance's attribute
      names: `title`, `slug`, `excerpt`, `body`, `metaDescription`. Only the
      attributes that exist — unknown attributes make Strapi reject creates
      with a 400.
   d. **Set `cms.bodyFormat` to match the body field's type**: `"blocks"`
      for Strapi v5 rich-text Blocks fields, `"markdown"` for markdown
      fields, `"html"` for CKEditor-style rich text.
   e. **Optionally set `cms.publicUrlPattern`** (e.g.
      `https://<site>/blog/{slug}`) so the dashboard can link to live posts —
      Strapi is headless and has no canonical public URL of its own.

6. **Wire up Search Console metrics.** The `/seo` funnel reads the client's
   GSC source from the account warehouse. Find its schema name:
   `graphed warehouse query -- "SHOW DATABASES"` → the `search_*` entry
   (e.g. `search_xsbvd7`), then set it in `clients/seo/client.config.json`:
   `"metrics": { "searchConsoleSchema": "search_xsbvd7" }`. If the account
   has no GSC source yet, tell the user to connect one in Graphed settings
   and skip this step — the page shows a setup hint until configured.
   (Warehouse credentials come from the runtime: automatic in cloud, and
   locally via `graphed dev run -- npm run dev`.)
7. **Add the dashboard page.** Copy
   `files/packages/dashboard/app/seo/` → `packages/dashboard/app/seo/`, then
   append to `pluginNavEntries` in `packages/dashboard/lib/plugins.ts`:

   ```ts
   { key: "seo", label: "SEO", href: "/seo", group: "Channels", enabled: true },
   ```

8. **Wire the manifest.** If `graphed plugins add seo --apply-manifest` was
   used, the `seo-publish-daily` job is already in `graphed.yaml` — verify
   it. Otherwise merge the kit's `manifest.yaml` by hand. Then add the
   secrets for the chosen CMS to the job's `env` list:
   - ghost: `GHOST_API_URL`, `GHOST_ADMIN_API_KEY`
   - wordpress: `WP_URL`, `WP_USERNAME`, `WP_APPLICATION_PASSWORD`
   - strapi: `STRAPI_API_URL`, `STRAPI_API_TOKEN`
   - none: nothing to add

   Keep `retries: 0` — publishing is not idempotent.

9. **Set secrets** (skip the CMS ones if `none`; research keys optional):

   ```bash
   graphed secrets set OPENROUTER_API_KEY
   # research (optional but recommended):
   graphed secrets set SERPER_API_KEY
   graphed secrets set EXA_API_KEY
   # ghost:     graphed secrets set GHOST_API_URL && graphed secrets set GHOST_ADMIN_API_KEY
   # wordpress: graphed secrets set WP_URL && graphed secrets set WP_USERNAME && graphed secrets set WP_APPLICATION_PASSWORD
   # strapi:    graphed secrets set STRAPI_API_URL && graphed secrets set STRAPI_API_TOKEN
   ```

   Secrets are injected only for names in the job's `env` list in
   `graphed.yaml` — setting an undeclared name has no effect. To override a
   code default (`OPENROUTER_MODEL`, `SEO_CONFIG_PATH`), add the name to the
   `seo-publish-daily` job's `env` list first, then `graphed secrets set` it
   and redeploy.

   `secrets set` takes ONE secret per invocation — chain or repeat, never
   pass multiple names.

   `SERPER_API_KEY`/`EXA_API_KEY` power the research pass and give the
   fact-check pass material to check against — without them the pipeline
   runs ungrounded (allowed, but weaker). If set, add them to the job's
   `env` list in `graphed.yaml`.

   For local dev, also add them to `.env` (never commit it).

## Verify (do all of this, locally, before deploying)

```bash
docker compose up -d
npm run db:migrate          # applies the plugin migration
```

1. Seed a keyword:
   `psql "$DATABASE_URL" -c "insert into seo_keywords (keyword, slug, priority) values ('best crm for plumbers', 'best-crm-for-plumbers', 1);"`
   (use a keyword that fits the user's actual business)
2. `npm run job:seo-publish-daily` → with `cms.type: "none"`, expect a
   generated draft, keyword status `generated`, and nothing sent to any
   CMS. With a CMS configured, the article publishes for real — so verify
   with `none` first, then switch the config.
3. `npm run dev` → open `/seo` → the keyword shows its article title and a
   `generated` pill.
4. Exercise the console:
   - Import a CSV line or two via "Import keywords" → they appear `pending`.
   - "Run now" on a pending keyword → it generates (same path as the cron).
   - Open the article via the eye icon → slide-over with rendered + raw
     markdown.
   - With a published article: Unpublish → status returns to `generated`
     (and the CMS post reverts to draft when a CMS is wired up).
   - Remove a keyword → it and its articles disappear from the queue.
   - Playbook & Test tab: switch stages with the segmented control, edit the
     markdown, save → next run uses it (rows land in `seo_playbooks`). The
     test console on the same page sends the editor's CURRENT contents
     (saved or not) over the wire — test runs never read or write the
     persisted playbooks the cron job uses, and write nothing to the queue
     or CMS.
   - With `metrics.searchConsoleSchema` set and the dev server started via
     `graphed dev run -- npm run dev`: the metrics strip renders the funnel
     with real GSC numbers (published → indexed → impressions → clicks).
5. If a CMS was chosen and credentials are available: run the job once →
   keyword `published`, article has `public_url` (Ghost, or Strapi with
   `publicUrlPattern` set) or a draft exists in wp-admin (WordPress).
6. `npm run build` and `npm run typecheck` must succeed (the Dockerfile runs
   the same Next build).
7. Deploy: `graphed deploy`. The expected first-deploy loop:
   - The deploy reports `waiting_for_secrets` and prints the exact
     `graphed secrets set <NAME>` commands for whatever is missing — run
     them, then `graphed deploy` again.
   - If the re-deploy fails with `API error (409)`, the first deployment's
     build is still running. Wait a few minutes and re-run; do not start
     debugging the manifest.
   - Once `ready`: `graphed jobs run seo-publish-daily`, then
     `graphed logs --tail 50` to confirm the cloud run end to end.

## Notes

- A run always publishes when a CMS is configured. `cms.type: "none"`
  (drafts only, no external writes) is the way to verify the pipeline
  safely before wiring up a CMS.
- The pipeline runs four LLM passes (outline → draft → edit → fact-check),
  each following its playbook from `seo_playbooks` (dashboard-editable).
  House rules (no links/dashes/aging dates) stay in code on purpose.
- Research (Serper/Exa) is optional: without keys the run is ungrounded and
  prompts tell the model to stay non-specific.
- Idempotency: re-running for a slug that exists in the CMS links the local
  row instead of creating a duplicate post.
- Removing a keyword is local-only by design — it never deletes a live CMS
  post. Unpublish first when the post should come down.
