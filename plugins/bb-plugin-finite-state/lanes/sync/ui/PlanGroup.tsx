import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@bb/shared-ui/badge";
import { Button } from "@bb/shared-ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@bb/shared-ui/collapsible";
import { Icon } from "@bb/shared-ui/icon";
import type { ConflictChoice } from "./ConflictResolution.js";
import {
  PlanRow,
  planItemId,
  type PlanRowResolutionState,
  type SyncPlanItem,
  type SyncPlanOperation,
} from "./PlanRow.js";

const VIRTUALIZATION_THRESHOLD = 100;

const GROUP_LABELS: Readonly<Record<SyncPlanOperation, string>> = {
  create: "Creates",
  update: "Updates",
  delete: "Deletes",
  conflict: "Conflicts",
  orphan: "Orphans",
  noop: "No changes",
};

export interface PlanGroupProps {
  operation: SyncPlanOperation;
  items: readonly SyncPlanItem[];
  authorizationAvailable: boolean;
  resolutionState: Readonly<Record<string, PlanRowResolutionState>>;
  onResolve(
    item: SyncPlanItem,
    field: string,
    resolution: ConflictChoice,
  ): Promise<void>;
}

export function PlanGroup({
  operation,
  items,
  authorizationAvailable,
  resolutionState,
  onResolve,
}: PlanGroupProps): React.JSX.Element {
  const [open, setOpen] = useState(operation !== "noop");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualized = items.length >= VIRTUALIZATION_THRESHOLD;
  // TanStack Virtual intentionally owns mutable measurement functions. React
  // Compiler skips this component while the list still receives real windowing.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: virtualized && open ? items.length : 0,
    estimateSize: () => 64,
    getScrollElement: () => scrollRef.current,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [expanded, open, virtualizer]);

  const toggleRow = (id: string, next: boolean) => {
    setExpanded((current) => {
      const updated = new Set(current);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  };

  const row = (item: SyncPlanItem) => {
    const id = planItemId(item);
    return (
      <PlanRow
        authorizationAvailable={authorizationAvailable}
        expanded={expanded.has(id)}
        item={item}
        key={id}
        onExpandedChange={(next) => toggleRow(id, next)}
        onResolve={onResolve}
        resolutionState={
          resolutionState[id] ?? {
            submittingField: null,
            errorField: null,
            error: null,
          }
        }
      />
    );
  };

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <section aria-labelledby={`plan-group-${operation}`} data-plan-group={operation}>
        <CollapsibleTrigger asChild>
          <Button
            className="flex h-11 w-full justify-start rounded-none border-b border-border bg-muted/40 px-3 hover:bg-muted"
            variant="ghost"
          >
            <Icon
              aria-hidden="true"
              className="size-3.5"
              name={open ? "ChevronDown" : "ChevronRight"}
            />
            <span className="font-semibold" id={`plan-group-${operation}`}>
              {GROUP_LABELS[operation]}
            </span>
            <Badge className="ml-1 font-mono tabular-nums" variant="secondary">
              {items.length}
            </Badge>
            {virtualized ? (
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                Windowed list
              </span>
            ) : null}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {items.length === 0 ? (
            <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
              No {GROUP_LABELS[operation].toLocaleLowerCase()} in this plan.
            </p>
          ) : virtualized ? (
            <div
              aria-label={`${GROUP_LABELS[operation]} plan items`}
              className="max-h-[32rem] overflow-auto overscroll-contain"
              ref={scrollRef}
              role="list"
            >
              <div
                className="relative w-full"
                style={{ height: `${virtualizer.getTotalSize()}px` }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const item = items[virtualItem.index];
                  if (!item) return null;
                  return (
                    <div
                      data-index={virtualItem.index}
                      key={planItemId(item)}
                      ref={virtualizer.measureElement}
                      role="listitem"
                      style={{
                        left: 0,
                        position: "absolute",
                        top: 0,
                        transform: `translateY(${virtualItem.start}px)`,
                        width: "100%",
                      }}
                    >
                      {row(item)}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div role="list">
              {items.map((item) => (
                <div key={planItemId(item)} role="listitem">
                  {row(item)}
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}
