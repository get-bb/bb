// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  createPluginFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type SecondaryFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import {
  markPluginFrontendBootStarted,
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setPluginFrontendReconcilePending,
} from "@/lib/plugin-frontend-boot-state";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  createThreadFixedTabDescriptor,
  useThreadFixedTabs,
} from "@/components/plugin/PluginThreadFixedTabs";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  ThreadSecondaryPanel,
  type SecondaryPanelRenderableTab,
} from "./ThreadSecondaryPanel";

const noop = () => {};
const mounts: string[] = [];

function CountedContent({ label }: { label: string }) {
  useEffect(() => {
    mounts.push(label);
  }, [label]);
  return <div>{label}</div>;
}

const infoTab = createThreadInfoFixedPanelTab();
const statusTab = createPluginFixedPanelTab({
  pluginId: "example",
  tabId: "status",
});
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

function Host({
  threadId,
  activeTab,
}: {
  threadId: string;
  activeTab: SecondaryFixedPanelTab;
}) {
  const fixedTabs = useThreadFixedTabs({ threadId, environmentId: null });
  const renderableTabs: SecondaryPanelRenderableTab[] = [
    {
      label: "index.ts",
      leadingVisual: null,
      onClose: noop,
      onSelect: noop,
      renderContent: () => <CountedContent label={`file:${threadId}`} />,
      statusLabel: null,
      tab: fileTab,
    },
  ];
  return (
    <>
      {fixedTabs.observers}
      <ThreadSecondaryPanel
        activeTab={activeTab}
        areFixedTabsReady={fixedTabs.isReady}
        fixedTabs={[
          {
            ariaLabel: "Show thread info panel",
            label: "Info",
            contentFillsRegion: true,
            renderContent: () => <CountedContent label={`info:${threadId}`} />,
            leadingVisual: null,
            onSelect: noop,
            tab: infoTab,
            title: "Thread info",
          },
          ...fixedTabs.entries.map((entry) =>
            createThreadFixedTabDescriptor(entry, threadId, null, noop),
          ),
        ]}
        tabs={renderableTabs}
        isConversationCollapsed={false}
        isOpen
        metadataContent={null}
        onClose={noop}
        onCollapse={noop}
        onTabReorder={noop}
        onOpenNewTab={noop}
        onPanelFocus={noop}
        onToggleConversationCollapse={noop}
        renderAsDrawer={false}
        splitPanelStateId={threadId}
      />
    </>
  );
}

function mountHost(activeTab: SecondaryFixedPanelTab) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  const content = (threadId: string) => (
    <Wrapper>
      <TooltipProvider>
        <PanelGroup direction="horizontal">
          <Host threadId={threadId} activeTab={activeTab} />
        </PanelGroup>
      </TooltipProvider>
    </Wrapper>
  );
  const view = render(content("thr_a"));
  return {
    switchTo: (threadId: string) => view.rerender(content(threadId)),
  };
}

function registerStatusPlugin() {
  setPluginSlotRegistrations(
    "example",
    collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_tab({
          context: { kind: "thread" },
          availability: "fixed",
          id: "status",
          title: "Status",
          icon: "Info",
          useVisible: () => true,
          component: ({ threadId }) => (
            <CountedContent label={`status:${threadId}`} />
          ),
        });
      }),
    ),
  );
}

beforeEach(() => {
  registerStatusPlugin();
  markPluginFrontendBootStarted();
  act(() => markPluginFrontendsSettled());
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mounts.length = 0;
  resetPluginSlotStoreForTest();
  resetPluginFrontendBootStateForTest();
  resetAllCrashedPluginSlotsForTest();
});

describe("ThreadSecondaryPanel thread switch", () => {
  it.each([
    ["Info", infoTab, "info"],
    ["an open file", fileTab, "file"],
  ] as const)(
    "mounts %s content once per thread switch",
    (_name, activeTab, prefix) => {
      const host = mountHost(activeTab);
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(screen.getByRole("button", { name: /status/i })).not.toBeNull();
      expect(mounts).toEqual([`${prefix}:thr_a`]);
      mounts.length = 0;

      host.switchTo("thr_b");
      expect(screen.getByText(`${prefix}:thr_b`)).not.toBeNull();
      expect(mounts).toEqual([`${prefix}:thr_b`]);

      mounts.length = 0;
      host.switchTo("thr_c");
      expect(mounts).toEqual([`${prefix}:thr_c`]);
    },
  );

  it.each([
    ["Info", infoTab, "info"],
    ["an open file", fileTab, "file"],
    ["a plugin tab", statusTab, "status"],
  ] as const)(
    "keeps %s content mounted while plugin frontends reload",
    (_name, activeTab, prefix) => {
      mountHost(activeTab);
      mounts.length = 0;

      act(() => setPluginFrontendReconcilePending(true));
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(screen.queryByTestId("secondary-panel-content-skeleton")).toBeNull();

      act(() => setPluginFrontendReconcilePending(false));
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(mounts).toEqual([]);
    },
  );

  it("keeps a reloaded plugin tab selected", () => {
    mountHost(statusTab);
    mounts.length = 0;

    act(() => {
      setPluginFrontendReconcilePending(true);
      registerStatusPlugin();
    });
    act(() => setPluginFrontendReconcilePending(false));

    expect(screen.getByText("status:thr_a")).not.toBeNull();
    expect(screen.queryByText("info:thr_a")).toBeNull();
  });
});
