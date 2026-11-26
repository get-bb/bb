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
            <textarea aria-label="Message" />
            <button>Other action</button>
          </Panel>
          <ThreadSecondaryPanel
            activeTab={activeTab}
            fixedTabs={[info, diff]}
            tabs={[]}
            isConversationCollapsed={false}
            isOpen={isOpen}
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

it("moves focus into the panel on opening and restores the previous control on closing", () => {
  const view = render(panel(info.tab, false));
  const composer = screen.getByRole("textbox", { name: "Message" });
  composer.focus();

  view.rerender(panel(info.tab, true));
  const tab = screen.getByRole("button", { name: "Show info" });
  const focusOnOpen = document.activeElement;
  tab.focus();

  view.rerender(panel(info.tab, false));
  const focusOnClose = document.activeElement;

  view.rerender(panel(info.tab, true));
  expect([focusOnOpen, focusOnClose, document.activeElement]).toEqual([
    tab,
    composer,
    tab,
  ]);
});

it("does not steal focus on mount or when closing after focus has left the panel", () => {
  const view = render(panel(info.tab, true));
  expect(document.activeElement).toBe(document.body);
  const composer = screen.getByRole("textbox", { name: "Message" });
  composer.focus();
  screen.getByRole("button", { name: "Show info" }).focus();
  const otherAction = screen.getByRole("button", { name: "Other action" });
  otherAction.focus();

  view.rerender(panel(info.tab, false));
  expect(document.activeElement).toBe(otherAction);
});
