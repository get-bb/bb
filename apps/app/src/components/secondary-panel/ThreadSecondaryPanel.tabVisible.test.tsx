// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, expect, it } from "vitest";
import { Panel, PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createGitDiffFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type FixedPanelViewTab,
} from "@/lib/fixed-panel-tabs-state";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";
import { useTabVisible } from "./tab-visibility";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const noop = () => {};
let mounts = 0;

function VisibilityProbe({ name }: { name: string }) {
  const visible = useTabVisible();
  useEffect(() => {
    mounts += 1;
  }, []);
  return <output data-testid={name}>{String(visible)}</output>;
}

function fixedTab(tab: FixedPanelViewTab, name: string) {
  return {
    ariaLabel: `Show ${name}`,
    label: name,
    contentFillsRegion: true,
    renderContent: () => <VisibilityProbe name={name} />,
    leadingVisual: null,
    onSelect: noop,
    tab,
    title: name,
  };
}

const info = fixedTab(createThreadInfoFixedPanelTab(), "info");
const diff = fixedTab(createGitDiffFixedPanelTab(), "diff");
const { wrapper: Wrapper } = createQueryClientTestHarness();

function panel(activeTab: FixedPanelViewTab, isOpen: boolean) {
  return (
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <Panel id="main" order={1}>
            main
          </Panel>
          <ThreadSecondaryPanel
            activeTab={activeTab}
            fixedTabs={[info, diff]}
            tabs={[]}
            isConversationCollapsed={false}
            isOpen={isOpen}
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onTabReorder={noop}
            onOpenNewTab={noop}
            onPanelFocus={noop}
            onToggleConversationCollapse={noop}
            renderAsDrawer
          />
        </PanelGroup>
      </TooltipProvider>
    </Wrapper>
  );
}

it("reports the selected tab visible only while the panel is open, keeping it mounted when closed", () => {
  mounts = 0;
  const view = render(panel(diff.tab, true));
  expect(screen.getByTestId("diff").textContent).toBe("true");
  expect(screen.queryByTestId("info")).toBeNull();

  view.rerender(panel(diff.tab, false));
  expect(screen.getByTestId("diff").textContent).toBe("false");
  expect(mounts).toBe(1);

  view.rerender(panel(info.tab, true));
  expect(screen.getByTestId("info").textContent).toBe("true");
  expect(screen.queryByTestId("diff")).toBeNull();
});
