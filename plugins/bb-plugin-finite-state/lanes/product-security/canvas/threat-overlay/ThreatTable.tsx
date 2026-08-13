import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@bb/shared-ui/badge";
import { Icon } from "@bb/shared-ui/icon";
import type {
  StrideSegment,
  ThreatSummary,
} from "./aggregate.js";

const ROW_HEIGHT = 58;
const OVERSCAN = 5;

interface ThreatTableProps {
  threats: readonly ThreatSummary[];
  labels: Record<StrideSegment, string>;
  selectedThreatSlug: string | null;
  filterTargetSlug: string | null;
  onClearFilter(): void;
  onSelectThreat(threat: ThreatSummary): void;
}

function categoryLabel(
  threat: ThreatSummary,
  labels: Record<StrideSegment, string>,
): string {
  return threat.category === "other" ? "Other" : labels[threat.category];
}

export function ThreatTable({
  threats,
  labels,
  selectedThreatSlug,
  filterTargetSlug,
  onClearFilter,
  onSelectThreat,
}: ThreatTableProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleThreats = useMemo(
    () =>
      filterTargetSlug
        ? threats.filter((threat) =>
            threat.targetSlugs.includes(filterTargetSlug),
          )
        : threats,
    [filterTargetSlug, threats],
  );
  const virtualizer = useVirtualizer({
    count: visibleThreats.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => visibleThreats[index]?.slug ?? index,
    initialRect: { width: 720, height: 174 },
    overscan: OVERSCAN,
  });
  const rows = virtualizer.getVirtualItems();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {filterTargetSlug ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-3 py-1.5 text-xs">
          <Icon aria-hidden="true" className="size-3.5" name="Target" />
          <span className="min-w-0 truncate">
            Filtered to {filterTargetSlug} · {visibleThreats.length} threats
          </span>
          <button
            className="ml-auto rounded px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClearFilter}
            type="button"
          >
            Clear
          </button>
        </div>
      ) : null}
      <div
        aria-label="Threats"
        aria-rowcount={visibleThreats.length}
        className="flex min-h-0 flex-1 flex-col"
        role="grid"
      >
        <div
          className="grid grid-cols-[minmax(8rem,1fr)_minmax(4rem,auto)_minmax(3.5rem,auto)_2.5rem] items-center gap-2 border-b border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
          role="row"
        >
          <span role="columnheader">Threat</span>
          <span role="columnheader">Category</span>
          <span role="columnheader">Severity</span>
          <span role="columnheader">Paths</span>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto"
          data-threat-scroll=""
          ref={scrollRef}
        >
          {visibleThreats.length === 0 ? (
            <div className="flex h-full min-h-24 items-center justify-center px-4 text-sm text-muted-foreground">
              {filterTargetSlug
                ? `No threats target ${filterTargetSlug}.`
                : "No open threats are present in the accepted model."}
            </div>
          ) : (
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {rows.map((virtualRow) => {
                const threat = visibleThreats[virtualRow.index];
                if (!threat) return null;
                const selected = threat.slug === selectedThreatSlug;
                const displayCategory = categoryLabel(threat, labels);
                return (
                  <div
                    aria-rowindex={virtualRow.index + 1}
                    aria-selected={selected}
                    className={`absolute left-1 right-1 top-0 grid min-h-13 grid-cols-[minmax(8rem,1fr)_minmax(4rem,auto)_minmax(3.5rem,auto)_2.5rem] items-center gap-2 rounded-md border px-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-transparent hover:border-border hover:bg-muted"
                    }`}
                    data-index={virtualRow.index}
                    data-threat-row={threat.slug}
                    key={threat.slug}
                    onClick={() => onSelectThreat(threat)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSelectThreat(threat);
                    }}
                    role="row"
                    style={{
                      transform: `translateY(${virtualRow.start + 2}px)`,
                    }}
                    tabIndex={0}
                  >
                    <span className="min-w-0" role="gridcell">
                      <span className="block truncate text-sm font-medium">
                        {threat.title}
                      </span>
                      <span className="block truncate font-mono text-muted-foreground">
                        {threat.slug}
                      </span>
                    </span>
                    <span className="min-w-0" role="gridcell">
                      <Badge
                        className="block max-w-full truncate"
                        title={displayCategory}
                        variant="outline"
                      >
                        {displayCategory}
                      </Badge>
                    </span>
                    <span
                      className="capitalize text-muted-foreground"
                      role="gridcell"
                    >
                      {threat.severity ?? "Unrated"}
                    </span>
                    <span
                      className="inline-flex items-center gap-1 tabular-nums text-muted-foreground"
                      role="gridcell"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-3.5"
                        name="GitBranch"
                      />
                      {threat.attackPathCount}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
