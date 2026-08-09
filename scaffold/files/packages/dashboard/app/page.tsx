import { getDb } from "@app/core";
import { Database, HeartPulse, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface OverviewData {
  total: number;
  latest: { id: number; message: string; created_at: Date }[];
}

async function loadOverview(): Promise<OverviewData | { error: string }> {
  try {
    const db = getDb();
    const latest = await db
      .selectFrom("example_heartbeats")
      .select(["id", "message", "created_at"])
      .orderBy("id", "desc")
      .limit(10)
      .execute();
    const countRow = await db
      .selectFrom("example_heartbeats")
      .select((eb) => eb.fn.countAll().as("count"))
      .executeTakeFirstOrThrow();
    return { total: Number(countRow.count), latest };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "database unreachable",
    };
  }
}

export default async function OverviewPage() {
  const data = await loadOverview();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          __PROJECT_NAME__ — one database, one cron job, this dashboard.
        </p>
      </div>

      {"error" in data ? (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-400">
              <TriangleAlert className="h-4 w-4" />
              Database not reachable
            </CardTitle>
            <CardDescription>{data.error}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Locally: <code>docker compose up -d</code> then{" "}
            <code>npm run db:migrate</code>. In the cloud the database is
            provisioned from <code>graphed.yaml</code>.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5" />
                  Database
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Badge variant="success" className="text-sm">
                  Connected
                </Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <HeartPulse className="h-3.5 w-3.5" />
                  Job heartbeats
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">
                  {data.total}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Latest heartbeats</CardTitle>
              <CardDescription>
                Written by the example-daily cron job.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.latest.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing yet — run <code>npm run job:example-daily</code>{" "}
                  locally or <code>graphed jobs run example-daily</code> in the
                  cloud.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Message</TableHead>
                      <TableHead className="w-44 text-right">Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.latest.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-foreground/90">
                          {row.message}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-sm text-muted-foreground">
            Add a capability: <code>graphed plugins list</code>, then{" "}
            <code>graphed plugins add &lt;name&gt;</code> and follow the staged
            AGENT.md.
          </p>
        </>
      )}
    </div>
  );
}
