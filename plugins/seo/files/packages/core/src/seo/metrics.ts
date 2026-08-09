import { getDb } from "../db/index";
import { loadClientConfig } from "./config";
import { warehouseConfigured, warehouseQuery } from "./warehouse";

// Metrics = "what is the system doing?" Every plugin should answer that.
//
// The headline funnel is scoped to the plugin's own output — published
// articles joined to their Search Console page rows — with site-wide GSC
// totals alongside for context.
//
// ── Source schema shapes ────────────────────────────────────────────────
// Every Graphed source of a type lands in the warehouse with the same
// ClickHouse schema; only the database name differs per client
// (`search_*` for Search Console, `ga4_*` for GA4, `google_ads_*`, ...).
// The name is per-client config: `metrics.searchConsoleSchema` in
// client.config.json, discovered via `graphed warehouse query -- "SHOW DATABASES"`.
//
// Google Search Console (this plugin uses it):
//   page_report(date Date32, site, search_type, country, device,
//               page String, clicks, impressions, ctr, position Float64?)
//   keyword_page_report(...)          same + query String
//   hourly_page_report(hour DateTime64, ...)   intraday variant
//   sitemap(site, path, submitted, indexed, warnings, errors, ...)
//     NOTE: `indexed` arrives as 0 from the GSC API in practice — see the
//     "indexed" proxy note in loadSeoMetrics.
//
// GA4 (not used here yet):
//   ga4_* sources expose daily event/session tables of the same shape
//   (date, page/session dims, sessions, engaged_sessions, conversions...).
//   Add it when we want post-click behavior: engaged sessions or key events
//   per article URL. The four-card funnel above doesn't need it.

export interface SeoMetrics {
  publishedPosts: number;
  /** Published posts that received ≥1 impression in the trailing window. */
  indexedPosts: number;
  /** Impressions on our published article URLs, trailing window. */
  postImpressions: number;
  /** Clicks on our published article URLs, trailing window. */
  postClicks: number;
  site: {
    pages: number;
    impressions: number;
    clicks: number;
  } | null;
}

export interface SeoMetricsResult {
  metrics: SeoMetrics | null;
  /** Why metrics are absent — rendered as the setup hint on /seo. */
  reason: "no-warehouse" | "no-search-console-schema" | "error" | null;
  /** Underlying error message when reason is "error" — surfaced on /seo so
   * cloud misconfiguration is debuggable instead of masked as missing
   * credentials. */
  detail?: string;
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

// The warehouse's %(param)s parameters are all typed String server-side, so
// numeric intervals and URL lists are interpolated here instead — both are
// trusted local values (our config, our DB), escaped/defended below.
function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) {
    throw new Error(`Invalid warehouse schema name: ${JSON.stringify(schema)}`);
  }
  return schema;
}

export async function loadSeoMetrics(days = 28): Promise<SeoMetricsResult> {
  const db = getDb();

  const publishedRows = await db
    .selectFrom("seo_articles")
    .select(["public_url"])
    .where("status", "=", "published")
    .where("public_url", "is not", null)
    .execute();
  const urls = publishedRows
    .map((row) => row.public_url)
    .filter((url): url is string => Boolean(url));

  if (!warehouseConfigured()) {
    return { metrics: null, reason: "no-warehouse" };
  }
  const schema = loadClientConfig().metrics?.searchConsoleSchema;
  if (!schema) {
    return { metrics: null, reason: "no-search-console-schema" };
  }
  const table = `${assertSchemaName(schema)}.page_report`;
  const window = `date >= today() - toIntervalDay(${Math.floor(days)})`;

  // A page that received impressions is in Google's index by definition.
  // GSC's sitemap table reports `indexed` as 0 (API limitation), so
  // "indexed" here means "had impressions in the trailing window".
  const sitePromise = warehouseQuery(
    `SELECT uniqExact(page) AS pages, sum(impressions) AS impressions, sum(clicks) AS clicks FROM ${table} WHERE ${window}`,
  );

  // The query validator rejects same-name aliases around a subquery
  // ("aggregate function found inside another aggregate function"), so the
  // per-page rollup uses distinct alias names in the outer select.
  const oursPromise =
    urls.length === 0
      ? Promise.resolve(null)
      : warehouseQuery(
          `SELECT uniqExactIf(page, impressions > 0) AS indexed, sum(impressions) AS total_impressions, sum(clicks) AS total_clicks FROM (SELECT page, sum(impressions) AS impressions, sum(clicks) AS clicks FROM ${table} WHERE ${window} AND page IN (${urls.map(sqlString).join(", ")}) GROUP BY page)`,
        );

  const [site, ours] = await Promise.all([sitePromise, oursPromise]);

  const siteRow = site.results[0];
  const ourRow = ours?.results[0];

  return {
    reason: null,
    metrics: {
      publishedPosts: urls.length,
      indexedPosts: toNumber(ourRow?.indexed),
      postImpressions: toNumber(ourRow?.total_impressions),
      postClicks: toNumber(ourRow?.total_clicks),
      site: siteRow
        ? {
            pages: toNumber(siteRow.pages),
            impressions: toNumber(siteRow.impressions),
            clicks: toNumber(siteRow.clicks),
          }
        : null,
    },
  };
}
