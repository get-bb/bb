import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";
import { Legend } from "./Legend.js";
import { MatrixCell } from "./MatrixCell.js";
import type { MatrixFilterValue } from "./MatrixFilters.js";
import { MatrixFilters } from "./MatrixFilters.js";
import { MatrixHeader } from "./MatrixHeader.js";
import type { MatrixRollup, MatrixRow, VerificationTier } from "./status.js";

const ROW_HEIGHT = 74;

export type MatrixViewState = "unconfigured" | "loading" | "ready" | "error";

export interface VerificationMatrixViewProps {
  state: MatrixViewState;
  rows: readonly MatrixRow[];
  total: number;
  rollup: MatrixRollup | null;
  filters: MatrixFilterValue;
  message: string | null;
  hasNextPage: boolean;
  onFiltersChange(next: MatrixFilterValue): void;
  onLoadMore(): void;
  onRefresh(): void;
  onOpenCell(requirementId: string, tier: VerificationTier): void;
}

function CenteredState({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        {onRetry ? <button className="mt-4 h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRetry} type="button">Retry evidence read</button> : null}
      </div>
    </div>
  );
}

export function VerificationMatrixView({
  state,
  rows,
  total,
  rollup,
  filters,
  message,
  hasNextPage,
  onFiltersChange,
  onLoadMore,
  onRefresh,
  onOpenCell,
}: VerificationMatrixViewProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focus, setFocus] = useState({ row: 0, column: 0 });
  const columns = useMemo<VerificationTier[]>(() => {
    const visible: VerificationTier[] = ["static", "emulation", "hil", "hardware"];
    if (filters.showManual) visible.push("manual");
    return filters.tier === "all" ? visible : visible.filter((tier) => tier === filters.tier);
  }, [filters.showManual, filters.tier]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.requirementId ?? index,
    initialRect: { width: 1200, height: 650 },
    overscan: 6,
  });

  if (state === "unconfigured") return <CenteredState detail="Choose a project to inspect its accepted requirement and verification cache." title="Choose a project" />;
  if (state === "loading" && rows.length === 0) {
    return <div aria-label="Loading verification matrix" className="space-y-2 p-4" role="status">{[0, 1, 2, 3, 4].map((key) => <div className="h-16 animate-pulse rounded-md bg-muted" key={key} />)}<span className="sr-only">Loading verification evidence</span></div>;
  }
  if (state === "error" && rows.length === 0) return <CenteredState detail={message ?? "The accepted verification cache could not be read."} onRetry={onRefresh} title="Verification evidence unavailable" />;
  if (state === "ready" && rows.length === 0) return <CenteredState detail="No requirements are available in the accepted cache, or none match the current filters. Add requirement YAML and pull it through Sync, or clear the filters." onRetry={onRefresh} title="No verification rows" />;

  const focusCell = (rowIndex: number, columnIndex: number): void => {
    const boundedRow = Math.max(0, Math.min(rows.length - 1, rowIndex));
    const boundedColumn = Math.max(0, Math.min(columns.length - 1, columnIndex));
    setFocus({ row: boundedRow, column: boundedColumn });
    virtualizer.scrollToIndex(boundedRow, { align: "auto" });
    queueMicrotask(() => cellRefs.current.get(`${boundedRow}:${boundedColumn}`)?.focus());
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-background text-foreground" aria-label="Requirement verification matrix">
      {message ? (
        <div className="flex items-center gap-2 border-b border-warning/40 bg-muted px-3 py-2 text-xs" role="status">
          <Icon aria-hidden="true" className="size-4 text-warning" name="AlertTriangle" />
          <span>{message} Accepted evidence remains visible.</span>
          <button className="ml-auto rounded px-2 py-1 font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRefresh} type="button">Retry</button>
        </div>
      ) : null}
      <MatrixFilters onChange={onFiltersChange} onRefresh={onRefresh} value={filters} />
      <div
        aria-busy={state === "loading"}
        aria-colcount={columns.length + 1}
        aria-rowcount={total + 1}
        className="min-h-0 flex-1 overflow-auto"
        ref={scrollRef}
        role="grid"
      >
        <div>
          <MatrixHeader columns={columns} rollup={rollup} />
          <div className="relative min-w-max" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  aria-rowindex={virtualRow.index + 2}
                  className="absolute left-0 top-0 grid w-full items-center gap-2 border-b border-border/60 px-3"
                  data-matrix-row={row.requirementId}
                  key={row.requirementId}
                  role="row"
                  style={{
                    gridTemplateColumns: `minmax(18rem, 1fr) repeat(${columns.length}, minmax(7rem, 0.62fr))`,
                    height: ROW_HEIGHT,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="min-w-72 pr-3" role="rowheader">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-xs font-semibold">{row.requirementId}</span>
                      {row.stale ? <Badge variant="outline"><Icon aria-hidden="true" className="size-3" name="RotateCcw" />Stale</Badge> : null}
                      {row.unknownCheckCount > 0 ? <Badge variant="destructive">TIER_UNKNOWN ×{row.unknownCheckCount}</Badge> : null}
                    </div>
                    <p className="mt-1 max-w-xl truncate text-sm text-muted-foreground" title={row.title}>{row.title}</p>
                  </div>
                  {columns.map((tier, columnIndex) => {
                    const key = `${virtualRow.index}:${columnIndex}`;
                    return (
                      <MatrixCell
                        cell={row.cells[tier]}
                        columnIndex={columnIndex}
                        key={tier}
                        onActivate={() => onOpenCell(row.requirementId, tier)}
                        onFocus={() => setFocus({ row: virtualRow.index, column: columnIndex })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") return;
                          const delta = event.key === "ArrowDown" ? [1, 0]
                            : event.key === "ArrowUp" ? [-1, 0]
                              : event.key === "ArrowRight" ? [0, 1]
                                : event.key === "ArrowLeft" ? [0, -1]
                                  : null;
                          if (!delta) return;
                          event.preventDefault();
                          focusCell(virtualRow.index + delta[0], columnIndex + delta[1]);
                        }}
                        register={(element) => {
                          if (element) cellRefs.current.set(key, element);
                          else cellRefs.current.delete(key);
                        }}
                        rowIndex={virtualRow.index}
                        tabIndex={focus.row === virtualRow.index && focus.column === columnIndex ? 0 : -1}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          {hasNextPage ? (
            <div className="flex justify-center p-3">
              <button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onLoadMore} type="button">Load more unproven requirements</button>
            </div>
          ) : null}
        </div>
      </div>
      <Legend />
    </section>
  );
}
