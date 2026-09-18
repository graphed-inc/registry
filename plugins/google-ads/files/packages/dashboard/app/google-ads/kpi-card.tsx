import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { formatPct } from "./format";

export function KpiCard({
  label,
  value,
  hint,
  delta,
  invert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  invert?: boolean;
}) {
  const positive = delta == null ? null : invert ? delta < 0 : delta > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </div>
        <div className="flex items-center gap-2">
          {delta != null && (
            <Badge
              variant={
                positive === null
                  ? "secondary"
                  : positive
                    ? "success"
                    : "warning"
              }
              className="tabular-nums"
            >
              {formatPct(delta)}
            </Badge>
          )}
          {hint ? (
            <span className="text-xs text-muted-foreground">{hint}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
