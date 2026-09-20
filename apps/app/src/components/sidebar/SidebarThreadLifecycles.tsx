import { useId, useMemo, type ComponentProps, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Separator } from "@bb/shared-ui/separator";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import {
  useConnectionAwareQueryState,
  type ConnectionAwareQueryStatus,
} from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { SidebarHeaderControls } from "./SidebarHeaderControls";
import { ProjectThreadTree } from "./ProjectRow";
import { sidebarThreadLifecyclesAtom } from "./sidebarCollapsedAtoms";

export function useSidebarThreadLifecycles(
  unarchivedThreads: ThreadListEntry[],
) {
  const value = useAtomValue(sidebarThreadLifecyclesAtom);
  const archived = useArchivedThreads(
    {},
    { enabled: value.includes("archived") },
  );
  const archivedState = useConnectionAwareQueryState({
    hasResolvedData: archived.data !== undefined,
    isFetching: archived.isFetching,
    isLoadingError: archived.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(archived.error),
  });
  const threads = useMemo(() => {
    const selected = new Map<string, ThreadListEntry>();
    if (value.includes("archived")) {
      for (const thread of archived.data?.pages.flat() ?? []) {
        if (thread.lifecycle === "archived") selected.set(thread.id, thread);
      }
    }
    if (value.includes("active")) {
      for (const thread of unarchivedThreads) {
        if (thread.lifecycle === "active") selected.set(thread.id, thread);
      }
    }
    return [...selected.values()];
  }, [archived.data, unarchivedThreads, value]);
  const drafts = useMemo(
    () => unarchivedThreads.filter((thread) => thread.lifecycle === "draft"),
    [unarchivedThreads],
  );
  return {
    value,
    threads,
    drafts,
    archived,
    archivedStatus: archivedState.status,
  };
}

export function SidebarThreadLifecycles({
  children,
  lifecycles,
  status,
  treeProps,
}: {
  children: ReactNode;
  lifecycles: ReturnType<typeof useSidebarThreadLifecycles>;
  status: ConnectionAwareQueryStatus;
  treeProps: Omit<
    ComponentProps<typeof ProjectThreadTree>,
    "threadListState" | "variant" | "progressiveDisclosureEnabled"
  >;
}) {
  const { value, drafts, archived, archivedStatus } = lifecycles;
  const headingId = useId();
  const showHierarchy =
    value.includes("active") || value.includes("archived");
  return (
    <>
      {value.includes("draft") && (
        <section aria-labelledby={headingId}>
          <div className="flex items-center pl-2.5">
            <h2
              id={headingId}
              className="flex min-w-0 flex-1 items-center gap-2 py-2 text-xs font-medium text-subtle-foreground"
            >
              <Icon name="Edit" className="size-4" />
              Drafts
            </h2>
            <SidebarHeaderControls label="Drafts" showNewThread={false} />
          </div>
          <ProjectThreadTree
            {...treeProps}
            variant="section"
            progressiveDisclosureEnabled={false}
            threadListState={
              status === "ready" ? { status, threads: drafts } : { status }
            }
          />
        </section>
      )}
      {value.includes("draft") && showHierarchy && (
        <Separator decorative={false} className="my-2" />
      )}
      {showHierarchy && children}
      {value.includes("archived") && (
        <>
          {value.includes("active") && archivedStatus !== "ready" && (
            <ProjectThreadTree
              {...treeProps}
              variant="section"
              progressiveDisclosureEnabled={false}
              threadListState={{ status: archivedStatus }}
            />
          )}
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
        </>
      )}
    </>
  );
}
