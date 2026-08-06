import type { ReactNode } from "react";
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
  tabs,
}: WorkspaceTabStripProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex h-9 min-w-0 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border-seam bg-sidebar px-1"
    >
      {tabs.map((tab) => {
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
              type="button"
              role="tab"
              aria-selected={isActive}
              className="h-full px-2 text-xs font-medium"
              onClick={() => onSelectTab(tab.id)}
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
        tabs={mainTabs}
      />
      <div role="tabpanel" className="min-h-0 min-w-0 flex-1 overflow-hidden">
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
                  tabs={upperTabs}
                />
                <div role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
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
                  tabs={lowerTabs}
                />
                <div
                  role="tabpanel"
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
