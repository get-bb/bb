import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";

export interface WorkspaceTab {
  id: string;
  label: string;
  closeLabel?: string;
}

interface WorkspaceTabStripProps {
  activeTabId: string;
  ariaLabel: string;
  onCloseTab?: (tabId: string) => void;
  onSelectTab: (tabId: string) => void;
  panelId: string;
  tabs: readonly WorkspaceTab[];
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
  onSelectLowerTab: (tabId: string) => void;
  onSelectMainTab: (tabId: string) => void;
  onSelectUpperTab: (tabId: string) => void;
  topBar?: ReactNode;
  upperContent: ReactNode;
  upperTabs: readonly WorkspaceTab[];
}

export const WORKSPACE_SIDEBAR_WIDTH_PX = 400;
export const WORKSPACE_SIDEBAR_SPLIT_DEFAULT_PERCENT = 50;
export const WORKSPACE_SIDEBAR_REGION_MIN_PERCENT = 25;

function WorkspaceTabStrip({
  activeTabId,
  ariaLabel,
  onCloseTab,
  onSelectTab,
  panelId,
  tabs,
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
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex h-9 min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-seam bg-sidebar px-1"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex h-7 shrink-0 items-center rounded-md",
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
              tabIndex={isActive ? 0 : -1}
              className="h-full px-2 text-xs font-medium"
              onClick={() => onSelectTab(tab.id)}
              onKeyDown={(event) => selectByKeyboard(event, index)}
            >
              {tab.label}
            </button>
            {tab.closeLabel && onCloseTab ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mr-0.5 size-5 opacity-70 hover:opacity-100"
                aria-label={tab.closeLabel}
                onClick={() => onCloseTab(tab.id)}
              >
                <Icon name="X" className="size-3" />
              </Button>
            ) : null}
          </div>
        );
      })}
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
  onSelectLowerTab,
  onSelectMainTab,
  onSelectUpperTab,
  topBar,
  upperContent,
  upperTabs,
}: ThreadWorkspaceShellProps) {
  const main = (
    <section
      aria-label="Thread workspace"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <WorkspaceTabStrip
        activeTabId={activeMainTabId}
        ariaLabel="Workspace tabs"
        onCloseTab={onCloseMainTab}
        onSelectTab={onSelectMainTab}
        panelId="thread-workspace-main-panel"
        tabs={mainTabs}
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
        {topBar}
        {main}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {topBar}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {main}
        <aside
          aria-label="Workspace sidebar"
          data-testid="thread-workspace-sidebar"
          className="min-h-0 shrink-0 overflow-hidden border-l border-border-seam bg-sidebar"
          style={{ width: WORKSPACE_SIDEBAR_WIDTH_PX }}
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
                  {lowerContent}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </aside>
      </div>
    </div>
  );
}
