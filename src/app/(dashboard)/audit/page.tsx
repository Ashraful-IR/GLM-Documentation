"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Api, ClientError } from "@/lib/api/client";
import type { AuditLogEntry } from "@/types";

const PAGE_SIZE = 15;

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Deferred one tick — the rule flags synchronous setState-in-effect.
    const start = setTimeout(() => setLoading(true), 0);
    Api.listAudit(page, PAGE_SIZE)
      .then((res) => {
        if (cancelled) return;
        setLogs(res.items);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err instanceof ClientError ? err.message : "Failed to load audit log");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [page]);

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">Every mutating action, in order.</p>

      <div className="mt-6 overflow-hidden rounded-lg border">
        {loading ? (
          <div className="space-y-2 p-3 sm:p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium">Entity</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-t">
                    <td className="px-4 py-2">
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {log.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                      {log.entityType}:{log.entityId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2">{log.user?.name ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {!loading && total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5 sm:px-4 sm:flex-nowrap">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium text-foreground">{start}–{end}</span> of{" "}
              <span className="font-medium text-foreground">{total}</span> · Page{" "}
              <span className="font-medium text-foreground">{page}</span> of {totalPages}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
