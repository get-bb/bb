import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { findingAge, type FindingRow } from "./columns.js";
import type { FindingSelection } from "./route.js";

const COLUMN_WIDTHS: Record<string, string> = {
  state: "minmax(92px,.7fr)", severity: "92px", cve: "minmax(128px,1fr)", component: "minmax(190px,1.7fr)",
  reachability: "minmax(116px,.9fr)", kev: "76px", epss: "76px", triage: "minmax(120px,1fr)", age: "72px",
};

function selected(selection: FindingSelection, key: string): boolean {
  return selection.mode === "explicit" ? selection.keys.has(key) : !selection.excluded.has(key);
}

function severityClass(severity: string | null): string {
  if (severity === "critical") return "text-destructive";
  if (severity === "high") return "text-warning";
  if (severity === "medium") return "text-primary";
  return "text-muted-foreground";
}

const LOCAL_PRESENTATION: Record<FindingRow["localState"], { icon: IconName; label: string; className: string }> = {
  none: { icon: "Circle", label: "None", className: "text-muted-foreground" },
  local: { icon: "Edit", label: "Local", className: "text-primary" },
  conflicted: { icon: "AlertTriangle", label: "Conflicted", className: "text-destructive" },
  stale: { icon: "Clock", label: "Stale", className: "text-warning" },
  needs_completion: { icon: "CircleQuestion", label: "Needs completion", className: "text-warning" },
};

function editingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function FindingsTable({ rows, total, selection, cursorKey, columns, loadingMore, hasNextPage, onSelection, onOpen, onCursor, onNearEnd }: {
  rows: readonly FindingRow[];
  total: number;
  selection: FindingSelection;
  cursorKey: string | null;
  columns: readonly string[];
  loadingMore: boolean;
  hasNextPage: boolean;
  onSelection(key: string, selected: boolean, shift: boolean, anchorKey: string | null): void;
  onOpen(key: string): void;
  onCursor(key: string): void;
  onNearEnd(): void;
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const shiftRef = useRef(false);
  const anchorRef = useRef<string | null>(cursorKey);
  const [activeKey, setActiveKey] = useState(cursorKey ?? rows[0]?.stableKey ?? null);
  const visible = new Set(columns);
  const gridColumns = ["32px", ...columns.flatMap(column => COLUMN_WIDTHS[column] ? [COLUMN_WIDTHS[column]] : [])].join(" ");
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 10,
    initialRect: { width: 1200, height: 720 },
    getItemKey: index => rows[index]?.stableKey ?? index,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const finalIndex = virtualRows.at(-1)?.index ?? 0;
  useEffect(() => { if (rows.length > 0 && finalIndex >= rows.length - 20) onNearEnd(); }, [finalIndex, onNearEnd, rows.length]);

  function focusIndex(index: number): void {
    const bounded = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[bounded];
    if (!row) return;
    setActiveKey(row.stableKey);
    anchorRef.current = row.stableKey;
    onCursor(row.stableKey);
    virtualizer.scrollToIndex(bounded, { align: "auto" });
    window.requestAnimationFrame(() => rowRefs.current.get(row.stableKey)?.focus());
  }

  return (
    <div aria-busy={loadingMore} aria-label="Findings table" aria-rowcount={total + 1} className="min-h-0 flex-1 overflow-auto bg-background" ref={scrollRef} role="grid">
      <div className="sticky top-0 z-10 grid h-9 min-w-max items-center border-b border-border bg-card px-2 text-xs font-medium text-muted-foreground" role="row" style={{ gridTemplateColumns: gridColumns }}>
        <div aria-label="Selection" role="columnheader" />
        {visible.has("state") ? <div role="columnheader">Local state</div> : null}
        {visible.has("severity") ? <div role="columnheader">Severity</div> : null}
        {visible.has("cve") ? <div role="columnheader">CVE</div> : null}
        {visible.has("component") ? <div role="columnheader">Component / version</div> : null}
        {visible.has("reachability") ? <div role="columnheader">Reachability</div> : null}
        {visible.has("kev") ? <div role="columnheader">KEV</div> : null}
        {visible.has("epss") ? <div className="text-right" role="columnheader">EPSS</div> : null}
        {visible.has("triage") ? <div role="columnheader">Triage</div> : null}
        {visible.has("age") ? <div className="text-right" role="columnheader">Age</div> : null}
      </div>
      <div className="relative min-w-max" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualRows.map(virtualRow => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const local = LOCAL_PRESENTATION[row.localState];
          const isSelected = selected(selection, row.stableKey);
          return (
            <div
              aria-rowindex={virtualRow.index + 2}
              aria-selected={isSelected}
              className="absolute left-0 top-0 grid h-11 min-w-max items-center border-b border-border/60 px-2 text-xs text-foreground hover:bg-muted/60 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              data-finding-row
              data-index={virtualRow.index}
              key={row.stableKey}
              onDoubleClick={() => onOpen(row.stableKey)}
              onFocus={() => { setActiveKey(row.stableKey); anchorRef.current = row.stableKey; onCursor(row.stableKey); }}
              onKeyDown={event => {
                if (editingTarget(event.target)) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const next = event.key === "ArrowDown" ? virtualRow.index + 1 : event.key === "ArrowUp" ? virtualRow.index - 1 : event.key === "Home" ? 0 : rows.length - 1;
                  focusIndex(next);
                } else if (event.key === "Enter") { event.preventDefault(); onOpen(row.stableKey); }
                else if (event.key === " ") { event.preventDefault(); onSelection(row.stableKey, !isSelected, event.shiftKey, anchorRef.current); }
              }}
              ref={element => { if (element) rowRefs.current.set(row.stableKey, element); else rowRefs.current.delete(row.stableKey); virtualizer.measureElement(element); }}
              role="row"
              style={{ gridTemplateColumns: gridColumns, transform: `translateY(${virtualRow.start}px)`, width: "100%" }}
              tabIndex={activeKey === row.stableKey ? 0 : -1}
            >
              <div role="gridcell"><Checkbox aria-label={`Select ${row.cve ?? row.stableKey}`} checked={isSelected} onCheckedChange={checked => onSelection(row.stableKey, checked === true, shiftRef.current, anchorRef.current)} onClick={event => { shiftRef.current = event.shiftKey; event.stopPropagation(); }} /></div>
              {visible.has("state") ? <div className={`flex min-w-0 items-center gap-1.5 ${local.className}`} role="gridcell"><Icon aria-hidden="true" className="size-3.5 shrink-0" name={local.icon} /><span className="truncate">{local.label}</span><span className="sr-only">Local state: {local.label}</span></div> : null}
              {visible.has("severity") ? <div className={`font-semibold capitalize ${severityClass(row.severity)}`} role="gridcell">{row.severity ?? "Unknown"}</div> : null}
              {visible.has("cve") ? <button className="min-w-0 truncate text-left font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(row.stableKey)} role="gridcell" type="button">{row.cve ?? row.findingId}</button> : null}
              {visible.has("component") ? <div className="min-w-0" role="gridcell"><div className="truncate font-medium">{row.componentName ?? row.title ?? "Unknown component"}</div><div className="truncate font-mono text-muted-foreground">{row.componentVersion ?? "version unknown"}</div></div> : null}
              {visible.has("reachability") ? <div className="flex items-center gap-1.5 capitalize" role="gridcell"><Icon aria-hidden="true" className="size-3.5 text-muted-foreground" name="Target" />{row.reachability ?? "unknown"}</div> : null}
              {visible.has("kev") ? <div role="gridcell">{row.inKev || row.inVcKev ? <Badge aria-label={row.inKev ? "CISA Known Exploited Vulnerability" : "VulnCheck Known Exploited Vulnerability"} variant="destructive">{row.inKev ? "KEV" : "VC KEV"}</Badge> : <span className="text-muted-foreground">—</span>}</div> : null}
              {visible.has("epss") ? <div className="text-right font-mono tabular-nums" role="gridcell">{row.epss === null ? "—" : `${(row.epss * 100).toFixed(row.epss >= .1 ? 0 : 1)}%`}</div> : null}
              {visible.has("triage") ? <div className="truncate capitalize" role="gridcell">{(row.triage ?? "Untriaged").replaceAll("_", " ")}</div> : null}
              {visible.has("age") ? <div className="text-right tabular-nums text-muted-foreground" role="gridcell">{findingAge(row.firstSeen)}</div> : null}
            </div>
          );
        })}
      </div>
      {hasNextPage ? <div className="flex justify-center border-t border-border py-2"><Button disabled={loadingMore} onClick={onNearEnd} size="sm" variant="outline">Load next page</Button></div> : null}
      {loadingMore ? <div className="sticky bottom-0 border-t border-border bg-card px-4 py-2 text-center text-xs text-muted-foreground" role="status">Loading next cursor page…</div> : null}
    </div>
  );
}
