export function asDateString(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return null;
}

/** ClickHouse DateTime64 often comes back as `YYYY-MM-DD HH:mm:ss.sss`. */
export function parseWarehouseTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (raw === "") return null;
  const spaced = raw.includes("T") ? raw : raw.replace(" ", "T");
  const iso =
    /Z$/i.test(spaced) || /[+-]\d{2}:?\d{2}$/.test(spaced)
      ? spaced
      : `${spaced}Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Same bar as the Overview stale banner and write-tool refuse. */
export const WAREHOUSE_STALE_HOURS = 12;

export function isWarehouseStale(lagHours: number | null): boolean {
  return lagHours != null && lagHours > WAREHOUSE_STALE_HOURS;
}

/**
 * Hours since the warehouse last produced a usable stats point.
 * Uses both `_fivetran_synced` and `max(date)` (end of that UTC day).
 * A fresh sync does not hide a stale stats day — allow one full day of
 * ordinary Ads reporting delay before data age dominates.
 */
export function computeWarehouseLagHours(input: {
  asOfDate: string | null;
  lastSynced?: unknown;
  nowMs?: number;
}): number | null {
  const nowMs = input.nowMs ?? Date.now();
  const synced = parseWarehouseTimestamp(input.lastSynced);
  const syncLag = synced ? (nowMs - synced.getTime()) / 3_600_000 : null;
  const endOfDay = input.asOfDate
    ? Date.parse(`${input.asOfDate}T23:59:59.999Z`)
    : Number.NaN;
  const dataLag = Number.isNaN(endOfDay)
    ? null
    : (nowMs - endOfDay) / 3_600_000;

  if (syncLag == null) {
    return dataLag == null ? null : Math.max(0, dataLag - 24);
  }
  if (dataLag == null) return Math.max(0, syncLag);
  return Math.max(0, syncLag, dataLag - 24);
}

export function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value !== "") return Number(value);
  return 0;
}
