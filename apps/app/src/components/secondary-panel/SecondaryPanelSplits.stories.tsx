import { useMemo, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { WorkspaceFile } from "@bb/server-contract";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { WithDesktopBrowser } from "../../../.ladle/story-desktop";
import { DetailCard } from "@/components/ui/detail-card.js";
import {
  environmentFilePreviewQueryKey,
  environmentPathsQueryKey,
  terminalsQueryKey,
  threadStoragePathsQueryKey,
} from "@/hooks/queries/query-keys";
import {
  createNewTabFixedPanelTab,
  createTerminalFixedPanelTab,
  type BrowserFixedPanelTab,
  type SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { SplitPreviewProvider } from "@/lib/define-split";
import { createAppQueryClient } from "@/lib/query-client";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import {
  LazyBrowserTabDeck,
  LazyHostFilePreviewTabContent,
  LazyHostScopedFilePreviewTabContent,
  LazyNewTabPage,
  LazyProjectFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyThreadStorageFileTree,
  LazyThreadTerminalPanel,
  LazyWorkspaceFilePreviewTabContent,
} from "./lazySecondaryPanelComponents";
import { ThreadStorageRow } from "./ThreadMetadataContent";
import {
  ThreadSecondaryPanel,
  type SecondaryPanelRenderableTab,
} from "./ThreadSecondaryPanel";
import { useThreadStorageBrowser } from "./useThreadStorageBrowser";

export default { title: "performance/Secondary panel splits" };

const THREAD_ID = "thr_split_review";
const ENVIRONMENT_ID = "env_split_review";
const TERMINAL_ID = "term_split_review";
const PREVIEW_PATH = "docs/split-review.md";
const PREVIEW_SOURCE = { kind: "working-tree" } as const;
const noop = () => {};

type ReviewState = "loading" | "error" | "live";

function Review({
  ids,
  children,
}: {
  ids: readonly string[];
  children: ReactNode;
}) {
  const [state, setState] = useState<ReviewState>("loading");
  const content =
    state === "live"
      ? children
      : ids.reduce<ReactNode>(
          (inner, id) => (
            <SplitPreviewProvider
              id={id}
              state={state}
              onRetry={() => setState("live")}
            >
              {inner}
            </SplitPreviewProvider>
          ),
          children,
        );
  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setState("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setState("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setState("live")}>
          Release to real UI
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {ids.join(", ")}: {state}
      </p>
      {content}
    </div>
  );
}

function PanelShell({
  activeTab,
  label,
  icon,
  content,
  contentFillsRegion = false,
  renderBrowserDeck,
}: {
  activeTab: SecondaryFileFixedPanelTab;
  label: string;
  icon: "Globe" | "NewTab" | "Terminal" | "FileText";
  content: ReactNode;
  contentFillsRegion?: boolean;
  renderBrowserDeck?: (activeBrowserTabId: string | null) => ReactNode;
}) {
  const renderAsDrawer = useIsCompactViewport();
  const panelTab: SecondaryPanelRenderableTab = {
    contentFillsRegion,
    label,
    leadingVisual: <Icon name={icon} className="size-3.5" aria-hidden />,
    onClose: noop,
    onSelect: noop,
    renderContent: () => content,
    statusLabel: null,
    tab: activeTab,
  };
  const panel = (
    <ThreadSecondaryPanel
      activeTab={activeTab}
      canUseGitUi={false}
      requestedMergeBaseBranch="main"
      environmentId={ENVIRONMENT_ID}
      tabs={[panelTab]}
      fixedTabs={[]}
      renderBrowserDeck={renderBrowserDeck}
      isOpen
      metadataContent={null}
      onCollapse={noop}
      onClose={noop}
      onTabReorder={noop}
      onOpenNewTab={noop}
      onPanelFocus={noop}
      isConversationCollapsed={false}
      onToggleConversationCollapse={noop}
      renderAsDrawer={renderAsDrawer}
      inlinePanelToggle="hidden"
      showConversationCollapseControl={false}
    />
  );
  return (
    <div
      className={`@container flex h-[520px] w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background ${
        renderAsDrawer ? "max-w-[640px]" : "max-w-[1040px]"
      }`}
    >
      {renderAsDrawer ? (
        panel
      ) : (
        <PanelGroup direction="horizontal">
          <Panel order={1} minSize={20}>
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Conversation
            </div>
          </Panel>
          {panel}
        </PanelGroup>
      )}
    </div>
  );
}

function useSeededQueryClient() {
  return useMemo(() => {
    const queryClient = createAppQueryClient({
      showMutationErrorToasts: false,
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
      },
    });
    queryClient.setQueryData(
      terminalsQueryKey({ kind: "thread", threadId: THREAD_ID }),
      {
        sessions: [
          makeTerminalSession({
            id: TERMINAL_ID,
            threadId: THREAD_ID,
            environmentId: ENVIRONMENT_ID,
            status: "starting",
            title: "Terminal 1",
          }),
        ],
      },
    );
    queryClient.setQueryData(
      environmentPathsQueryKey(ENVIRONMENT_ID, "", 40, true, false),
      { paths: [], truncated: false },
    );
    queryClient.setQueryData(
      threadStoragePathsQueryKey(THREAD_ID, {
        limit: 40,
        query: "",
        includeFiles: true,
        includeDirectories: false,
      }),
      { paths: [], storageRootPath: "/tmp/thread-storage", truncated: false },
    );
    queryClient.setQueryData(
      environmentFilePreviewQueryKey(
        ENVIRONMENT_ID,
        PREVIEW_PATH,
        PREVIEW_SOURCE,
      ),
      {
        kind: "text",
        content:
          "# Split review\n\nThe real file preview is loaded.\n\n- Loading stays inside the tab\n- Tabs and panel controls stay live",
        mimeType: "text/markdown",
        name: "split-review.md",
        path: PREVIEW_PATH,
        url: `/story/${PREVIEW_PATH}`,
      },
    );
    return queryClient;
  }, []);
}

function Seeded({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={useSeededQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}

export function Terminal() {
  return (
    <Seeded>
      <Review ids={[LazyThreadTerminalPanel.id]}>
        <PanelShell
          activeTab={createTerminalFixedPanelTab({ terminalId: TERMINAL_ID })}
          label="Terminal 1"
          icon="Terminal"
          contentFillsRegion
          content={
            <LazyThreadTerminalPanel
              canCreateTerminal={false}
              isPanelOpen
              isPanelPersistedOpen
              syncThreadId={THREAD_ID}
              target={{ kind: "thread", threadId: THREAD_ID }}
              terminalId={TERMINAL_ID}
            />
          }
        />
      </Review>
    </Seeded>
  );
}

export function NewTab() {
  return (
    <Seeded>
      <Review ids={[LazyNewTabPage.id]}>
        <PanelShell
          activeTab={createNewTabFixedPanelTab()}
          label="New tab"
          icon="NewTab"
          content={
            <LazyNewTabPage
              autoFocus={false}
              currentThreadId={THREAD_ID}
              environmentId={ENVIRONMENT_ID}
              onAutoFocusHandled={noop}
              onOpenBrowser={noop}
              onSelect={noop}
              onStartTerminal={noop}
              projectId="proj_split_review"
            />
          }
        />
      </Review>
    </Seeded>
  );
}

export function FilePreviewTab() {
  return (
    <Seeded>
      <Review
        ids={[
          LazyWorkspaceFilePreviewTabContent.id,
          LazyHostFilePreviewTabContent.id,
          LazyHostScopedFilePreviewTabContent.id,
          LazyProjectFilePreviewTabContent.id,
          LazyThreadStorageFilePreviewTabContent.id,
        ]}
      >
        <PanelShell
          activeTab={{
            environmentId: ENVIRONMENT_ID,
            id: `workspace:${PREVIEW_PATH}`,
            kind: "workspace-file-preview",
            lineRange: null,
            path: PREVIEW_PATH,
            projectId: null,
            source: PREVIEW_SOURCE,
            statusLabel: null,
          }}
          label="split-review.md"
          icon="FileText"
          content={
            <LazyWorkspaceFilePreviewTabContent
              activePath={PREVIEW_PATH}
              environmentId={ENVIRONMENT_ID}
              isPanelOpen
              lineRange={null}
              source={PREVIEW_SOURCE}
              statusLabel={null}
              threadId={THREAD_ID}
            />
          }
        />
      </Review>
    </Seeded>
  );
}

const BROWSER_TAB: BrowserFixedPanelTab = {
  environmentId: null,
  id: "browser:split-review",
  kind: "browser",
  title: null,
  url: "",
};

export function BrowserTab() {
  return (
    <WithDesktopBrowser>
      <Review ids={[LazyBrowserTabDeck.id]}>
        <PanelShell
          activeTab={BROWSER_TAB}
          label="Browser"
          icon="Globe"
          content={null}
          renderBrowserDeck={(activeBrowserTabId) => (
            <LazyBrowserTabDeck
              activeBrowserTabId={activeBrowserTabId}
              browserTabs={[BROWSER_TAB]}
              canShowNativeBrowserView
              environmentId={null}
              onUpdate={noop}
              threadId={THREAD_ID}
            />
          )}
        />
      </Review>
    </WithDesktopBrowser>
  );
}

const STORAGE_FILES: WorkspaceFile[] = [
  { path: "notes/current-work.md", name: "current-work.md" },
  { path: "plans/kickoff.md", name: "kickoff.md" },
  { path: "reports/status.md", name: "status.md" },
];

function StorageRow() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const controller = useThreadStorageBrowser({
    files: STORAGE_FILES,
    onSelectPath: setSelectedPath,
    selectedPath,
  });
  return (
    <ThreadStorageRow
      controller={controller}
      filesError={null}
      isFilesLoading={false}
    />
  );
}

export function ThreadStorageTree() {
  return (
    <Review ids={[LazyThreadStorageFileTree.id]}>
      <div className="flex h-[360px] w-full max-w-[460px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background px-4 py-3">
        <DetailCard className="h-full min-h-0 flex-1 rounded-none border-0 bg-transparent px-0 py-0">
          <StorageRow />
        </DetailCard>
      </div>
    </Review>
  );
}
