import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  SidebarBootstrapResponse,
  ThreadSearchResponse,
} from "@bb/server-contract";
import {
  BRANCH_NAMES,
  makeProject,
  makeThreadListEntry,
} from "../../../.ladle/story-fixtures";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { Icon } from "@/components/ui/icon.js";
import {
  ProjectList,
  ProjectListActionButtons,
  ProjectListNavigationLoadingState,
  ProjectListShell,
} from "./ProjectList";
import { SidebarThreadSearchPanel } from "./SidebarThreadSearchPanel";
import type { SidebarThreadSearchNavigationItem } from "./sidebarThreadSearch";
import {
  sidebarNavigationQueryKey,
  threadSearchQueryKey,
} from "@/hooks/queries/query-keys";
import { THREAD_SEARCH_LIMIT_PER_GROUP } from "@/hooks/queries/thread-queries";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "Sidebar/Overview",
};

interface SidebarFrameProps {
  children: ReactNode;
}

const noop = () => {};
const SIDEBAR_NAVIGATION_STORY_QUERY_KEY = sidebarNavigationQueryKey();

const bbProject = makeProject({
  id: "proj_story_bb",
  name: "bb",
});
const docsProject = makeProject({
  id: "proj_story_docs",
  name: "docs-app",
});
const personalProject = makeProject({
  id: PERSONAL_PROJECT_ID,
  kind: "personal",
  name: "Personal",
});

const loadedSidebarNavigation = {
  personalProject: {
    ...personalProject,
    defaultExecutionOptions: null,
    threads: [
      makeThreadListEntry({
        id: "thr_story_personal",
        projectId: PERSONAL_PROJECT_ID,
        title: "Sketch launch checklist",
        titleFallback: "Sketch launch checklist",
        latestAttentionAt: 85,
        createdAt: 85,
        updatedAt: 85,
      }),
      // A projectless parent + delegated child: exercises depth-0 alignment
      // with the project headers and the indent guide under an expanded
      // projectless thread.
      makeThreadListEntry({
        id: "thr_story_personal_parent",
        projectId: PERSONAL_PROJECT_ID,
        title: "Investigate flaky timeline test",
        titleFallback: "Investigate flaky timeline test",
        latestAttentionAt: 80,
        createdAt: 80,
        updatedAt: 80,
      }),
      makeThreadListEntry({
        id: "thr_story_personal_child",
        projectId: PERSONAL_PROJECT_ID,
        parentThreadId: "thr_story_personal_parent",
        title: "Add Mutex to Watcher",
        titleFallback: "Add Mutex to Watcher",
        latestAttentionAt: 75,
        createdAt: 75,
        updatedAt: 75,
      }),
    ],
  },
  projects: [
    {
      ...bbProject,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_story_pinned",
          projectId: bbProject.id,
          title: "Improve sidebar loading state",
          titleFallback: "Improve sidebar loading state",
          pinnedAt: 200,
          pinSortKey: "0001",
          latestAttentionAt: 200,
          createdAt: 200,
          updatedAt: 200,
        }),
        makeThreadListEntry({
          id: "thr_story_pinned_child",
          projectId: bbProject.id,
          parentThreadId: "thr_story_pinned",
          title: "Verify Ladle coverage",
          titleFallback: "Verify Ladle coverage",
          latestAttentionAt: 190,
          createdAt: 190,
          updatedAt: 190,
        }),
        makeThreadListEntry({
          id: "thr_story_active",
          projectId: bbProject.id,
          title: "Ship realtime sidebar updates",
          titleFallback: "Ship realtime sidebar updates",
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
          latestAttentionAt: 180,
          createdAt: 180,
          updatedAt: 180,
        }),
        // A delegated parent → child pair: renders at project depth 1/2 with
        // the disclosure chevron after the parent title and the indent guide
        // running under the expanded child.
        makeThreadListEntry({
          id: "thr_story_ancestor",
          projectId: bbProject.id,
          title: "Rework the command palette",
          titleFallback: "Rework the command palette",
          latestAttentionAt: 176,
          createdAt: 176,
          updatedAt: 176,
        }),
        makeThreadListEntry({
          id: "thr_story_ancestor_child",
          projectId: bbProject.id,
          parentThreadId: "thr_story_ancestor",
          title: "Wire async command loading",
          titleFallback: "Wire async command loading",
          latestAttentionAt: 175,
          createdAt: 175,
          updatedAt: 175,
        }),
        makeThreadListEntry({
          id: "thr_story_worktree_a",
          projectId: bbProject.id,
          environmentId: "env_story_sidebar",
          environmentName: "Sidebar polish",
          environmentBranchName: BRANCH_NAMES.feature,
          environmentWorkspaceDisplayKind: "managed-worktree",
          title: "Tighten loading skeleton",
          titleFallback: "Tighten loading skeleton",
          latestAttentionAt: 170,
          createdAt: 170,
          updatedAt: 170,
        }),
        makeThreadListEntry({
          id: "thr_story_worktree_b",
          projectId: bbProject.id,
          environmentId: "env_story_sidebar",
          environmentName: "Sidebar polish",
          environmentBranchName: BRANCH_NAMES.feature,
          environmentWorkspaceDisplayKind: "managed-worktree",
          title: "Audit sidebar stories",
          titleFallback: "Audit sidebar stories",
          hasPendingInteraction: true,
          latestAttentionAt: 160,
          createdAt: 160,
          updatedAt: 160,
        }),
      ],
    },
    {
      ...docsProject,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_story_docs",
          projectId: docsProject.id,
          title: "Refresh onboarding docs",
          titleFallback: "Refresh onboarding docs",
          latestAttentionAt: 120,
          createdAt: 120,
          updatedAt: 120,
        }),
      ],
    },
  ],
} satisfies SidebarBootstrapResponse;

const searchResponse = {
  active: {
    total: 2,
    results: [
      {
        thread: makeThreadListEntry({
          id: "thr_story_search_active",
          projectId: bbProject.id,
          title: "Search result handoff",
          titleFallback: "Search result handoff",
          environmentName: "Sidebar polish",
          environmentBranchName: BRANCH_NAMES.feature,
          environmentWorkspaceDisplayKind: "managed-worktree",
        }),
        matches: [
          {
            sourceKind: "user_message",
            text: "needle appears in the original request",
            highlightRanges: [{ start: 0, end: 6 }],
          },
        ],
      },
      {
        thread: makeThreadListEntry({
          id: "thr_story_search_pending",
          projectId: docsProject.id,
          title: "Needle follow-up",
          titleFallback: "Needle follow-up",
          hasPendingInteraction: true,
        }),
        matches: [
          {
            sourceKind: "title",
            text: "Needle follow-up",
            highlightRanges: [{ start: 0, end: 6 }],
          },
        ],
      },
    ],
  },
  archived: {
    total: 1,
    results: [
      {
        thread: makeThreadListEntry({
          archivedAt: 220,
          id: "thr_story_search_archived",
          projectId: bbProject.id,
          title: "Archived needle investigation",
          titleFallback: "Archived needle investigation",
        }),
        matches: [
          {
            sourceKind: "assistant_message",
            text: "The archived thread contains the matching needle.",
            highlightRanges: [{ start: 42, end: 48 }],
          },
        ],
      },
    ],
  },
} satisfies ThreadSearchResponse;

const searchProjectNamesById = new Map([
  [bbProject.id, bbProject.name],
  [docsProject.id, docsProject.name],
  [PERSONAL_PROJECT_ID, personalProject.name],
]);

function SidebarFrame({ children }: SidebarFrameProps) {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="flex h-[680px] w-full max-w-[320px] min-w-0 flex-col overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
          <div className="shrink-0 px-2 py-2">
            <ProjectListActionButtons onNewChat={noop} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          <div className="shrink-0 border-t border-sidebar-border/70 px-2 py-2">
            <button
              type="button"
              aria-label="Settings"
              title="Settings"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
            >
              <Icon name="Settings" className="size-4" />
            </button>
          </div>
        </div>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

function LoadingSidebar() {
  return (
    <ProjectListShell>
      <ProjectListNavigationLoadingState />
    </ProjectListShell>
  );
}

function LoadedSidebar() {
  const queryClient = useQueryClient();
  const [isSeeded, setIsSeeded] = useState(false);

  useEffect(() => {
    queryClient.setQueryData(
      SIDEBAR_NAVIGATION_STORY_QUERY_KEY,
      loadedSidebarNavigation,
    );
    setIsSeeded(true);

    return () => {
      queryClient.removeQueries({
        queryKey: SIDEBAR_NAVIGATION_STORY_QUERY_KEY,
        exact: true,
      });
    };
  }, [queryClient]);

  if (!isSeeded) {
    return <LoadingSidebar />;
  }

  return (
    <Suspense fallback={<LoadingSidebar />}>
      <ProjectList onNewProject={noop} onProjectSelect={noop} />
    </Suspense>
  );
}

function SearchSidebar() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isSeeded, setIsSeeded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [navigationItems, setNavigationItems] = useState<
    readonly SidebarThreadSearchNavigationItem[]
  >([]);

  useEffect(() => {
    queryClient.setQueryData(
      threadSearchQueryKey({
        limitPerGroup: THREAD_SEARCH_LIMIT_PER_GROUP,
        query: "needle",
      }),
      searchResponse,
    );
    setIsSeeded(true);

    return () => {
      queryClient.removeQueries({
        queryKey: threadSearchQueryKey({
          limitPerGroup: THREAD_SEARCH_LIMIT_PER_GROUP,
          query: "needle",
        }),
        exact: true,
      });
    };
  }, [queryClient]);

  if (!isSeeded) {
    return <LoadingSidebar />;
  }

  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="flex h-[680px] w-full max-w-[320px] min-w-0 flex-col overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
          <div className="shrink-0 px-2 py-2">
            <ProjectListActionButtons
              onNewChat={noop}
              threadSearch={{
                activeDescendantId: navigationItems[activeIndex]?.optionId,
                inputRef,
                isActive: true,
                onActivate: noop,
                onClose: noop,
                onQueryChange: noop,
                query: "needle",
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ProjectListShell>
              <SidebarThreadSearchPanel
                activeIndex={activeIndex}
                isRecentsLoading={false}
                onActiveIndexChange={setActiveIndex}
                onNavigationItemsChange={setNavigationItems}
                onSelect={noop}
                projectNamesById={searchProjectNamesById}
                query="needle"
                recentThreads={[]}
              />
            </ProjectListShell>
          </div>
          <div className="shrink-0 border-t border-sidebar-border/70 px-2 py-2">
            <button
              type="button"
              aria-label="App settings"
              title="App settings"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2"
            >
              <Icon name="Settings" className="size-4" />
            </button>
          </div>
        </div>
        <span className="sr-only">{navigationItems.length} search rows</span>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

export function Overview() {
  return (
    <StoryCard labelWidth="120px">
      <StoryRow label="loading">
        <SidebarFrame>
          <LoadingSidebar />
        </SidebarFrame>
      </StoryRow>
      <StoryRow label="loaded">
        <SidebarFrame>
          <LoadedSidebar />
        </SidebarFrame>
      </StoryRow>
      <StoryRow label="search">
        <SearchSidebar />
      </StoryRow>
    </StoryCard>
  );
}
