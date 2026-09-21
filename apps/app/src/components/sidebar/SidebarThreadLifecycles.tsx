import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import type { ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { normalizeThreadLifecycleFilter } from "@/lib/thread-lifecycle-filter";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import {
  useConnectionAwareQueryState,
} from "@/hooks/queries/connection-aware-query-state";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { ProjectThreadTree } from "./ProjectRow";
import { sidebarThreadLifecyclesAtom } from "./sidebarCollapsedAtoms";

export function useSidebarThreadLifecycles(
  unarchivedThreads: ThreadListEntry[],
) {
  const savedValue = useAtomValue(sidebarThreadLifecyclesAtom);
  const value = useMemo(() => normalizeThreadLifecycleFilter(savedValue), [savedValue]);
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
        if (thread.archivedAt !== null) selected.set(thread.id, thread);
      }
    }
    if (value.includes("active")) {
      for (const thread of unarchivedThreads) {
        if (thread.archivedAt === null) selected.set(thread.id, thread);
      }
    }
    return [...selected.values()];
  }, [archived.data, unarchivedThreads, value]);
  return {
    value,
    threads,
    archived,
    archivedStatus: archivedState.status,
  };
}

export function SidebarThreadLifecycles({
  children,
  lifecycles,
  treeProps,
}: {
  children: ReactNode;
  lifecycles: ReturnType<typeof useSidebarThreadLifecycles>;
  treeProps: Omit<
    ComponentProps<typeof ProjectThreadTree>,
    "threadListState" | "variant" | "progressiveDisclosureEnabled"
  >;
}) {
  const { value, archived, archivedStatus } = lifecycles;
  return (
    <>
      {children}
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
