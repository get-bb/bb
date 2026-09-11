import { useMemo } from "react";
import { Button } from "@bb/shared-ui/button";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import { ThreadRow } from "./ThreadRow";

export function ArchivedRows({
  selectedThreadId,
  onNavigate,
}: {
  selectedThreadId?: string;
  onNavigate?: () => void;
}) {
  const query = useArchivedThreads({});
  const threads = useMemo(
    () => [
      ...new Map(
        (query.data?.pages.flat() ?? [])
          .filter((thread) => thread.archivedAt !== null)
          .map((thread) => [thread.id, thread]),
      ).values(),
    ],
    [query.data],
  );

  return (
    <TopLevelSidebarSection label="Archived" sectionId="archived">
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          projectId={thread.projectId}
          thread={thread}
          crossProjectId={null}
          isActive={selectedThreadId === thread.id}
          hasComposerDraft={false}
          onProjectSelect={onNavigate}
          options={{ kind: "default", depth: 0, isCompact: false }}
        />
      ))}
      {query.isPending ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          Loading archived threads…
        </p>
      ) : null}
      {query.isError ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          <span>Archived threads could not load.</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!query.isPending && !query.isError && threads.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          No archived threads.
        </p>
      ) : null}
      {query.hasNextPage ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-full justify-start px-2 text-xs font-normal text-muted-foreground"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more archived threads"}
        </Button>
      ) : null}
    </TopLevelSidebarSection>
  );
}
