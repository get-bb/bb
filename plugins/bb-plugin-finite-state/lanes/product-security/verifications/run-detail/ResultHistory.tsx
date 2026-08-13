import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";

export interface ResultHistoryItem {
  id: string; status: string; outcome: string | null; confidence: string | null;
  evidenceSummary: string | null; executedAt: string | null; failureReason: string | null;
  remediationSuggestion: string | null; firmwareVersionName: string | null;
  isLatest: boolean; supersededBy: string | null;
}

export function ResultHistory({ items, total, hasMore, loading, onLoadMore }: { items: ResultHistoryItem[]; total: number; hasMore: boolean; loading: boolean; onLoadMore(): void }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => 170,
    getItemKey: (index) => items[index]?.id ?? index,
    getScrollElement: () => scrollRef.current,
    initialRect: { width: 960, height: 384 },
    overscan: 4,
  });
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No run evidence exists for this requirement and tier.</p>;
  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">Showing {items.length} of {total} results, newest first.</p>
    <div className="relative h-96 overflow-auto" aria-label="Verification result history" ref={scrollRef} role="list">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const item = items[virtualItem.index]!;
        return <article className="absolute left-0 top-0 w-full pb-2" data-index={virtualItem.index} key={item.id} ref={virtualizer.measureElement} role="listitem" style={{ transform: `translateY(${virtualItem.start}px)` }}><div className="rounded-md border border-border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={item.status === "verified" ? "default" : "outline"}>{item.status}</Badge>{item.isLatest ? <Badge variant="secondary">Latest</Badge> : <Badge variant="outline">Superseded</Badge>}<span className="ml-auto font-mono text-xs text-muted-foreground">{item.executedAt ?? "time unknown"}</span></div>
        <p className="mt-2 text-sm">{item.evidenceSummary ?? item.outcome ?? "No evidence summary was cached."}</p>
        {item.failureReason ? <p className="mt-2 text-sm text-destructive">Failure: {item.failureReason}</p> : null}
        {item.remediationSuggestion ? <p className="mt-1 text-sm text-muted-foreground">Remediation: {item.remediationSuggestion}</p> : null}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Confidence: {item.confidence ?? "unknown"}</span><span>Firmware: {item.firmwareVersionName ?? "unknown"}</span>{item.supersededBy ? <span className="font-mono">superseded by {item.supersededBy}</span> : null}</div>
      </div></article>;
      })}
      </div>
    </div>
    {hasMore ? <Button disabled={loading} onClick={onLoadMore} size="sm" variant="outline">{loading ? "Loading…" : "Load more history"}</Button> : null}
  </div>;
}
