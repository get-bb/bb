import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@bb/shared-ui/card";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { sdk } from "@/lib/sdk";
import { isDesktopBrowserAvailable } from "@/lib/bb-desktop";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { useHostDirectory, usePrimaryHost } from "@/hooks/queries/host-queries";
import { joinHostPath } from "@/components/dialogs/RemotePathBrowser";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import { FilePreview } from "@/components/secondary-panel/FilePreview";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import type { SecondaryPanelFileTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import {
  useCloseFixedSecondaryPanel,
  useFixedPanelTabsState,
  useFixedPanelTabsStorageMaintenance,
  useTouchFixedPanelTabsState,
} from "@/lib/fixed-panel-tabs";
import {
  buildFilePreviewUrl,
  parseTriageBoardFiles,
  TRIAGE_BOARD_FILE_QUERY,
  type TriageBoardFile,
} from "@/lib/dashboard-triage-boards";
import {
  ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS,
  RootComposeSecondaryContent,
} from "./RootComposeSecondaryContent";
import { RootComposeRightPanelToggle } from "./RootComposeView";

const DASHBOARD_PANEL_STATE_ID = "dashboard";
const DASHBOARD_BROWSER_OWNER_ID = "dashboard-browser";
const TRIAGE_BOARD_PREVIEW_TTL_MS = 3_600_000;

function formatBoardDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function getTriageBoardDirectory(homeDirectory: string): string {
  return joinHostPath(
    joinHostPath(joinHostPath(homeDirectory, "src"), "obsidian"),
    "AI",
  );
}

export function DashboardView() {
  const primaryHost = usePrimaryHost();
  const homeDirectoryQuery = useHostDirectory(primaryHost?.id ?? null, null);
  const triageBoardDirectory = homeDirectoryQuery.data
    ? getTriageBoardDirectory(homeDirectoryQuery.data.directory)
    : null;
  const triageBoardsQuery = useQuery({
    queryKey: [
      "dashboard",
      "triage-boards",
      primaryHost?.id,
      triageBoardDirectory,
    ],
    queryFn:
      primaryHost && triageBoardDirectory
        ? async ({ signal }) =>
            parseTriageBoardFiles(
              (
                await sdk.files.list({
                  hostId: primaryHost.id,
                  path: triageBoardDirectory,
                  query: TRIAGE_BOARD_FILE_QUERY,
                  limit: 100,
                  signal,
                })
              ).files,
            )
        : skipToken,
    staleTime: 30_000,
  });

  useFixedPanelTabsStorageMaintenance(DASHBOARD_PANEL_STATE_ID);
  const fixedPanelTabsState = useFixedPanelTabsState(
    DASHBOARD_PANEL_STATE_ID,
    null,
  );
  const closeSecondaryPanel = useCloseFixedSecondaryPanel(
    DASHBOARD_PANEL_STATE_ID,
    null,
  );
  const touchFixedPanelTabsState = useTouchFixedPanelTabsState(
    DASHBOARD_PANEL_STATE_ID,
    null,
  );
  const {
    activateTab,
    activeBrowserTab,
    browserTabs,
    closeTab,
    openTab,
    reorderFileTab,
    updateBrowserTab,
  } = useThreadFileTabs({
    panelStateId: DASHBOARD_PANEL_STATE_ID,
    syncThreadId: null,
    environmentId: null,
    fileOwnerThreadId: null,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const isSecondaryPanelOpen = fixedPanelTabsState.secondary.isOpen;

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedBoardName = searchParams.get("board");
  const [selectedBoardName, setSelectedBoardName] = useState<string | null>(
    requestedBoardName,
  );
  const boards = useMemo(
    () => triageBoardsQuery.data ?? [],
    [triageBoardsQuery.data],
  );
  const selectedBoard =
    boards.find(
      (board) => board.name === (requestedBoardName ?? selectedBoardName),
    ) ??
    boards[0] ??
    null;
  const selectedBoardIndex = selectedBoard
    ? boards.findIndex((board) => board.path === selectedBoard.path)
    : -1;

  const setRequestedBoard = useCallback(
    (boardName: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (boardName === null) next.delete("board");
          else next.set("board", boardName);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const lastPreviewRequestRef = useRef<string | null>(null);
  const previewMutation = useMutation({
    mutationFn: async (board: TriageBoardFile) => {
      if (!primaryHost || !triageBoardDirectory) {
        throw new Error("Primary machine is unavailable.");
      }
      const preview = await sdk.files.createPreview({
        hostId: primaryHost.id,
        rootPath: triageBoardDirectory,
        ttlMs: TRIAGE_BOARD_PREVIEW_TTL_MS,
      });
      return {
        board,
        url: buildFilePreviewUrl({
          baseUrl: preview.baseUrl,
          filePath: board.path,
          origin: window.location.origin,
        }),
      };
    },
    onSuccess: ({ board, url }) => {
      if (lastPreviewRequestRef.current !== board.name) return;
      for (const tab of browserTabs) closeTab(tab.id);
      const tab = openTab({ kind: "browser", url });
      if (tab?.kind === "browser") {
        updateBrowserTab({
          tabId: tab.id,
          title: formatBoardDate(board.date),
          url,
        });
      }
    },
  });
  const openPreview = previewMutation.mutate;

  // Preview leases live only in server memory. Re-open requested boards from
  // their durable file identity instead of restoring an expired preview URL.
  useEffect(() => {
    if (!requestedBoardName) return;
    const board = boards.find(
      (candidate) => candidate.name === requestedBoardName,
    );
    if (!board || lastPreviewRequestRef.current === board.name) return;
    lastPreviewRequestRef.current = board.name;
    openPreview(board, {
      onError: () => {
        lastPreviewRequestRef.current = null;
      },
    });
  }, [boards, openPreview, requestedBoardName]);

  const resetPersistedPreviewRef = useRef(false);
  useEffect(() => {
    if (resetPersistedPreviewRef.current) return;
    resetPersistedPreviewRef.current = true;
    for (const tab of browserTabs) closeTab(tab.id);
    closeSecondaryPanel();
  }, [browserTabs, closeSecondaryPanel, closeTab]);

  const handleClosePreview = useCallback(() => {
    closeSecondaryPanel();
    setRequestedBoard(null);
  }, [closeSecondaryPanel, setRequestedBoard]);
  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTab(tabId);
      setRequestedBoard(null);
    },
    [closeTab, setRequestedBoard],
  );
  const handleSelectBoard = useCallback(
    (board: TriageBoardFile) => {
      setSelectedBoardName(board.name);
      if (requestedBoardName !== null || isSecondaryPanelOpen) {
        setRequestedBoard(board.name);
      }
    },
    [isSecondaryPanelOpen, requestedBoardName, setRequestedBoard],
  );
  const handleOpenSelectedBoard = useCallback(() => {
    if (!selectedBoard) return;
    if (requestedBoardName === selectedBoard.name) {
      lastPreviewRequestRef.current = selectedBoard.name;
      openPreview(selectedBoard, {
        onError: () => {
          lastPreviewRequestRef.current = null;
        },
      });
      return;
    }
    setRequestedBoard(selectedBoard.name);
  }, [openPreview, requestedBoardName, selectedBoard, setRequestedBoard]);

  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      browserTabs.map((tab) => ({
        id: tab.id,
        filename: tab.title ?? "Triage board",
        isActive: tab.id === activeBrowserTab?.id,
        leadingVisual: (
          <Icon
            name="Globe"
            className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        ),
        statusLabel: null,
        onSelect: () => activateTab(tab.id),
        onClose: () => handleCloseTab(tab.id),
      })),
    [activateTab, activeBrowserTab?.id, browserTabs, handleCloseTab],
  );
  const renderBrowserDeck = useCallback(
    ({ canShowNativeBrowserView }: { canShowNativeBrowserView: boolean }) => {
      if (!activeBrowserTab) return null;
      if (!isDesktopBrowserAvailable()) {
        return (
          <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
            <FilePreview
              path={activeBrowserTab.title ?? "Triage board"}
              headerMode="none"
              state={{
                kind: "iframe",
                sandbox: "allow-scripts",
                title: activeBrowserTab.title ?? "Triage board",
                url: activeBrowserTab.url,
              }}
            />
          </div>
        );
      }
      return (
        <BrowserTabDeck
          browserTabs={browserTabs}
          activeBrowserTabId={activeBrowserTab.id}
          environmentId={null}
          canShowNativeBrowserView={canShowNativeBrowserView}
          threadId={DASHBOARD_BROWSER_OWNER_ID}
          onUpdate={updateBrowserTab}
        />
      );
    },
    [activeBrowserTab, browserTabs, updateBrowserTab],
  );

  const panelToggle =
    !isSecondaryPanelOpen && selectedBoard ? (
      <div
        className={`fixed z-40 ${ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS}`}
      >
        <RootComposeRightPanelToggle
          isOpen={false}
          onToggle={() => {
            if (selectedBoard) handleOpenSelectedBoard();
          }}
        />
      </div>
    ) : null;

  return (
    <>
      {panelToggle}
      <RootComposeSecondaryContent
        contentKey="dashboard"
        contentClassName="pt-8 md:pt-10"
        contentMaxWidthClassName="max-w-[960px]"
        isSecondaryPanelOpen={isSecondaryPanelOpen}
        onToggleSecondaryPanel={handleClosePreview}
        panelTogglePositionClassName={
          ROOT_COMPOSE_PINNED_PANEL_TOGGLE_POSITION_CLASS
        }
        renderWindowDragStrip={false}
        showPluginHomepageSections={false}
        secondaryPanel={{
          activeTab: activeBrowserTab,
          canUseGitUi: false,
          metadataContent: (
            <EmptyStatePanel className="m-4">
              Select a triage board to open it here.
            </EmptyStatePanel>
          ),
          fileTabs,
          renderBrowserDeck,
          isBrowserTabActive: activeBrowserTab !== null,
          isOpen: isSecondaryPanelOpen,
          showConversationCollapseControl: false,
          showGitDiffTab: false,
          showInfoTab: false,
          showNewTabButton: false,
          onClose: handleClosePreview,
          onCollapse: handleClosePreview,
          onFileTabReorder: reorderFileTab,
          onOpenNewTab: handleOpenSelectedBoard,
          onPanelFocus: touchFixedPanelTabsState,
          onPanelChange: () => undefined,
        }}
      >
        <div className="space-y-6">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-subtle-foreground">
              Saved outputs
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Durable views generated by your recurring workflows.
            </p>
          </div>

          <Card className="overflow-hidden">
            <CardHeader className="gap-3 border-b border-border/70 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon name="ListTodo" className="size-4" aria-hidden />
                    </span>
                    Triage boards
                  </CardTitle>
                  <CardDescription>
                    Daily priority snapshots from <code>/triage-board</code>.
                  </CardDescription>
                </div>
                {boards.length > 0 ? (
                  <span className="rounded-full border border-border px-2 py-1 text-xs tabular-nums text-muted-foreground">
                    {boards.length} saved
                  </span>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {triageBoardsQuery.isLoading || homeDirectoryQuery.isLoading ? (
                <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Spinner" className="size-4 animate-spin" />
                  Loading boards
                </div>
              ) : triageBoardsQuery.isError || homeDirectoryQuery.isError ? (
                <EmptyStatePanel className="m-5 min-h-40 content-center">
                  Could not read triage boards from primary machine.
                </EmptyStatePanel>
              ) : selectedBoard ? (
                <div className="grid min-h-56 md:grid-cols-[minmax(0,1fr)_auto]">
                  <button
                    type="button"
                    className="group flex min-w-0 flex-col items-start justify-between gap-8 p-6 text-left outline-none transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={handleOpenSelectedBoard}
                  >
                    <div className="space-y-2">
                      <p className="text-xs font-medium tabular-nums text-subtle-foreground">
                        {selectedBoardIndex + 1} / {boards.length}
                      </p>
                      <p className="text-xl font-medium tracking-tight">
                        {formatBoardDate(selectedBoard.date)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Open saved interactive board in right browser.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      {previewMutation.isPending
                        ? "Opening"
                        : requestedBoardName === selectedBoard.name &&
                            isSecondaryPanelOpen
                          ? "Refresh in browser"
                          : "Open in browser"}
                      <Icon
                        name={
                          previewMutation.isPending ? "Spinner" : "ArrowRight"
                        }
                        className={
                          previewMutation.isPending
                            ? "size-4 animate-spin"
                            : "size-4 transition-transform group-hover:translate-x-0.5"
                        }
                        aria-hidden
                      />
                    </span>
                  </button>
                  <div className="flex border-t border-border/70 md:w-20 md:flex-col md:border-l md:border-t-0">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-14 flex-1 rounded-none border-r border-border/70 md:h-auto md:border-b md:border-r-0"
                      aria-label="Newer triage board"
                      disabled={selectedBoardIndex <= 0}
                      onClick={() => {
                        const board = boards[selectedBoardIndex - 1];
                        if (board) handleSelectBoard(board);
                      }}
                    >
                      <Icon
                        name="ChevronLeft"
                        className="size-4 md:rotate-90"
                      />
                    </Button>
                    <div className="flex min-w-20 items-center justify-center gap-1 px-3 md:min-h-20 md:flex-col md:px-0 md:py-3">
                      {boards.slice(0, 7).map((board) => (
                        <span
                          key={board.path}
                          className={
                            board.path === selectedBoard.path
                              ? "size-1.5 rounded-full bg-foreground"
                              : "size-1 rounded-full bg-muted-foreground/35"
                          }
                          aria-hidden
                        />
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-14 flex-1 rounded-none border-l border-border/70 md:h-auto md:border-l-0 md:border-t"
                      aria-label="Older triage board"
                      disabled={selectedBoardIndex >= boards.length - 1}
                      onClick={() => {
                        const board = boards[selectedBoardIndex + 1];
                        if (board) handleSelectBoard(board);
                      }}
                    >
                      <Icon
                        name="ChevronRight"
                        className="size-4 md:rotate-90"
                      />
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyStatePanel className="m-5 min-h-40 content-center">
                  Run <code>/triage-board</code> to create your first saved
                  board.
                </EmptyStatePanel>
              )}
              {previewMutation.isError ? (
                <p className="border-t border-border/70 px-6 py-3 text-sm text-destructive">
                  {getMutationErrorMessage({
                    error: previewMutation.error,
                    fallbackMessage: "Could not open triage board.",
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </RootComposeSecondaryContent>
    </>
  );
}
