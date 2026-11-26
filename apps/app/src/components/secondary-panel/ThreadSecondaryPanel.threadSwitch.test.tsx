// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelGroup } from "react-resizable-panels";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { ThreadTabsResponse } from "@bb/server-contract";
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
  setLoadingPluginFrontends,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { sdk } from "@/lib/sdk";
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
const savedThreadTabs: ThreadTabsResponse = {
  revision: 1,
  tabs: [
    {
      id: statusTab.id,
      kind: "plugin-fixed",
      pluginId: "example",
      tabId: "status",
    },
  ],
};

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

async function settleThreadTabs() {
  await act(async () => {});
}

async function mountHost(activeTab: SecondaryFixedPanelTab) {
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
  await settleThreadTabs();
  return {
    switchTo: async (threadId: string) => {
      view.rerender(content(threadId));
      await settleThreadTabs();
    },
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
  vi.spyOn(sdk.threads.tabs, "get").mockImplementation(async () => ({
    ...savedThreadTabs,
  }));
  registerStatusPlugin();
  markPluginFrontendBootStarted();
  act(() => markPluginFrontendsSettled());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    async (_name, activeTab, prefix) => {
      const host = await mountHost(activeTab);
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(screen.getByRole("button", { name: /status/i })).not.toBeNull();
      expect(mounts).toEqual([`${prefix}:thr_a`]);
      mounts.length = 0;

      await host.switchTo("thr_b");
      expect(screen.getByText(`${prefix}:thr_b`)).not.toBeNull();
      expect(mounts).toEqual([`${prefix}:thr_b`]);

      mounts.length = 0;
      await host.switchTo("thr_c");
      expect(mounts).toEqual([`${prefix}:thr_c`]);
    },
  );

  it("shows the panel content while a thread's saved tabs load", async () => {
    let resolveTabs: (tabs: ThreadTabsResponse) => void = noop;
    vi.mocked(sdk.threads.tabs.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTabs = resolve;
        }),
    );
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <TooltipProvider>
          <PanelGroup direction="horizontal">
            <Host threadId="thr_a" activeTab={infoTab} />
          </PanelGroup>
        </TooltipProvider>
      </Wrapper>,
    );
    expect(screen.getByText("info:thr_a")).not.toBeNull();
    expect(screen.queryByTestId("secondary-panel-content-skeleton")).toBeNull();

    await act(async () => resolveTabs({ ...savedThreadTabs }));
    expect(screen.getByText("info:thr_a")).not.toBeNull();
    expect(mounts).toEqual(["info:thr_a"]);
  });

  it.each([
    ["Info", infoTab, "info"],
    ["an open file", fileTab, "file"],
    ["a plugin tab", statusTab, "status"],
  ] as const)(
    "keeps %s content mounted while a saved tab's plugin reloads",
    async (_name, activeTab, prefix) => {
      await mountHost(activeTab);
      mounts.length = 0;

      act(() => {
        setPluginFrontendReconcilePending(true);
        setLoadingPluginFrontends(["example"]);
      });
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(
        screen.queryByTestId("secondary-panel-content-skeleton"),
      ).toBeNull();

      act(() => {
        setLoadingPluginFrontends([]);
        setPluginFrontendReconcilePending(false);
      });
      expect(screen.getByText(`${prefix}:thr_a`)).not.toBeNull();
      expect(mounts).toEqual([]);
    },
  );

  it("keeps a reloaded plugin tab selected", async () => {
    await mountHost(statusTab);

    act(() => {
      setPluginFrontendReconcilePending(true);
      setLoadingPluginFrontends(["example"]);
      registerStatusPlugin();
    });
    act(() => {
      setLoadingPluginFrontends([]);
      setPluginFrontendReconcilePending(false);
    });

    expect(screen.getByText("status:thr_a")).not.toBeNull();
    expect(screen.queryByText("info:thr_a")).toBeNull();
  });
});
