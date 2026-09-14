import { useEffect, useMemo, useState } from "react";
import { Input } from "@bb/shared-ui/input";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Button } from "@bb/shared-ui/button";
import { formatBytes } from "./format.js";
import type { ProcessSample } from "../contract.js";

export interface ProcessTableProps {
  processes: readonly ProcessSample[];
  loading: boolean;
  error: string | null;
  totalMatched: number;
  truncated: boolean;
  onRefresh: () => void;
}

export function ProcessTable({
  processes,
  loading,
  error,
  totalMatched,
  truncated,
  onRefresh,
}: ProcessTableProps) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [sortBy, setSortBy] = useState<"cpu" | "memory">("cpu");

  useEffect(() => {
    const handle = setTimeout(() => setAppliedQuery(query.trim()), 300);
    return () => clearTimeout(handle);
  }, [query]);

  const rows = useMemo(() => {
    const lowered = appliedQuery.toLowerCase();
    const filtered = processes.filter(
      (process) =>
        lowered.length === 0 ||
        process.name.toLowerCase().includes(lowered) ||
        String(process.pid).includes(lowered),
    );
    return [...filtered].sort((a, b) => {
      if (sortBy === "memory") return b.memoryBytes - a.memoryBytes;
      const aCpu = a.cpuPercent ?? -1;
      const bCpu = b.cpuPercent ?? -1;
      if (aCpu !== bCpu) return bCpu - aCpu;
      return b.memoryBytes - a.memoryBytes;
    });
  }, [processes, appliedQuery, sortBy]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or PID…"
          aria-label="Search processes"
          className="h-8 min-w-0 flex-1 text-xs"
          data-testid="pc-processes-search"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-xs"
          onClick={() => setSortBy(sortBy === "cpu" ? "memory" : "cpu")}
          data-testid="pc-processes-sort"
        >
          Sort: {sortBy === "cpu" ? "CPU" : "RAM"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-2.5 text-xs"
          onClick={onRefresh}
          disabled={loading}
          data-testid="pc-processes-refresh"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {error !== null ? (
        <p
          className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          data-testid="pc-processes-error"
        >
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="pc-processes-scroller">
        {loading && processes.length === 0 ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-7 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-xs text-muted-foreground">
            {error === null
              ? appliedQuery.length > 0
                ? `No processes match “${appliedQuery}”.`
                : "No processes reported."
              : "Process list unavailable."}
          </p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pl-1 pr-2 font-medium">Name</th>
                <th className="px-2 py-1.5 font-medium tabular-nums">PID</th>
                <th className="px-2 py-1.5 font-medium tabular-nums">CPU</th>
                <th className="px-2 py-1.5 pr-1 font-medium tabular-nums">RAM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((process) => (
                <tr
                  key={process.pid}
                  className="border-b border-border/40 hover:bg-accent/40"
                >
                  <td className="max-w-0 truncate py-1.5 pl-1 pr-2" title={process.name}>
                    {process.name}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                    {process.pid}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {process.cpuPercent === null
                      ? "—"
                      : `${process.cpuPercent.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-1.5 pr-1 tabular-nums text-muted-foreground">
                    {formatBytes(process.memoryBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="shrink-0 text-[11px] text-muted-foreground" data-testid="pc-processes-meta">
        {rows.length} of {totalMatched} matched
        {truncated ? " (host list capped)" : ""} · sorted by{" "}
        {sortBy === "cpu" ? "CPU" : "RAM"} · manual refresh
      </p>
    </div>
  );
}
