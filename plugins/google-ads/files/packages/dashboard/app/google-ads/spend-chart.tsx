import { formatUsd } from "./format";

export function SpendChart({
  data,
}: {
  data: { date: string; spend: number; conversions: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No daily stats in the warehouse window.
      </div>
    );
  }

  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxSpend = Math.max(...data.map((row) => row.spend), 1);
  const points = data.map((row, index) => {
    const x =
      pad.left +
      (data.length === 1 ? innerW / 2 : (index / (data.length - 1)) * innerW);
    const y = pad.top + innerH - (row.spend / maxSpend) * innerH;
    return { x, y, row };
  });
  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const area = `${line} L${points[points.length - 1]?.x},${pad.top + innerH} L${points[0]?.x},${pad.top + innerH} Z`;
  const ticks = [0, 0.5, 1].map((frac) => ({
    y: pad.top + innerH - frac * innerH,
    label: formatUsd(maxSpend * frac, true),
  }));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-56 w-full"
      role="img"
      aria-label="Daily spend"
    >
      {ticks.map((tick) => (
        <g key={tick.label}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={tick.y}
            y2={tick.y}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="3 6"
          />
          <text
            x={pad.left - 8}
            y={tick.y + 3}
            textAnchor="end"
            className="fill-muted-foreground text-[11px]"
          >
            {tick.label}
          </text>
        </g>
      ))}
      <path d={area} className="fill-emerald-400/20" />
      <path
        d={line}
        fill="none"
        className="stroke-emerald-400"
        strokeWidth="2"
      />
      {points.length > 0 && (
        <text
          x={pad.left}
          y={height - 6}
          className="fill-muted-foreground text-[11px]"
        >
          {data[0]?.date}
        </text>
      )}
      {points.length > 1 && (
        <text
          x={width - pad.right}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {data[data.length - 1]?.date}
        </text>
      )}
    </svg>
  );
}
