"use client";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CampaignTableRow {
  id: string;
  href: string;
  name: string;
  status: string;
  statusVariant: "secondary" | "success" | "warning" | "destructive";
  mode: string;
  modeVariant: "secondary" | "info" | "success";
  leads: string;
  contacted: string;
  sent: string;
  opens: string;
  replies: string;
  bounced: string;
}

export function CampaignsTable({ rows }: { rows: CampaignTableRow[] }) {
  const router = useRouter();
  return (
    <Table className="min-w-[1080px]">
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">Campaign</TableHead>
          <TableHead className="whitespace-nowrap">Status</TableHead>
          <TableHead className="whitespace-nowrap">Reply mode</TableHead>
          <TableHead className="whitespace-nowrap text-right">Leads</TableHead>
          <TableHead className="whitespace-nowrap text-right">Contacted</TableHead>
          <TableHead className="whitespace-nowrap text-right">Sent</TableHead>
          <TableHead className="whitespace-nowrap text-right">Opens</TableHead>
          <TableHead className="whitespace-nowrap text-right">Replies</TableHead>
          <TableHead className="whitespace-nowrap text-right">Bounced</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            className="cursor-pointer"
            onClick={() => router.push(row.href)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                router.push(row.href);
              }
            }}
            tabIndex={0}
          >
            <TableCell className="max-w-[280px] font-medium">
              <span className="line-clamp-2">{row.name}</span>
            </TableCell>
            <TableCell>
              <Badge variant={row.statusVariant}>{row.status}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={row.modeVariant}>{row.mode}</Badge>
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.leads}</TableCell>
            <TableCell className="text-right tabular-nums">{row.contacted}</TableCell>
            <TableCell className="text-right tabular-nums">{row.sent}</TableCell>
            <TableCell className="text-right tabular-nums">{row.opens}</TableCell>
            <TableCell className="text-right tabular-nums">{row.replies}</TableCell>
            <TableCell className="text-right tabular-nums">{row.bounced}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
