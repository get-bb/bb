import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { RequirementCard } from "./RequirementCard.js";
import type { RequirementCardModel } from "./schema.js";

export type RequirementListState = "unconfigured" | "loading" | "ready" | "error";

export interface RequirementListProps {
  state: RequirementListState;
  models: readonly RequirementCardModel[];
  projectVersionId?: string | null;
  message?: string | null;
  hasNextPage?: boolean;
  onLoadMore?(): void;
  onRefresh?(): void;
}

function CenteredState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-80 items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-6 text-center text-card-foreground">
        <p className="text-base font-medium">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

export function RequirementList({
  state,
  models,
  projectVersionId = null,
  message,
  hasNextPage = false,
  onLoadMore,
  onRefresh,
}: RequirementListProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return models;
    return models.filter(({ requirement }) =>
      [requirement.id, requirement.ears.text, requirement.req_type, requirement.priority, requirement.ears.pattern]
        .some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [filter, models]);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 310,
    overscan: 4,
    initialRect: { width: 960, height: 720 },
  });

  if (state === "unconfigured") {
    return <CenteredState detail="Choose a project before reading tracked requirement YAML or its accepted evidence cache." title="Choose a project" />;
  }
  if (state === "loading" && models.length === 0) {
    return (
      <div aria-label="Loading requirements" className="space-y-4 p-5" role="status">
        {[0, 1, 2].map((key) => <div className="h-56 w-full animate-pulse rounded-md bg-muted" key={key} />)}
        <span className="sr-only">Loading requirement cards</span>
      </div>
    );
  }
  if (state === "error" && models.length === 0) {
    return (
      <CenteredState
        action={onRefresh ? <button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={onRefresh} type="button">Retry local read</button> : null}
        detail={message ?? "The tracked requirement directory and accepted cache could not be read."}
        title="Requirements unavailable"
      />
    );
  }
  if (state === "ready" && models.length === 0) {
    return (
      <CenteredState
        action={onRefresh ? <button className="h-9 rounded-md bg-foreground px-4 text-sm font-medium text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={onRefresh} type="button">Check for local YAML</button> : null}
        detail="Create a strict fs-requirement/v1 file under product-security/requirements, pull from Sync, or ask the agent to draft one for human review."
        title="No requirements yet"
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {message ? (
        <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground" role="status">
          {message} Cached cards remain available.
          {onRefresh ? <button className="ml-auto h-8 rounded-md px-3 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={onRefresh} type="button">Refresh</button> : null}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-3 border-b border-border p-3">
        <label className="sr-only" htmlFor="requirement-filter">Filter requirements</label>
        <div className="relative max-w-md flex-1">
          <input className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" id="requirement-filter" onChange={(event) => setFilter(event.target.value)} placeholder="Filter id, EARS text, type, priority…" value={filter} />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} loaded</span>
        {onRefresh ? (
          <button
            className="h-8 rounded-md border border-input px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={onRefresh}
            type="button"
          >
            Refresh requirements
          </button>
        ) : null}
      </div>
      <div
        aria-busy={state === "loading"}
        aria-label="Requirement cards"
        className="min-h-0 flex-1 overflow-auto p-4"
        ref={scrollRef}
        role="feed"
      >
        <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const model = filtered[virtualRow.index];
            if (!model) return null;
            return (
              <div
                className="absolute left-0 top-0 w-full pb-4"
                data-index={virtualRow.index}
                data-virtual-row
                key={model.requirement.id}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <RequirementCard
                  id={model.requirement.id}
                  initialModel={model}
                  positionInSet={virtualRow.index + 1}
                  projectVersionId={projectVersionId}
                  setSize={filtered.length}
                />
              </div>
            );
          })}
        </div>
        {hasNextPage ? (
          <div className="flex justify-center py-3">
            <button className="h-9 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={onLoadMore} type="button">Load next page</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
