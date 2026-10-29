// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { frontendPriorityPluginIds } from "@/lib/plugin-surface-providers";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = () => {};
const infoFixedTab = {
  ariaLabel: "Show thread info panel",
  label: "Info",
  contentFillsRegion: true,
  renderContent: () => <div>Info content</div>,
  leadingVisual: null,
  onSelect: noop,
  tab: createThreadInfoFixedPanelTab(),
  title: "Thread info",
};
const savedPluginTab = createGitDiffFixedPanelTab();
const pluginFixedTab = {
  ariaLabel: "Show diff panel",
  label: "Diff",
  contentFillsRegion: true,
  renderContent: () => <div>Diff content</div>,
  leadingVisual: null,
  onSelect: noop,
  tab: savedPluginTab,
  title: "Diff",
};

function panel(args: {
  areFixedTabsReady: boolean;
  fixedTabs: readonly (typeof infoFixedTab)[];
  renderAsDrawer: boolean;
  splitPanelStateId?: string;
}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return (
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <ThreadSecondaryPanel
            activeTab={savedPluginTab}
            areFixedTabsReady={args.areFixedTabsReady}
            fixedTabs={args.fixedTabs}
            tabs={[]}
            isConversationCollapsed={false}
            isOpen
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onTabReorder={noop}
            onOpenNewTab={noop}
            onPanelFocus={noop}
            onToggleConversationCollapse={noop}
            renderAsDrawer={args.renderAsDrawer}
            splitPanelStateId={args.splitPanelStateId}
          />
        </PanelGroup>
      </TooltipProvider>
    </Wrapper>
  );
}

describe("ThreadSecondaryPanel saved plugin tab while frontends load", () => {
  it.each([false, true])(
    "holds on the loading state instead of falling back to another fixed tab (drawer=%s)",
    (renderAsDrawer) => {
      const view = render(
        panel({
          areFixedTabsReady: false,
          fixedTabs: [infoFixedTab],
          renderAsDrawer,
        }),
      );
      expect(screen.queryByText("Info content")).toBeNull();
      expect(
        screen.getByTestId("secondary-panel-content-skeleton"),
      ).not.toBeNull();

      view.rerender(
        panel({
          areFixedTabsReady: true,
          fixedTabs: [infoFixedTab, pluginFixedTab],
          renderAsDrawer,
        }),
      );
      expect(screen.getByText("Diff content")).not.toBeNull();
      expect(screen.queryByText("Info content")).toBeNull();
    },
  );

  it("falls back once frontends settle without the saved tab", () => {
    const view = render(
      panel({
        areFixedTabsReady: false,
        fixedTabs: [infoFixedTab],
        renderAsDrawer: false,
      }),
    );
    view.rerender(
      panel({
        areFixedTabsReady: true,
        fixedTabs: [infoFixedTab],
        renderAsDrawer: false,
      }),
    );
    expect(screen.getByText("Info content")).not.toBeNull();
    expect(screen.queryByTestId("secondary-panel-content-skeleton")).toBeNull();
  });
});

describe("ThreadSecondaryPanel open plugin tab", () => {
  it("loads the owning plugin's frontend first on the next page load", () => {
    expect(frontendPriorityPluginIds("/")).not.toContain(
      savedPluginTab.pluginId,
    );
    render(
      panel({
        areFixedTabsReady: true,
        fixedTabs: [infoFixedTab, pluginFixedTab],
        renderAsDrawer: false,
      }),
    );
    expect(frontendPriorityPluginIds("/")).toContain(savedPluginTab.pluginId);
  });
});
