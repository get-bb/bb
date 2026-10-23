// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PanelGroup } from "react-resizable-panels";
import { afterEach, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createPluginPageFixedPanelTab,
  createThreadInfoFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

afterEach(cleanup);

const noop = () => {};

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Clicked {count}
    </button>
  );
}

const infoTab = createThreadInfoFixedPanelTab();
const counterTab = createPluginPageFixedPanelTab({
  pluginId: "example",
  pageId: "board",
  fixedTabId: "counter",
});
const fixedTabs = [
  {
    ariaLabel: "Show info",
    label: "Info",
    contentFillsRegion: true,
    renderContent: () => <p>Info content</p>,
    leadingVisual: null,
    onSelect: noop,
    tab: infoTab,
    title: "Info",
  },
  {
    ariaLabel: "Show counter",
    label: "Counter",
    contentFillsRegion: true,
    renderContent: () => <Counter />,
    leadingVisual: null,
    onSelect: noop,
    tab: counterTab,
    title: "Counter",
  },
] as const;

function panel(activeTab: typeof infoTab | typeof counterTab) {
  return (
    <TooltipProvider>
      <PanelGroup direction="horizontal">
        <ThreadSecondaryPanel
          activeTab={activeTab}
          fixedTabs={fixedTabs}
          tabs={[]}
          isOpen
          metadataContent={null}
          onClose={noop}
          onCollapse={noop}
          onTabReorder={noop}
          onOpenNewTab={noop}
          onPanelFocus={noop}
          renderAsDrawer={false}
          isConversationCollapsed={false}
          onToggleConversationCollapse={noop}
        />
      </PanelGroup>
    </TooltipProvider>
  );
}

it("keeps a fixed tab's state while another fixed tab is shown", () => {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const view = render(panel(counterTab), { wrapper: Wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Clicked 0" }));
  fireEvent.click(screen.getByRole("button", { name: "Clicked 1" }));

  view.rerender(panel(infoTab));
  expect(screen.getByText("Info content")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Clicked/u })).toBeNull();

  view.rerender(panel(counterTab));
  expect(screen.getByRole("button", { name: "Clicked 2" })).toBeTruthy();
});
