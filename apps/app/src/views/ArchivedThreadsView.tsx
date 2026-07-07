import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAtomValue } from "jotai";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { PageShell } from "@/components/ui/page-shell.js";
import { Pill } from "@bb/shared-ui/pill";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import { useUnarchiveThread } from "@/hooks/mutations/thread-state-mutations";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  sidebarOrganizationModeAtom,
  type SidebarOrganizationMode,
} from "@/components/sidebar/sidebarCollapsedAtoms";

type ArchivedThreadPillLabel = "child";

export interface ArchivedThreadViewFilters {
  folderId?: string;
  projectId?: string;
  unfiled?: true;
}

export function buildArchivedThreadViewFilters({
  folderId,
  projectId,
  sidebarOrganizationMode,
}: {
  folderId: string | undefined;
  projectId: string | undefined;
  sidebarOrganizationMode: SidebarOrganizationMode;
}): ArchivedThreadViewFilters {
  const isGlobalFoldersMode =
    projectId === PERSONAL_PROJECT_ID &&
    sidebarOrganizationMode === "chronological";
  const archivedProjectId =
    folderId || isGlobalFoldersMode ? undefined : projectId;
  return {
    projectId: archivedProjectId,
    ...(folderId ? { folderId } : {}),
    ...(!folderId && isGlobalFoldersMode ? { unfiled: true as const } : {}),
  };
}

function getArchivedThreadPillLabel(
  thread: ThreadListEntry,
): ArchivedThreadPillLabel | null {
  if (thread.parentThreadId !== null) return "child";
  return null;
}

// One archived-threads page for every scope. The route + `?folder=` param
// decide which threads are listed; the scope is shown in the AppLayout header
// breadcrumb (project name / "Threads" / folder), so the body stays identical:
//   - project:        all archived threads in a project
//   - personal/loose: archived threads not filed under any folder (unfiled)
//   - folder:         archived threads filed directly under one folder
export function ArchivedThreadsView() {
  const { projectId } = useRouteState();
  const [searchParams] = useSearchParams();
  const sidebarOrganizationMode = useAtomValue(sidebarOrganizationModeAtom);
  const folderId = searchParams.get("folderId") ?? undefined;
  const archivedThreadsQuery = useArchivedThreads(
    buildArchivedThreadViewFilters({
      folderId,
      projectId,
      sidebarOrganizationMode,
    }),
  );
  const unarchiveThread = useUnarchiveThread();

  const archivedThreads = useMemo(() => {
    const pages = archivedThreadsQuery.data?.pages ?? [];
    // Hide threads optimistically updated to archivedAt: null while the
    // archived list refetches.
    return pages.flat().filter((thread) => thread.archivedAt != null);
  }, [archivedThreadsQuery.data]);

  if (!projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Project not found
        </p>
      </PageShell>
    );
  }

  const isInitialLoading = archivedThreadsQuery.isPending;
  const showEmptyState = !isInitialLoading && archivedThreads.length === 0;

  return (
    <PageShell contentClassName="pt-0">
      <div className="mx-auto w-full max-w-3xl">
        <div className="space-y-3 pt-4 md:pt-5">
          {isInitialLoading ? (
            <p className="text-sm text-muted-foreground">
              Loading archived threads…
            </p>
          ) : showEmptyState ? (
            <EmptyStatePanel className="py-4 text-left">
              No archived threads yet.
            </EmptyStatePanel>
          ) : (
            <div className="space-y-1">
              {archivedThreads.map((thread) => {
                const pillLabel = getArchivedThreadPillLabel(thread);
                return (
                  <div
                    key={thread.id}
                    className="group flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-state-hover"
                  >
                    <Link
                      to={getThreadRoutePath({
                        projectId: thread.projectId,
                        threadId: thread.id,
                      })}
                      className="min-w-0 flex-1"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">
                          {getThreadDisplayTitle(thread)}
                        </span>
                        {pillLabel ? (
                          <Pill variant="outline" className="shrink-0">
                            {pillLabel}
                          </Pill>
                        ) : null}
                      </span>
                    </Link>
                    <ThreadUnarchiveButton
                      isPending={
                        unarchiveThread.isPending &&
                        unarchiveThread.variables?.id === thread.id
                      }
                      onUnarchive={() => {
                        unarchiveThread.mutate({ id: thread.id });
                      }}
                      className="hover:bg-accent-foreground/15"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {archivedThreadsQuery.hasNextPage ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                archivedThreadsQuery.fetchNextPage();
              }}
              disabled={archivedThreadsQuery.isFetchingNextPage}
              className="h-9 w-full justify-center rounded-md px-3 text-sm font-normal text-muted-foreground"
            >
              {archivedThreadsQuery.isFetchingNextPage
                ? "Loading…"
                : "Load more"}
            </Button>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
