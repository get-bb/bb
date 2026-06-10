import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
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
import {
  appsQueryKey,
  sidebarNavigationQueryKey,
} from "@/hooks/queries/query-keys";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "Sidebar/Overview",
};

interface SidebarFrameProps {
  children: ReactNode;
}

const noop = () => {};
const EMPTY_APPS: readonly [] = [];
const SIDEBAR_NAVIGATION_STORY_QUERY_KEY = sidebarNavigationQueryKey();
const APPS_STORY_QUERY_KEY = appsQueryKey();

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

function SidebarFrame({ children }: SidebarFrameProps) {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <div className="flex h-[680px] w-full max-w-[320px] min-w-0 flex-col overflow-hidden rounded-md border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-sm">
          <div className="shrink-0 px-2 py-2">
            <ProjectListActionButtons
              onNewChat={noop}
              onOpenAutomations={noop}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
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
    queryClient.setQueryData(APPS_STORY_QUERY_KEY, EMPTY_APPS);
    setIsSeeded(true);

    return () => {
      queryClient.removeQueries({
        queryKey: SIDEBAR_NAVIGATION_STORY_QUERY_KEY,
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: APPS_STORY_QUERY_KEY,
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
    </StoryCard>
  );
}
