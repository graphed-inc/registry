import Link from "next/link";

export function Segmented({
  items,
}: {
  items: { href: string; label: string; active: boolean }[];
}) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border bg-muted/40 p-1">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={
            item.active
              ? "rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm"
              : "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          }
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
