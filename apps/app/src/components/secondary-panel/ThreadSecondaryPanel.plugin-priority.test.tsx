// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createPluginPanelFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
} from "@/lib/plugin-frontend-boot-state";
import { frontendPriorityPluginIds } from "@/lib/plugin-surface-providers";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

const noop = () => {};
const THREAD_PATH = "/projects/proj_1/threads/thr_1";
const sideChatTab = createPluginPanelFixedPanelTab({
  pluginId: "side-chat",
  actionId: "open",
  paramsJson: null,
  title: "Side chat",
});
const infoFixedTab = createThreadInfoFixedPanelTab();

afterEach(() => {
  cleanup();
  resetPluginFrontendBootStateForTest();
  window.localStorage.clear();
});

function renderPanel() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const panel = (activeTab: SecondaryFixedPanelTab, isOpen: boolean) => (
    <Wrapper>
      <TooltipProvider>
        <ThreadSecondaryPanel
          activeTab={activeTab}
          canUseGitUi={false}
          fixedTabs={[
            {
              ariaLabel: "Show thread info panel",
              label: "Info",
              leadingVisual: null,
              onSelect: noop,
              tab: infoFixedTab,
              title: "Thread info",
            },
          ]}
          tabs={[
            {
              label: "Side chat",
              leadingVisual: null,
              onClose: noop,
              onSelect: noop,
              renderContent: () => null,
              statusLabel: null,
              tab: sideChatTab,
            },
          ]}
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
      </TooltipProvider>
    </Wrapper>
  );
  const view = render(panel(sideChatTab, true));
  return {
    show: (activeTab: SecondaryFixedPanelTab, isOpen: boolean) =>
      view.rerender(panel(activeTab, isOpen)),
  };
}

describe("ThreadSecondaryPanel plugin frontend priority", () => {
  it("loads the open tab's plugin first on the next boot, and stops once the tab is closed or core", () => {
    const view = renderPanel();
    expect(frontendPriorityPluginIds(THREAD_PATH)).toContain("side-chat");

    markPluginFrontendBootStarted();
    view.show(sideChatTab, false);
    expect(frontendPriorityPluginIds(THREAD_PATH)).toContain("side-chat");

    act(() => markPluginFrontendsSettled());
    expect(frontendPriorityPluginIds(THREAD_PATH)).not.toContain("side-chat");

    view.show(sideChatTab, true);
    expect(frontendPriorityPluginIds(THREAD_PATH)).toContain("side-chat");

    view.show(infoFixedTab, true);
    expect(frontendPriorityPluginIds(THREAD_PATH)).toEqual([
      "bb--composer",
      "thread-list",
      "navigation",
    ]);
  });
});
