import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export interface WorkspaceTab {
  id: string;
  label: string;
  closeLabel?: string;
  isDirty?: boolean;
}

interface WorkspaceTabStripProps {
  activeTabId: string;
  ariaLabel: string;
  onCloseTab?: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  panelId: string;
  tabListTrailingContent?: ReactNode;
  tabs: readonly WorkspaceTab[];
  trailingContent?: ReactNode;
}

interface ThreadWorkspaceShellProps {
  activeLowerTabId: string;
  activeMainTabId: string;
  activeUpperTabId: string;
  isCompact: boolean;
  lowerContent: ReactNode;
  lowerTabs: readonly WorkspaceTab[];
  mainContent: ReactNode;
  mainTabs: readonly WorkspaceTab[];
  onCloseMainTab?: (tabId: string) => void;
  onCreateChat?: () => void;
  onSelectLowerTab: (tabId: string) => void;
  onSelectMainTab: (tabId: string) => void;
  onSelectUpperTab: (tabId: string) => void;
  upperContent: ReactNode;
  upperTabs: readonly WorkspaceTab[];
  upperTrailingContent?: ReactNode;
}

const WorkspaceTerminalToolbarHostContext =
  createContext<HTMLDivElement | null>(null);

export function useWorkspaceTerminalToolbarHost(): HTMLDivElement | null {
  return useContext(WorkspaceTerminalToolbarHostContext);
}

export const WORKSPACE_SIDEBAR_DEFAULT_PERCENT = 32;
export const WORKSPACE_SIDEBAR_MIN_PERCENT = 20;
export const WORKSPACE_SIDEBAR_MAX_PERCENT = 55;
export const WORKSPACE_SIDEBAR_SPLIT_DEFAULT_PERCENT = 50;
export const WORKSPACE_SIDEBAR_REGION_MIN_PERCENT = 25;
const WORKSPACE_SIDEBAR_LAYOUT_STORAGE_ID = "bb.thread.workspace.sidebar";

function WorkspaceTabStrip({
  activeTabId,
  ariaLabel,
  onCloseTab,
  onSelectTab,
  panelId,
  tabListTrailingContent,
  tabs,
  trailingContent,
}: WorkspaceTabStripProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectByKeyboard = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onSelectTab(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  };
  return (
    <div className="flex h-9 min-w-0 shrink-0 items-center border-b border-border-seam bg-sidebar px-1">
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex h-7 shrink-0 items-center rounded-md px-1",
                isActive && "bg-accent text-accent-foreground",
              )}
            >
              <button
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`${panelId}-tab-${index}`}
                aria-controls={panelId}
                aria-selected={isActive}
                aria-label={
                  tab.isDirty ? `${tab.label}, unsaved changes` : undefined
                }
                tabIndex={isActive ? 0 : -1}
                className="h-full px-1 text-xs font-medium"
                onClick={() => onSelectTab(tab.id)}
                onKeyDown={(event) => selectByKeyboard(event, index)}
              >
                <span className="inline-flex items-center gap-1.5">
                  {tab.isDirty ? (
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-current"
                    />
                  ) : null}
                  <span>{tab.label}</span>
                </span>
              </button>
              {tab.closeLabel && onCloseTab ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5 opacity-70 hover:opacity-100"
                  aria-label={tab.closeLabel}
                  onClick={() => onCloseTab(tab.id)}
                >
                  <Icon name="X" className="size-3" />
                </Button>
              ) : null}
            </div>
          );
        })}
        {tabListTrailingContent}
      </div>
      {trailingContent ? (
        <div className="ml-auto flex shrink-0 items-center pl-1">
          {trailingContent}
        </div>
      ) : null}
    </div>
  );
}

export function ThreadWorkspaceShell({
  activeLowerTabId,
  activeMainTabId,
  activeUpperTabId,
  isCompact,
  lowerContent,
  lowerTabs,
  mainContent,
  mainTabs,
  onCloseMainTab,
  onCreateChat,
  onSelectLowerTab,
  onSelectMainTab,
  onSelectUpperTab,
  upperContent,
  upperTabs,
  upperTrailingContent,
}: ThreadWorkspaceShellProps) {
  const sidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastVisibleSidebarSizeRef = useRef(WORKSPACE_SIDEBAR_DEFAULT_PERCENT);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [terminalToolbarHost, setTerminalToolbarHost] =
    useState<HTMLDivElement | null>(null);
  const handleSidebarResize = useCallback((size: number) => {
    if (size <= 0) return;
    lastVisibleSidebarSizeRef.current = size;
  }, []);
  const hideSidebar = useCallback(() => {
    const currentSize = sidebarPanelRef.current?.getSize();
    if (currentSize !== undefined && currentSize > 0) {
      lastVisibleSidebarSizeRef.current = currentSize;
    }
    setIsSidebarVisible(false);
    sidebarPanelRef.current?.collapse();
  }, []);
  const showSidebar = useCallback(() => {
    setIsSidebarVisible(true);
    sidebarPanelRef.current?.expand(lastVisibleSidebarSizeRef.current);
  }, []);

  const main = (
    <section
      aria-label="Thread workspace"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <WorkspaceTabStrip
        activeTabId={activeMainTabId}
        ariaLabel="Workspace tabs"
        onCloseTab={onCloseMainTab}
        onSelectTab={onSelectMainTab}
        panelId="thread-workspace-main-panel"
        tabListTrailingContent={
          onCreateChat ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 text-muted-foreground"
              onClick={onCreateChat}
              aria-label="Create new chat in this worktree"
            >
              <Icon name="MessageSquarePlus" className="size-3.5" />
            </Button>
          ) : null
        }
        tabs={mainTabs}
        trailingContent={
          !isCompact ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 text-muted-foreground"
              onClick={isSidebarVisible ? hideSidebar : showSidebar}
              aria-label={
                isSidebarVisible
                  ? "Hide workspace sidebar"
                  : "Show workspace sidebar"
              }
            >
              <Icon name="PanelRight" />
            </Button>
          ) : null
        }
      />
      <div
        id="thread-workspace-main-panel"
        role="tabpanel"
        aria-labelledby={`thread-workspace-main-panel-tab-${Math.max(
          0,
          mainTabs.findIndex((tab) => tab.id === activeMainTabId),
        )}`}
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {mainContent}
      </div>
    </section>
  );

  if (isCompact) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {main}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <PanelGroup
        autoSaveId={WORKSPACE_SIDEBAR_LAYOUT_STORAGE_ID}
        direction="horizontal"
        className="min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        <Panel
          id="thread-workspace-main"
          defaultSize={100 - WORKSPACE_SIDEBAR_DEFAULT_PERCENT}
          minSize={100 - WORKSPACE_SIDEBAR_MAX_PERCENT}
          order={1}
          className="min-w-0 overflow-hidden"
        >
          {main}
        </Panel>
        <PanelResizeHandle
          aria-label="Resize thread workspace sidebar"
          disabled={!isSidebarVisible}
          className={cn(
            "group relative z-[5] shrink-0 bg-border-seam before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 hover:bg-ring/40",
            isSidebarVisible
              ? "w-px cursor-col-resize"
              : "pointer-events-none w-0",
          )}
        />
        <Panel
          ref={sidebarPanelRef}
          id="thread-workspace-sidebar-panel"
          collapsible
          collapsedSize={0}
          defaultSize={WORKSPACE_SIDEBAR_DEFAULT_PERCENT}
          minSize={WORKSPACE_SIDEBAR_MIN_PERCENT}
          maxSize={WORKSPACE_SIDEBAR_MAX_PERCENT}
          onCollapse={() => setIsSidebarVisible(false)}
          onExpand={() => setIsSidebarVisible(true)}
          onResize={handleSidebarResize}
          order={2}
          className="min-w-0 overflow-hidden"
        >
          <aside
            aria-label="Workspace sidebar"
            data-testid="thread-workspace-sidebar"
            className="h-full min-h-0 w-full overflow-hidden bg-sidebar"
          >
            <PanelGroup direction="vertical" className="h-full min-h-0">
              <Panel
                id="thread-workspace-upper-panel"
                defaultSize={WORKSPACE_SIDEBAR_SPLIT_DEFAULT_PERCENT}
                minSize={WORKSPACE_SIDEBAR_REGION_MIN_PERCENT}
                order={1}
                className="min-h-0 overflow-hidden"
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <WorkspaceTabStrip
                    activeTabId={activeUpperTabId}
                    ariaLabel="Repository tabs"
                    onSelectTab={onSelectUpperTab}
                    panelId="thread-workspace-repository-panel"
                    tabs={upperTabs}
                    trailingContent={upperTrailingContent}
                  />
                  <div
                    id="thread-workspace-repository-panel"
                    role="tabpanel"
                    aria-labelledby={`thread-workspace-repository-panel-tab-${Math.max(
                      0,
                      upperTabs.findIndex((tab) => tab.id === activeUpperTabId),
                    )}`}
                    className="min-h-0 flex-1 overflow-hidden"
                  >
                    {upperContent}
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle
                aria-label="Resize repository and terminal panels"
                className="group relative h-px shrink-0 cursor-row-resize bg-border-seam before:absolute before:-inset-y-1.5 before:inset-x-0 hover:bg-ring/40"
              />
              <Panel
                id="thread-workspace-lower-panel"
                defaultSize={WORKSPACE_SIDEBAR_SPLIT_DEFAULT_PERCENT}
                minSize={WORKSPACE_SIDEBAR_REGION_MIN_PERCENT}
                order={2}
                className="min-h-0 overflow-hidden"
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                  <WorkspaceTabStrip
                    activeTabId={activeLowerTabId}
                    ariaLabel="Worktree terminal tabs"
                    onSelectTab={onSelectLowerTab}
                    panelId="thread-workspace-terminal-panel"
                    tabs={lowerTabs}
                    trailingContent={
                      <div
                        ref={setTerminalToolbarHost}
                        data-testid="workspace-terminal-toolbar-host"
                      />
                    }
                  />
                  <div
                    id="thread-workspace-terminal-panel"
                    role="tabpanel"
                    aria-labelledby={`thread-workspace-terminal-panel-tab-${Math.max(
                      0,
                      lowerTabs.findIndex((tab) => tab.id === activeLowerTabId),
                    )}`}
                    data-testid="thread-workspace-terminal-region"
                    className="min-h-0 flex-1 overflow-hidden"
                  >
                    <WorkspaceTerminalToolbarHostContext.Provider
                      value={terminalToolbarHost}
                    >
                      {lowerContent}
                    </WorkspaceTerminalToolbarHostContext.Provider>
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </aside>
        </Panel>
      </PanelGroup>
    </div>
  );
}
