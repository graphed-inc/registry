import { Activity, LayoutDashboard, Puzzle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { pluginNavEntries } from "../lib/plugins";
import "./globals.css";

export const metadata: Metadata = {
  title: "__PROJECT_NAME__",
  description: "__PROJECT_NAME__ — running on Graphed",
};

const baseNav = [
  { key: "overview", label: "Overview", href: "/", icon: LayoutDashboard },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  const enabledPlugins = pluginNavEntries.filter((entry) => entry.enabled);
  const groups = [...new Set(enabledPlugins.map((entry) => entry.group))];

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <aside className="flex w-60 shrink-0 flex-col border-r bg-card/40">
            <div className="flex items-center gap-2.5 px-5 py-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Activity className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-tight">
                  __PROJECT_NAME__
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  __PROJECT_SLUG__
                </div>
              </div>
            </div>
            <nav className="flex-1 space-y-6 px-3 py-2">
              <div className="space-y-0.5">
                {baseNav.map((entry) => (
                  <NavLink
                    key={entry.key}
                    href={entry.href}
                    label={entry.label}
                    icon={entry.icon}
                  />
                ))}
              </div>
              {groups.map((group) => (
                <div key={group}>
                  <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group}
                  </div>
                  <div className="space-y-0.5">
                    {enabledPlugins
                      .filter((entry) => entry.group === group)
                      .map((entry) => (
                        <NavLink
                          key={entry.key}
                          href={entry.href}
                          label={entry.label}
                          icon={Puzzle}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="border-t px-5 py-4 text-xs text-muted-foreground">
              Running on Graphed
            </div>
          </aside>
          <main className="flex-1 px-8 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground",
        "transition-colors hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}
