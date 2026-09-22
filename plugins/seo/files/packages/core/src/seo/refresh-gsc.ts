import { assertSchemaName, sqlString, toNumber } from "./metrics";
import { urlVariants, type GscMetrics } from "./refresh";
import { warehouseQuery } from "./warehouse";

export interface GscQueryRow {
  query: string;
  impressions_28d: number;
  clicks_28d: number;
  avg_position_28d: number;
}

function addMetrics(existing: GscMetrics | undefined, row: GscMetrics): GscMetrics {
  if (
    !existing ||
    existing.impressions_28d == null ||
    row.impressions_28d == null
  ) {
    return row;
  }
  const impressions = existing.impressions_28d + row.impressions_28d;
  const clicks = (existing.clicks_28d ?? 0) + (row.clicks_28d ?? 0);
  const weighted =
    impressions > 0
      ? ((existing.avg_position_28d ?? 0) * existing.impressions_28d +
          (row.avg_position_28d ?? 0) * row.impressions_28d) /
        impressions
      : 0;
  return {
    impressions_28d: impressions,
    clicks_28d: clicks,
    ctr_28d: impressions > 0 ? clicks / impressions : 0,
    avg_position_28d: weighted,
  };
}

/**
 * Trailing-28-day page metrics for the articles we published.
 * Keys are the public URLs we asked about. Throws if the warehouse call fails
 * — the refresh job treats that as fatal and writes nothing.
 */
export async function fetchPageMetrics28d(
  schema: string,
  publicUrls: string[],
): Promise<Map<string, GscMetrics>> {
  const out = new Map<string, GscMetrics>();
  if (publicUrls.length === 0) return out;

  const owner = new Map<string, string>();
  const variants: string[] = [];
  for (const url of publicUrls) {
    for (const variant of urlVariants(url)) {
      if (!owner.has(variant)) {
        owner.set(variant, url);
        variants.push(variant);
      }
    }
  }

  const table = `${assertSchemaName(schema)}.page_report`;
  const result = await warehouseQuery(
    `SELECT page AS page, sum(clicks) AS clicks_28d, sum(impressions) AS impressions_28d, if(sum(impressions) > 0, sum(clicks) / sum(impressions), 0) AS ctr_28d, avg(position) AS avg_position_28d FROM ${table} WHERE date >= today() - toIntervalDay(28) AND page IN (${variants.map(sqlString).join(", ")}) GROUP BY page`,
  );

  for (const row of result.results) {
    const page = String(row.page ?? "");
    const canonical = owner.get(page);
    if (!canonical) continue;
    const next: GscMetrics = {
      impressions_28d: toNumber(row.impressions_28d),
      clicks_28d: toNumber(row.clicks_28d),
      ctr_28d: toNumber(row.ctr_28d),
      avg_position_28d: toNumber(row.avg_position_28d),
    };
    out.set(canonical, addMetrics(out.get(canonical), next));
  }
  return out;
}

/** Top queries for one article URL. A failure here is non-fatal for the caller. */
export async function fetchQueriesForPage(
  schema: string,
  publicUrl: string,
): Promise<GscQueryRow[]> {
  const variants = urlVariants(publicUrl);
  const table = `${assertSchemaName(schema)}.keyword_page_report`;
  const result = await warehouseQuery(
    `SELECT query AS query, sum(clicks) AS clicks_28d, sum(impressions) AS impressions_28d, avg(position) AS avg_position_28d FROM ${table} WHERE date >= today() - toIntervalDay(28) AND page IN (${variants.map(sqlString).join(", ")}) GROUP BY query ORDER BY impressions_28d DESC LIMIT 20`,
  );
  return result.results.map((row) => ({
    query: String(row.query ?? ""),
    clicks_28d: toNumber(row.clicks_28d),
    impressions_28d: toNumber(row.impressions_28d),
    avg_position_28d: toNumber(row.avg_position_28d),
  }));
}
