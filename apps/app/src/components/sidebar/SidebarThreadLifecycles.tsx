import { useId, type ComponentProps, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import {
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { SidebarHeaderControls } from "./SidebarHeaderControls";
import { ProjectThreadTree } from "./ProjectRow";
import { sidebarThreadLifecyclesAtom } from "./sidebarCollapsedAtoms";

function LifecycleGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-2">
      <div className="flex items-center pl-2.5">
        <h2
          id={headingId}
          className="min-w-0 flex-1 py-2 text-xs font-medium text-subtle-foreground"
        >
          {label}
        </h2>
        <SidebarHeaderControls label={label} showNewThread={false} />
      </div>
      {children}
    </section>
  );
}

export function SidebarThreadLifecycles({
  children,
  drafts,
  status,
  treeProps,
}: {
  children: ReactNode;
  drafts: ThreadListEntry[];
  status: ConnectionAwareQueryStatus;
  treeProps: Omit<
    ComponentProps<typeof ProjectThreadTree>,
    "threadListState" | "variant" | "progressiveDisclosureEnabled"
  >;
}) {
  const lifecycles = useAtomValue(sidebarThreadLifecyclesAtom);
  const archived = useArchivedThreads(
    {},
    { enabled: lifecycles.includes("archived") },
  );
  const archivedState = useConnectionAwareQueryState({
    hasResolvedData: archived.data !== undefined,
    isFetching: archived.isFetching,
    isLoadingError: archived.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(archived.error),
  });
  return (
    <>
      {lifecycles.includes("active") && children}
      {lifecycles.includes("draft") && (
        <LifecycleGroup label="Drafts">
          <ProjectThreadTree
            {...treeProps}
            variant="section"
            progressiveDisclosureEnabled={false}
            threadListState={
              status === "ready" ? { status, threads: drafts } : { status }
            }
          />
        </LifecycleGroup>
      )}
      {lifecycles.includes("archived") && (
        <LifecycleGroup label="Archived">
          <ProjectThreadTree
            {...treeProps}
            variant="section"
            progressiveDisclosureEnabled={false}
            threadListState={
              archivedState.status === "ready"
                ? {
                    status: "ready",
                    threads: archived.data?.pages.flat() ?? [],
                  }
                : { status: archivedState.status }
            }
          />
          {archived.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              disabled={archived.isFetchingNextPage}
              onClick={() => void archived.fetchNextPage()}
              aria-label="Load more archived threads"
            >
              {archived.isFetchingNextPage
                ? "Loading…"
                : archived.isFetchNextPageError
                  ? "Retry loading"
                  : "Show more"}
            </Button>
          )}
        </LifecycleGroup>
      )}
    </>
  );
}
