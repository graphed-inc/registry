export function formatUsd(value: number, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: compact || value >= 100 ? 0 : 2,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(value);
}

export function formatCpa(value: number | null): string {
  return value == null ? "—" : formatUsd(value);
}

export function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(0)}%`;
}

export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function formatWhen(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** Strip a trailing sentence ender so the page can add its own period. */
export function withoutTrailingPunctuation(text: string): string {
  return text.trim().replace(/[.!?]+$/u, "");
}

export function headlineOf(report: string | null): string {
  if (!report) return "No report";
  const line = report
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "No report";
}
