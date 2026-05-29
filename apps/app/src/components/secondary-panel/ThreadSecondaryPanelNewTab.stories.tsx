import { useMemo, useState, type ReactNode } from "react";
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
  projectPathsQueryKey,
  threadAppsQueryKey,
  threadStoragePathsQueryKey,
} from "@/hooks/queries/query-keys";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import type { SecondaryPanelFileTab } from "./ThreadSecondaryPanel";
import { NewTabPage } from "./NewTabPage";
import type { FileSearchSelection } from "./useThreadFileTabs";

export default {
  title: "secondary-panel/New tab",
};

const PROJECT_ID = "proj_bb";
const THREAD_ID = "thr_manager_open_file_story";
const ENVIRONMENT_ID = "env_open_file_story";
const INITIAL_QUERY = "thread";
const STORY_SOURCE_LIMIT = 40;

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

const WORKSPACE_PATH_RESPONSE: WorkspacePathListResponse = {
  paths: WORKSPACE_PATH_RESULTS,
  truncated: false,
};

const THREAD_STORAGE_PATH_RESPONSE: ThreadStoragePathListResponse = {
  paths: THREAD_STORAGE_PATH_RESULTS,
  storageRootPath: "/Users/michael/.bb-dev/thread-storage/thr_demo",
  truncated: false,
};

const THREAD_APPS_RESPONSE: AppSummary[] = [
  {
    id: "status",
    name: "Status",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data", "message"],
    icon: { kind: "builtin", name: "ListTodo" },
  },
];

interface PanelStageProps {
  children: ReactNode;
}

function PanelStage({ children }: PanelStageProps) {
  return (
    <div className="flex h-[380px] w-full max-w-[720px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      {children}
    </div>
  );
}

function useStoryQueryClient() {
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
    queryClient.setQueryData(
      projectPathsQueryKey(
        PROJECT_ID,
        INITIAL_QUERY,
        STORY_SOURCE_LIMIT,
        ENVIRONMENT_ID,
        true,
        false,
      ),
      WORKSPACE_PATH_RESPONSE,
    );
    queryClient.setQueryData(
      threadAppsQueryKey(THREAD_ID),
      THREAD_APPS_RESPONSE,
    );
    queryClient.setQueryData(
      threadStoragePathsQueryKey(THREAD_ID, {
        limit: STORY_SOURCE_LIMIT,
        query: INITIAL_QUERY,
        includeFiles: true,
        includeDirectories: false,
      }),
      THREAD_STORAGE_PATH_RESPONSE,
    );
    return queryClient;
  }, []);
}

function NewTabPanelStory() {
  const [selection, setSelection] = useState<FileSearchSelection | null>(null);
  const queryClient = useStoryQueryClient();
  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      selection === null
        ? [NEW_TAB]
        : [
            {
              id:
                selection.source === "app"
                  ? `app:${selection.appId}`
                  : `${selection.source}:${selection.path}`,
              filename:
                selection.source === "app"
                  ? selection.appId
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
        <NewTabPage
          projectId={PROJECT_ID}
          environmentId={ENVIRONMENT_ID}
          currentThreadId={THREAD_ID}
          currentThreadType="manager"
          focusRequest={0}
          initialQuery={INITIAL_QUERY}
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
          {selection.source === "app" ? selection.appId : selection.path}
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
        label="transient tab"
        hint="active New tab seeded with workspace and manager thread-storage matches"
      >
        <NewTabPanelStory />
      </StoryRow>
    </StoryCard>
  );
}
