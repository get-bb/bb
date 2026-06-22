import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ThreadSecondaryPanel,
  type SecondaryPanelFileTab,
} from "./ThreadSecondaryPanel";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { Icon } from "@/components/ui/icon.js";
import {
  createGitDiffFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type HostFilePreviewFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { resolveRightPanelFileVisual } from "./rightPanelFileVisuals";

export default {
  title: "right-panel/Tabbed shell",
};

const noop = () => {};

function createStoryFixedPanelTab(
  panel: ThreadSecondaryPanelTab,
): SecondaryFixedPanelTab {
  switch (panel) {
    case "thread-info":
      return createThreadInfoFixedPanelTab();
    case "git-diff":
      return createGitDiffFixedPanelTab();
  }
}

function createStoryFileTab(filename: string): HostFilePreviewFixedPanelTab {
  return {
    environmentId: "env_story",
    id: `host-file-preview:${encodeURIComponent(filename)}:thread%3Athr_story%3Aenvironment%3Aenv_story`,
    kind: "host-file-preview",
    lineRange: null,
    path: filename,
    threadId: "thr_story",
  };
}

// The right panel renders inside a flex column; give it explicit height so the
// inner scroll regions get something to fill.
function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[160px] w-full max-w-[640px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      {children}
    </div>
  );
}

interface PanelHarnessProps {
  initialPanel: ThreadSecondaryPanelTab;
  children: (panel: ThreadSecondaryPanelTab) => ReactNode;
}

function PanelHarness({ initialPanel, children }: PanelHarnessProps) {
  const [panel, setPanel] = useState(initialPanel);
  useEffect(() => {
    setPanel(initialPanel);
  }, [initialPanel]);
  return children(panel);
}

const placeholderInfoContent = (
  <div className="space-y-2 pt-1 text-sm text-muted-foreground">
    <p>Info tab content (see "right-panel/Info" story for variants).</p>
  </div>
);

interface ShellArgs {
  initialPanel: ThreadSecondaryPanelTab;
  showGitDiffTab?: boolean;
  canUseGitUi?: boolean;
}

function ShellRow({
  initialPanel,
  showGitDiffTab = true,
  canUseGitUi = true,
}: ShellArgs) {
  return (
    <PanelHarness initialPanel={initialPanel}>
      {(panel) => (
        <PanelStage>
          <ThreadSecondaryPanel
            activeTab={createStoryFixedPanelTab(panel)}
            canUseGitUi={canUseGitUi}
            defaultMergeBaseBranch="main"
            environmentId={undefined}
            isOpen
            metadataContent={placeholderInfoContent}
            showGitDiffTab={showGitDiffTab}
            onPanelFocus={noop}
            onPanelChange={noop}
            onCollapse={noop}
            onClose={noop}
            onFileTabReorder={noop}
            onOpenNewTab={noop}
            isConversationCollapsed={false}
            onToggleConversationCollapse={noop}
            reserveLeftForDesktopTrafficLights={false}
            renderAsDrawer
          />
        </PanelStage>
      )}
    </PanelHarness>
  );
}

const placeholderFileContent = (
  <div className="space-y-2 px-4 py-2 text-sm text-muted-foreground">
    <p>File tab content placeholder.</p>
  </div>
);

interface TerminalTabFixture {
  terminalId: string;
  title: string;
  statusLabel: string | null;
}

interface TerminalContentPlaceholderProps {
  title: string;
}

const TERMINAL_TABS: TerminalTabFixture[] = [
  { terminalId: "term_story_running", title: "pnpm dev", statusLabel: null },
  {
    terminalId: "term_story_starting",
    title: "install",
    statusLabel: "starting",
  },
];

function TerminalContentPlaceholder({
  title,
}: TerminalContentPlaceholderProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-950 px-3 py-2 font-mono text-xs text-emerald-100">
      <p>$ {title}</p>
      <p className="pt-1 text-emerald-300">Right panel terminal tab content.</p>
    </div>
  );
}

interface FileTabsShellRowProps {
  filenames: string[];
  initialActiveFilename: string | null;
  pinnedFilename?: string;
}

function FileTabsShellInner({
  filenames,
  initialActiveFilename,
  pinnedFilename,
}: FileTabsShellRowProps) {
  const [activeFixedTab, setActiveFixedTab] = useState<SecondaryFixedPanelTab>(
    createThreadInfoFixedPanelTab(),
  );
  const [openFiles, setOpenFiles] = useState<string[]>(filenames);
  const [activeFilename, setActiveFilename] = useState<string | null>(
    initialActiveFilename,
  );
  const activeTab =
    activeFilename === null
      ? activeFixedTab
      : createStoryFileTab(activeFilename);
  const activeTabId = activeTab.id;

  const handleCloseFile = useCallback(
    (filename: string) => {
      if (filename === pinnedFilename) return;
      setOpenFiles((prev) => prev.filter((name) => name !== filename));
      setActiveFilename((prev) => (prev === filename ? null : prev));
    },
    [pinnedFilename],
  );

  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      openFiles.map((filename) => {
        const tab = createStoryFileTab(filename);
        const visual = resolveRightPanelFileVisual({ path: filename });
        return {
          id: tab.id,
          filename,
          isActive: tab.id === activeTabId,
          isPinned: filename === pinnedFilename,
          leadingVisual: (
            <Icon name={visual.iconName} className="size-3.5" aria-hidden />
          ),
          statusLabel: null,
          onSelect: () => setActiveFilename(filename),
          onClose: () => handleCloseFile(filename),
        };
      }),
    [openFiles, activeTabId, handleCloseFile, pinnedFilename],
  );

  return (
    <PanelStage>
      <ThreadSecondaryPanel
        activeTab={activeTab}
        canUseGitUi
        defaultMergeBaseBranch="main"
        environmentId={undefined}
        isOpen
        metadataContent={placeholderInfoContent}
        fileTabs={fileTabs}
        fileTabContent={activeFilename ? placeholderFileContent : null}
        showGitDiffTab
        onPanelFocus={noop}
        onPanelChange={(panel) => {
          setActiveFilename(null);
          setActiveFixedTab(createStoryFixedPanelTab(panel));
        }}
        onCollapse={noop}
        onClose={noop}
        onFileTabReorder={noop}
        onOpenNewTab={noop}
        isConversationCollapsed={false}
        onToggleConversationCollapse={noop}
        reserveLeftForDesktopTrafficLights={false}
        renderAsDrawer
      />
    </PanelStage>
  );
}

function FileTabsShellRow(props: FileTabsShellRowProps) {
  return <FileTabsShellInner {...props} />;
}

interface TerminalTabsShellRowProps {
  initialActiveTerminalId: string;
  terminals: readonly TerminalTabFixture[];
}

function TerminalTabsShellInner({
  initialActiveTerminalId,
  terminals,
}: TerminalTabsShellRowProps) {
  const [openTerminals, setOpenTerminals] =
    useState<readonly TerminalTabFixture[]>(terminals);
  const [activeFixedTab, setActiveFixedTab] = useState<SecondaryFixedPanelTab>(
    createThreadInfoFixedPanelTab(),
  );
  const [activeTerminalId, setActiveTerminalId] = useState(
    initialActiveTerminalId,
  );
  useEffect(() => {
    setOpenTerminals(terminals);
    setActiveTerminalId(initialActiveTerminalId);
  }, [initialActiveTerminalId, terminals]);
  const activeTerminal =
    openTerminals.find(
      (terminal) => terminal.terminalId === activeTerminalId,
    ) ?? null;
  const activeTab =
    activeTerminal === null
      ? activeFixedTab
      : createTerminalFixedPanelTab({
          terminalId: activeTerminal.terminalId,
        });
  const activeTabId = activeTab.id;

  const handleCloseTerminal = useCallback(
    (terminalId: string) => {
      setOpenTerminals((prev) =>
        prev.filter((terminal) => terminal.terminalId !== terminalId),
      );
      setActiveTerminalId((prev) => {
        if (prev !== terminalId) {
          return prev;
        }
        return (
          openTerminals.find((terminal) => terminal.terminalId !== terminalId)
            ?.terminalId ?? ""
        );
      });
    },
    [openTerminals],
  );

  const fileTabs = useMemo<SecondaryPanelFileTab[]>(
    () =>
      openTerminals.map((terminal) => {
        const tab = createTerminalFixedPanelTab({
          terminalId: terminal.terminalId,
        });
        return {
          id: tab.id,
          filename: terminal.title,
          isActive: tab.id === activeTabId,
          leadingVisual: (
            <Icon name="Terminal" className="size-3.5" aria-hidden />
          ),
          statusLabel: terminal.statusLabel,
          onSelect: () => setActiveTerminalId(terminal.terminalId),
          onClose: () => handleCloseTerminal(terminal.terminalId),
        };
      }),
    [activeTabId, handleCloseTerminal, openTerminals],
  );

  return (
    <PanelStage>
      <ThreadSecondaryPanel
        activeTab={activeTab}
        canUseGitUi
        defaultMergeBaseBranch="main"
        environmentId={undefined}
        isOpen
        metadataContent={placeholderInfoContent}
        fileTabs={fileTabs}
        fileTabContent={
          activeTerminal ? (
            <TerminalContentPlaceholder title={activeTerminal.title} />
          ) : null
        }
        showGitDiffTab
        onPanelFocus={noop}
        onPanelChange={(panel) => {
          setActiveTerminalId("");
          setActiveFixedTab(createStoryFixedPanelTab(panel));
        }}
        onCollapse={noop}
        onClose={noop}
        onFileTabReorder={noop}
        onOpenNewTab={noop}
        isConversationCollapsed={false}
        onToggleConversationCollapse={noop}
        reserveLeftForDesktopTrafficLights={false}
        renderAsDrawer
      />
    </PanelStage>
  );
}

function TerminalTabsShellRow(props: TerminalTabsShellRowProps) {
  return <TerminalTabsShellInner {...props} />;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="thread"
        hint="tab strip shows Info + Diff (Diff is exercised in the right-panel/Diff story)"
      >
        <ShellRow initialPanel="thread-info" />
      </StoryRow>
      <StoryRow
        label="parent thread, info tab"
        hint="no Diff for this parent thread; workspace tree is rendered inside the info tab body"
      >
        <ShellRow initialPanel="thread-info" showGitDiffTab={false} />
      </StoryRow>
      <StoryRow
        label="git UI disabled"
        hint="canUseGitUi=false hides the Diff tab and falls back to Info"
      >
        <ShellRow initialPanel="thread-info" canUseGitUi={false} />
      </StoryRow>
      <StoryRow
        label="file tab selected"
        hint="active file tab renders its content; static tabs are unpressed"
      >
        <FileTabsShellRow
          filenames={[
            "ThreadSecondaryPanel.tsx",
            "useGitDiffPanelState.ts",
            "api.ts",
          ]}
          initialActiveFilename="ThreadSecondaryPanel.tsx"
        />
      </StoryRow>
      <StoryRow
        label="terminal tab selected"
        hint="Terminal is a right-panel tab; Info and Diff stay unpressed while terminal content fills the body"
      >
        <TerminalTabsShellRow
          terminals={TERMINAL_TABS}
          initialActiveTerminalId="term_story_running"
        />
      </StoryRow>
      <StoryRow
        label="file tabs open, none selected"
        hint="Info tab stays active while file tabs sit alongside as inactive pills"
      >
        <FileTabsShellRow
          filenames={["ThreadSecondaryPanel.tsx", "useGitDiffPanelState.ts"]}
          initialActiveFilename={null}
        />
      </StoryRow>
      <StoryRow
        label="pinned tab"
        hint="leftmost tab is pinned (no close X); other tabs render the close affordance as usual"
      >
        <FileTabsShellRow
          filenames={["Status", "useGitDiffPanelState.ts"]}
          pinnedFilename="Status"
          initialActiveFilename="Status"
        />
      </StoryRow>
      <StoryRow
        label="overflow — many tabs"
        hint="long filenames truncate; row scrolls horizontally"
      >
        <FileTabsShellRow
          filenames={[
            "ThreadSecondaryPanel.tsx",
            "useGitDiffPanelState.ts",
            "api.ts",
            "ThreadDetailHeader.tsx",
            "ThreadStorageBrowser.tsx",
          ]}
          initialActiveFilename="ThreadStorageBrowser.tsx"
        />
      </StoryRow>
    </StoryCard>
  );
}
