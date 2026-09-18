import Link from "next/link";

import { cn } from "@/lib/utils";

export function SegmentedControl({
  tab,
}: {
  tab: "overview" | "sessions";
}) {
  const items = [
    { id: "overview" as const, label: "Overview", href: "/google-ads" },
    {
      id: "sessions" as const,
      label: "Sessions",
      href: "/google-ads?tab=sessions",
    },
  ];

  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1">
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={cn(
            "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
            tab === item.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
