import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InstantlyLead } from "@app/core/outbound/instantly";

function leadStatus(status: number | null): {
  label: string;
  variant: "secondary" | "success" | "warning" | "destructive";
} {
  if (status === 1) return { label: "Active", variant: "success" };
  if (status === 2) return { label: "Paused", variant: "warning" };
  if (status === 3) return { label: "Completed", variant: "secondary" };
  if (status === -1) return { label: "Bounced", variant: "destructive" };
  if (status === -2) return { label: "Unsubscribed", variant: "destructive" };
  if (status === -3) return { label: "Skipped", variant: "warning" };
  return { label: "—", variant: "secondary" };
}

function interestLabel(status: number | null): string {
  if (status === 0) return "Out of office";
  if (status === 1) return "Interested";
  if (status === 2) return "Meeting booked";
  if (status === 3) return "Meeting completed";
  if (status === 4) return "Won";
  if (status === -1) return "Not interested";
  if (status === -2) return "Wrong person";
  if (status === -3) return "Lost";
  if (status === -4) return "No show";
  if (status === null) return "—";
  return `Label ${status}`;
}

function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function person(lead: InstantlyLead): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
  return name || "—";
}

export function LeadsTable({
  leads,
  nextHref,
  totalHint,
}: {
  leads: InstantlyLead[];
  nextHref: string | null;
  totalHint: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {leads.length === 0
            ? "No leads on this page."
            : `Showing ${leads.length.toLocaleString("en-US")}${totalHint ? ` of ${totalHint}` : ""}.`}
        </p>
        {nextHref ? (
          <Button asChild variant="outline" size="sm">
            <Link href={nextHref}>Next</Link>
          </Button>
        ) : null}
      </div>
      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Name</TableHead>
            <TableHead className="whitespace-nowrap">Email</TableHead>
            <TableHead className="whitespace-nowrap">Company</TableHead>
            <TableHead className="whitespace-nowrap">Status</TableHead>
            <TableHead className="whitespace-nowrap">Interest</TableHead>
            <TableHead className="whitespace-nowrap text-right">Opens</TableHead>
            <TableHead className="whitespace-nowrap text-right">Replies</TableHead>
            <TableHead className="whitespace-nowrap">Last contact</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => {
            const status = leadStatus(lead.status);
            return (
              <TableRow key={lead.id}>
                <TableCell className="font-medium">{person(lead)}</TableCell>
                <TableCell className="max-w-[220px] truncate">
                  {lead.email ?? "—"}
                </TableCell>
                <TableCell className="max-w-[180px] truncate">
                  {lead.companyName ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </TableCell>
                <TableCell>{interestLabel(lead.interestStatus)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {lead.openCount.toLocaleString("en-US")}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {lead.replyCount.toLocaleString("en-US")}
                </TableCell>
                <TableCell>{formatWhen(lead.lastContact)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
