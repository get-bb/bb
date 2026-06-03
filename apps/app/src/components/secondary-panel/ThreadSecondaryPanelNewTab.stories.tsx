import { useMemo, useState, type ReactNode } from "react";
import type { ThreadType } from "@bb/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import type {
  AppSummary,
  ThreadStoragePathListResponse,
  WorkspacePathEntry,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { createAppQueryClient } from "@/lib/query-client";
import {
  appsQueryKey,
  projectPathsQueryKey,
  threadStoragePathsQueryKey,
} from "@/hooks/queries/query-keys";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import type { SecondaryPanelFileTab } from "./ThreadSecondaryPanel";
import { NewTabPage } from "./NewTabPage";
import type { FileSearchSelection } from "./useThreadFileTabs";
import {
  getThreadRecentItemsStorageKey,
  type ThreadRecentItem,
} from "./threadRecentItems";

export default {
  title: "secondary-panel/New tab",
};

const PROJECT_ID = "proj_bb";
const ENVIRONMENT_ID = "env_open_file_story";
const STORY_SOURCE_LIMIT = 40;
const BLANK_THREAD_ID = "";
const APPS_THREAD_ID = "thr_new_tab_apps_story";
const RECENTS_THREAD_ID = "thr_new_tab_recents_story";
const SEARCH_THREAD_ID = "thr_new_tab_search_story";

const noop = () => {};

const NEW_TAB: SecondaryPanelFileTab = {
  id: "new-tab",
  filename: "New tab",
  isActive: true,
  statusLabel: null,
  onSelect: noop,
  onClose: noop,
};

const WORKSPACE_PATH_RESULTS: WorkspacePathEntry[] = [
  {
    kind: "file",
    path: "apps/app/src/views/thread-detail/ThreadDetailView.tsx",
    name: "ThreadDetailView.tsx",
    score: 94,
    positions: [18, 19, 20, 21, 22, 23],
  },
  {
    kind: "file",
    path: "apps/app/src/components/secondary-panel/ThreadSecondaryPanel.tsx",
    name: "ThreadSecondaryPanel.tsx",
    score: 88,
    positions: [40, 41, 42, 43, 44, 45],
  },
  {
    kind: "file",
    path: "apps/app/src/components/secondary-panel/useThreadFileTabs.ts",
    name: "useThreadFileTabs.ts",
    score: 72,
    positions: [43, 44, 45, 46, 47, 48],
  },
];

const THREAD_STORAGE_PATH_RESULTS: WorkspacePathEntry[] = [
  {
    kind: "file",
    path: "notes/thread-handoff.md",
    name: "thread-handoff.md",
    score: 91,
    positions: [6, 7, 8, 9, 10, 11],
  },
  {
    kind: "file",
    path: "artifacts/thread-summary.json",
    name: "thread-summary.json",
    score: 83,
    positions: [10, 11, 12, 13, 14, 15],
  },
];

const APPS_RESPONSE: AppSummary[] = [
  {
    applicationId: "story-review-board",
    name: "Review Board",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
  },
];

const APPS_ROW_APPS: AppSummary[] = [
  {
    applicationId: "app_status",
    name: "Status",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
  },
  {
    applicationId: "app_workspace_map",
    name: "Workspace Map",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data"],
    icon: { kind: "builtin", name: "GridView" },
  },
  {
    applicationId: "app_release_notes",
    name: "Release Notes",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["message"],
    icon: { kind: "builtin", name: "File" },
  },
];

const RECENT_ROW_ITEMS: ThreadRecentItem[] = [
  {
    source: "thread-storage",
    path: "plans/story-launch-plan.md",
    openedAt: Date.now() - 2 * 60 * 1000,
  },
  {
    source: "thread-storage",
    path: "plans/story-dashboard-mockup.html",
    openedAt: Date.now() - 45 * 60 * 1000,
  },
  {
    source: "thread-storage",
    path: "reports/story-adoption-report.html",
    openedAt: Date.now() - 3 * 60 * 60 * 1000,
  },
  {
    source: "workspace",
    path: "apps/app/src/components/secondary-panel/story-source.tsx",
    openedAt: Date.now() - 25 * 60 * 60 * 1000,
  },
];

interface PanelStageProps {
  children: ReactNode;
}

interface NewTabPanelStoryProps {
  apps: readonly AppSummary[];
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
  initialQuery: string;
  projectId: string | undefined;
  recentItems: readonly ThreadRecentItem[];
  threadStoragePaths: readonly WorkspacePathEntry[];
  workspacePaths: readonly WorkspacePathEntry[];
}

interface StoryQueryClientArgs {
  apps: readonly AppSummary[];
  currentThreadId: string;
  initialQuery: string;
  projectId: string | undefined;
  threadStoragePaths: readonly WorkspacePathEntry[];
  workspacePaths: readonly WorkspacePathEntry[];
}

interface SeedThreadRecentItemsArgs {
  currentThreadId: string;
  recentItems: readonly ThreadRecentItem[];
}

interface SeededNewTabPageProps {
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
  initialQuery: string;
  onSelect: (selection: FileSearchSelection) => void;
  projectId: string | undefined;
  recentItems: readonly ThreadRecentItem[];
}

function PanelStage({ children }: PanelStageProps) {
  return (
    <div className="flex h-[380px] w-full max-w-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      {children}
    </div>
  );
}

function makeWorkspacePathResponse(
  paths: readonly WorkspacePathEntry[],
): WorkspacePathListResponse {
  return {
    paths: [...paths],
    truncated: false,
  };
}

function makeThreadStoragePathResponse(
  paths: readonly WorkspacePathEntry[],
): ThreadStoragePathListResponse {
  return {
    paths: [...paths],
    storageRootPath: "/Users/michael/.bb-dev/thread-storage/thr_demo",
    truncated: false,
  };
}

function seedThreadRecentItems({
  currentThreadId,
  recentItems,
}: SeedThreadRecentItemsArgs): void {
  if (typeof window === "undefined" || currentThreadId.length === 0) {
    return;
  }

  const storageKey = getThreadRecentItemsStorageKey({ threadId: currentThreadId });
  if (recentItems.length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(storageKey, JSON.stringify(recentItems));
}

function useStoryQueryClient({
  apps,
  currentThreadId,
  initialQuery,
  projectId,
  threadStoragePaths,
  workspacePaths,
}: StoryQueryClientArgs) {
  return useMemo(() => {
    const queryClient = createAppQueryClient({
      showMutationErrorToasts: false,
      defaultOptions: {
        mutations: {
          retry: false,
        },
        queries: {
          gcTime: Infinity,
          retry: false,
        },
      },
    });
    const query = initialQuery.trim();
    queryClient.setQueryData(
      projectPathsQueryKey(
        projectId,
        query,
        STORY_SOURCE_LIMIT,
        ENVIRONMENT_ID,
        true,
        false,
      ),
      makeWorkspacePathResponse(workspacePaths),
    );
    queryClient.setQueryData(appsQueryKey(), apps);
    queryClient.setQueryData(
      threadStoragePathsQueryKey(currentThreadId, {
        limit: STORY_SOURCE_LIMIT,
        query,
        includeFiles: true,
        includeDirectories: false,
      }),
      makeThreadStoragePathResponse(threadStoragePaths),
    );
    return queryClient;
  }, [
    apps,
    currentThreadId,
    initialQuery,
    projectId,
    threadStoragePaths,
    workspacePaths,
  ]);
}

function SeededNewTabPage({
  currentThreadId,
  currentThreadType,
  initialQuery,
  onSelect,
  projectId,
  recentItems,
}: SeededNewTabPageProps) {
  // Story-only: seed before NewTabPage mounts so atomWithStorage reads fixtures.
  seedThreadRecentItems({ currentThreadId, recentItems });

  return (
    <NewTabPage
      projectId={projectId}
      environmentId={ENVIRONMENT_ID}
      currentThreadId={currentThreadId}
      currentThreadType={currentThreadType}
      focusRequest={0}
      initialQuery={initialQuery}
      onSelect={onSelect}
    />
  );
}

function NewTabPanelStory({
  apps,
  currentThreadId,
  currentThreadType,
  initialQuery,
  projectId,
  recentItems,
  threadStoragePaths,
  workspacePaths,
}: NewTabPanelStoryProps) {
  const [selection, setSelection] = useState<FileSearchSelection | null>(null);
  const queryClient = useStoryQueryClient({
    apps,
    currentThreadId,
    initialQuery,
    projectId,
    threadStoragePaths,
    workspacePaths,
  });
  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      selection === null
        ? [NEW_TAB]
        : [
            {
              id:
                selection.source === "app"
                  ? `app:${selection.applicationId}`
                  : `${selection.source}:${selection.path}`,
              filename:
                selection.source === "app"
                  ? selection.applicationId
                  : (selection.path.split("/").at(-1) ?? selection.path),
              isActive: true,
              statusLabel: null,
              onSelect: noop,
              onClose: () => setSelection(null),
            },
          ],
    [selection],
  );
  const content =
    selection === null ? (
      <QueryClientProvider client={queryClient}>
        <SeededNewTabPage
          currentThreadId={currentThreadId}
          currentThreadType={currentThreadType}
          initialQuery={initialQuery}
          projectId={projectId}
          recentItems={recentItems}
          onSelect={setSelection}
        />
      </QueryClientProvider>
    ) : (
      <div className="flex min-h-full flex-col justify-center px-4 text-sm">
        <p className="font-medium text-foreground">
          Selected{" "}
          {selection.source === "app"
            ? "app"
            : selection.source === "workspace"
              ? "workspace file"
              : "thread storage file"}
        </p>
        <p className="pt-1 font-mono text-xs text-muted-foreground">
          {selection.source === "app"
            ? selection.applicationId
            : selection.path}
        </p>
      </div>
    );

  return (
    <PanelStage>
      <ThreadSecondaryPanel
        activePanel="thread-info"
        canUseGitUi
        defaultMergeBaseBranch="main"
        environmentId={ENVIRONMENT_ID}
        fileTabs={fileTabs}
        fileTabContent={content}
        isOpen
        metadataContent={null}
        onCollapse={noop}
        onClose={noop}
        onOpenNewTab={() => setSelection(null)}
        onPanelChange={noop}
        onPanelFocus={noop}
        isConversationCollapsed={false}
        onToggleConversationCollapse={noop}
        reserveLeftForDesktopTrafficLights={false}
        renderAsDrawer
        showGitDiffTab
      />
    </PanelStage>
  );
}

export function NewTab() {
  return (
    <StoryCard>
      <StoryRow
        label="blank state"
        hint="workspace-capable new tab before the user types"
      >
        <NewTabPanelStory
          apps={[]}
          currentThreadId={BLANK_THREAD_ID}
          currentThreadType="standard"
          initialQuery=""
          projectId={PROJECT_ID}
          recentItems={[]}
          threadStoragePaths={[]}
          workspacePaths={[]}
        />
      </StoryRow>
      <StoryRow
        label="apps"
        hint="app launcher results with built-in app icons and Create App"
      >
        <NewTabPanelStory
          apps={APPS_ROW_APPS}
          currentThreadId={APPS_THREAD_ID}
          currentThreadType="manager"
          initialQuery="s"
          projectId={PROJECT_ID}
          recentItems={[]}
          threadStoragePaths={[]}
          workspacePaths={[]}
        />
      </StoryRow>
      <StoryRow
        label="recents"
        hint="recent file rows across plan, mockup, report, and source kinds"
      >
        <NewTabPanelStory
          apps={[]}
          currentThreadId={RECENTS_THREAD_ID}
          currentThreadType="manager"
          initialQuery="story"
          projectId={PROJECT_ID}
          recentItems={RECENT_ROW_ITEMS}
          threadStoragePaths={[]}
          workspacePaths={[]}
        />
      </StoryRow>
      <StoryRow
        label="search results"
        hint="active New tab seeded with workspace and manager thread-storage matches"
      >
        <NewTabPanelStory
          apps={APPS_RESPONSE}
          currentThreadId={SEARCH_THREAD_ID}
          currentThreadType="manager"
          initialQuery="thread"
          projectId={PROJECT_ID}
          recentItems={[]}
          threadStoragePaths={THREAD_STORAGE_PATH_RESULTS}
          workspacePaths={WORKSPACE_PATH_RESULTS}
        />
      </StoryRow>
    </StoryCard>
  );
}
