// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  createSidebarSplitState,
  moveSidebarTab,
  serializeSidebarSplitState,
  sidebarSplitStorageKey,
} from "./sidebarSplitLayout";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = () => {};

function renderPanel(args: {
  isConversationCollapsed: boolean;
  onToggleConversationCollapse: () => void;
}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <ThreadSecondaryPanel
            activeTab={createThreadInfoFixedPanelTab()}
            canUseGitUi={false}
            isOpen
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onFileTabReorder={noop}
            onOpenNewTab={noop}
            onPanelChange={noop}
            onPanelFocus={noop}
            renderAsDrawer={false}
            {...args}
          />
        </PanelGroup>
      </TooltipProvider>
    </Wrapper>,
  );
}

describe("ThreadSecondaryPanel compact file content", () => {
  it("retains the active file body after the persistent drawer closes", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const activeTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-test",
      projectId: "project-test",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const renderDrawer = (isOpen: boolean) => (
      <Wrapper>
        <TooltipProvider>
          <ThreadSecondaryPanel
            activeTab={activeTab}
            canUseGitUi={false}
            fileTabs={[
              {
                id: activeTab.id,
                filename: "index.ts",
                isActive: true,
                leadingVisual: null,
                statusLabel: null,
                onSelect: noop,
                onClose: noop,
              },
            ]}
            fileTabContent={<input aria-label="Retained file content" />}
            isConversationCollapsed={false}
            isOpen={isOpen}
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onFileTabReorder={noop}
            onOpenNewTab={noop}
            onPanelChange={noop}
            onPanelFocus={noop}
            onToggleConversationCollapse={noop}
            renderAsDrawer
          />
        </TooltipProvider>
      </Wrapper>
    );
    const view = render(renderDrawer(true));
    const fileContent = screen.getByRole("textbox", {
      name: "Retained file content",
    });

    view.rerender(renderDrawer(false));

    expect(screen.getByLabelText("Retained file content")).toBe(fileContent);
  });

  it("renders one active compact body and restores the saved wide split", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const activeTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-test",
      projectId: "project-test",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const panelStateId = "thread-compact-split";
    const initial = createSidebarSplitState(
      [createThreadInfoFixedPanelTab().id, activeTab.id],
      activeTab.id,
    );
    const split = moveSidebarTab(
      initial,
      initial.layout.focusedPaneId,
      activeTab.id,
      { paneId: initial.layout.focusedPaneId, zone: "right" },
      { groupId: "group-file" },
    );
    const storedSplit = serializeSidebarSplitState(split);
    const storageKey = sidebarSplitStorageKey(panelStateId);
    window.localStorage.setItem(storageKey, storedSplit);
    const renderSplitTabContent = vi.fn(() => (
      <input aria-label="Unexpected split body" />
    ));

    const renderPanel = (renderAsDrawer: boolean) => (
      <Wrapper>
        <TooltipProvider>
          <PanelGroup direction="horizontal">
            <ThreadSecondaryPanel
              activeTab={activeTab}
              canUseGitUi={false}
              fileTabs={[
                {
                  id: activeTab.id,
                  filename: "index.ts",
                  isActive: true,
                  leadingVisual: null,
                  statusLabel: null,
                  onSelect: noop,
                  onClose: noop,
                },
              ]}
              fileTabContent={<input aria-label="Compact active body" />}
              isConversationCollapsed={false}
              isOpen
              metadataContent={null}
              onClose={noop}
              onCollapse={noop}
              onFileTabReorder={noop}
              onOpenNewTab={noop}
              onPanelChange={noop}
              onPanelFocus={noop}
              onToggleConversationCollapse={noop}
              renderAsDrawer={renderAsDrawer}
              renderSplitTabContent={renderSplitTabContent}
              splitPanelStateId={panelStateId}
              splitTabModels={[activeTab]}
            />
          </PanelGroup>
        </TooltipProvider>
      </Wrapper>
    );
    const view = render(renderPanel(true));

    expect(screen.getAllByLabelText("Compact active body")).toHaveLength(1);
    expect(screen.queryByLabelText("Unexpected split body")).toBeNull();
    expect(renderSplitTabContent).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(storageKey)).toBe(storedSplit);

    view.rerender(renderPanel(false));

    const restoredPanes = document.querySelectorAll("[data-split-pane-id]");
    expect(restoredPanes).toHaveLength(2);
    const restoredTabGroups = document.querySelectorAll(
      "[data-sidebar-split-tab-group]",
    );
    expect(restoredTabGroups).toHaveLength(2);
    expect(restoredTabGroups[0]?.textContent).toContain("Info");
    expect(restoredTabGroups[1]?.textContent).toContain("index.ts");
    expect(renderSplitTabContent).toHaveBeenCalledWith(activeTab);
    expect(window.localStorage.getItem(storageKey)).toBe(storedSplit);
  });
});

describe("ThreadSecondaryPanel Diff eligibility", () => {
  it("falls back from an ineligible active Diff tab to Info", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <TooltipProvider>
          <PanelGroup direction="horizontal">
            <ThreadSecondaryPanel
              activeTab={createGitDiffFixedPanelTab()}
              canUseGitUi={false}
              isConversationCollapsed={false}
              isOpen
              metadataContent={<div>Thread metadata</div>}
              onClose={noop}
              onCollapse={noop}
              onFileTabReorder={noop}
              onOpenNewTab={noop}
              onPanelChange={noop}
              onPanelFocus={noop}
              onToggleConversationCollapse={noop}
              renderAsDrawer={false}
            />
          </PanelGroup>
        </TooltipProvider>
      </Wrapper>,
    );

    expect(screen.getByTestId("thread-info-tab")).toBeTruthy();
    expect(screen.getByText("Thread metadata")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Show diff panel" }),
    ).toBeNull();
    expect(screen.queryByText("This panel view is unavailable.")).toBeNull();
  });

  it("keeps an active Diff tab visible while Git eligibility loads", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <TooltipProvider>
          <PanelGroup direction="horizontal">
            <ThreadSecondaryPanel
              activeTab={createGitDiffFixedPanelTab()}
              canUseGitUi={false}
              gitDiffTabStatus="loading"
              isConversationCollapsed={false}
              isOpen
              metadataContent={null}
              onClose={noop}
              onCollapse={noop}
              onFileTabReorder={noop}
              onOpenNewTab={noop}
              onPanelChange={noop}
              onPanelFocus={noop}
              onToggleConversationCollapse={noop}
              renderAsDrawer={false}
            />
          </PanelGroup>
        </TooltipProvider>
      </Wrapper>,
    );

    expect(
      screen.getByRole("button", { name: "Show diff panel" }),
    ).toBeTruthy();
    expect(screen.getByText("Checking Git support…")).toBeTruthy();
    expect(screen.queryByText("This panel view is unavailable.")).toBeNull();
  });
});

// The full-screen control is the ONLY way back once the conversation is hidden
// — there is no standalone rail to click. Pin both halves of the same-slot
// expansion pair so a full-screen tab can always restore its prior layout.
describe("ThreadSecondaryPanel full-screen control", () => {
  it("keeps Full Screen before Hide right panel in the trailing toolbar", () => {
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse: noop,
    });

    const fullScreenControl = view.getByRole("button", {
      name: "Full Screen",
    });
    const hideControl = view.getByRole("button", {
      name: "Hide right panel",
    });
    expect(
      fullScreenControl.compareDocumentPosition(hideControl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("expands the panel while the conversation is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Full Screen" });
    expect(control.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("restores the conversation from the same slot while it is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    const view = renderPanel({
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    const control = view.getByRole("button", { name: "Exit Full Screen" });
    expect(control.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(control);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("offers every existing split position from the right-panel control and moves the active tab", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const onOpenNewTab = vi.fn();
    const fileTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-test",
      projectId: "project-test",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });

    render(
      <Wrapper>
        <SidebarProvider>
          <TooltipProvider>
            <PanelGroup direction="horizontal">
              <ThreadSecondaryPanel
                activeTab={fileTab}
                canUseGitUi={false}
                fileTabs={[
                  {
                    id: fileTab.id,
                    filename: "index.ts",
                    isActive: true,
                    leadingVisual: null,
                    statusLabel: null,
                    onSelect: noop,
                    onClose: noop,
                  },
                ]}
                isConversationCollapsed={false}
                isOpen
                metadataContent={null}
                onClose={noop}
                onCollapse={noop}
                onFileTabReorder={noop}
                onOpenNewTab={onOpenNewTab}
                onPanelChange={noop}
                onPanelFocus={noop}
                onToggleConversationCollapse={noop}
                renderAsDrawer={false}
                renderSplitTabContent={() => null}
                splitPanelStateId="thread-position-menu"
                splitTabModels={[fileTab]}
              />
            </PanelGroup>
          </TooltipProvider>
        </SidebarProvider>
      </Wrapper>,
    );

    const control = screen.getByRole("button", { name: "Full Screen" });
    fireEvent.focus(control);
    expect(
      screen.getByRole("menu", { name: "Pane arrangement" }),
    ).not.toBeNull();
    for (const side of ["left", "right", "top", "bottom"] as const) {
      expect(
        screen.getByRole("menuitem", { name: `Move ${side}` }),
      ).not.toBeNull();
    }

    fireEvent.click(screen.getByRole("menuitem", { name: "Move right" }));
    const panes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-split-pane-id]"),
    );
    expect(panes).toHaveLength(2);
    const tabGroups = Array.from(
      document.querySelectorAll<HTMLElement>("[data-sidebar-split-tab-group]"),
    );
    expect(tabGroups).toHaveLength(2);
    expect(tabGroups[0]?.textContent).toContain("Info");
    expect(tabGroups[1]?.textContent).toContain("index.ts");
    expect(
      document.querySelectorAll(
        '[data-testid="thread-secondary-panel-top-chrome"]',
      ),
    ).toHaveLength(1);
    expect(
      panes.some((pane) =>
        pane.querySelector('[data-testid="thread-secondary-panel-top-chrome"]'),
      ),
    ).toBe(false);
    expect(document.querySelectorAll("header")).toHaveLength(0);
    const newTabControls = screen.getAllByRole("button", {
      name: "Open new tab",
    });
    expect(newTabControls).toHaveLength(1);
    fireEvent.click(newTabControls[0] as HTMLElement);
    expect(onOpenNewTab).toHaveBeenCalledTimes(1);
  });

  it("keeps one conversation restore control across split tab rows", () => {
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    const fileTab = createWorkspaceFilePreviewFixedPanelTab({
      environmentId: "env-test",
      projectId: "project-test",
      tab: {
        lineRange: null,
        path: "src/index.ts",
        source: { kind: "working-tree" },
        statusLabel: null,
      },
    });
    const panelStateId = "thread-fullscreen-split";
    const initial = createSidebarSplitState(
      [createThreadInfoFixedPanelTab().id, fileTab.id],
      fileTab.id,
    );
    const split = moveSidebarTab(
      initial,
      initial.layout.focusedPaneId,
      fileTab.id,
      { paneId: initial.layout.focusedPaneId, zone: "right" },
      { groupId: "group-file" },
    );
    window.localStorage.setItem(
      sidebarSplitStorageKey(panelStateId),
      serializeSidebarSplitState(split),
    );
    const onToggleConversationCollapse = vi.fn();

    render(
      <Wrapper>
        <SidebarProvider>
          <TooltipProvider>
            <PanelGroup direction="horizontal">
              <ThreadSecondaryPanel
                activeTab={fileTab}
                canUseGitUi={false}
                fileTabs={[
                  {
                    id: fileTab.id,
                    filename: "index.ts",
                    isActive: true,
                    leadingVisual: null,
                    statusLabel: null,
                    onSelect: noop,
                    onClose: noop,
                  },
                ]}
                isConversationCollapsed
                isOpen
                metadataContent={null}
                onClose={noop}
                onCollapse={noop}
                onFileTabReorder={noop}
                onOpenNewTab={noop}
                onPanelChange={noop}
                onPanelFocus={noop}
                onToggleConversationCollapse={onToggleConversationCollapse}
                renderAsDrawer={false}
                renderSplitTabContent={() => null}
                splitPanelStateId={panelStateId}
                splitTabModels={[fileTab]}
              />
            </PanelGroup>
          </TooltipProvider>
        </SidebarProvider>
      </Wrapper>,
    );

    const restoreControls = screen.getAllByRole("button", {
      name: "Exit Full Screen",
    });
    expect(restoreControls).toHaveLength(1);
    const restoreControl = restoreControls[0];
    if (restoreControl === undefined)
      throw new Error("Missing restore control");
    fireEvent.click(restoreControl);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });
});
