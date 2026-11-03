// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalPanelTabDetail } from "@get-bb/plugin-sdk";
import type { SecondaryPanelFixedTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";
import { createAppPanelController } from "./app-fixed-tab-navigation";
import { AppNavigationHostProvider } from "./app-navigation-host";
import {
  AppPanelTabsPublisher,
  buildAppPanelTabsState,
} from "./app-panel-tabs";
import {
  createAttachmentFilePreviewFixedPanelTab,
  createBrowserFixedPanelTab,
  createNewTabFixedPanelTab,
  createPluginDetailFixedPanelTab,
  createPluginFixedPanelTab,
  createPluginPageFixedPanelTab,
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  createWorkspaceFilePreviewFixedPanelTab,
  type FixedPanelViewTab,
  type SecondaryFileFixedPanelTab,
} from "./fixed-panel-tabs-state";
import { experimental_usePanelTabs } from "./plugin-sdk-hooks";

afterEach(cleanup);

const NAV_PANEL = { kind: "nav-panel", panelId: "board" } as const;

function fixed(tab: FixedPanelViewTab): SecondaryPanelFixedTab {
  return {
    ariaLabel: tab.id,
    label: `label ${tab.id}`,
    leadingVisual: <i data-icon={tab.id} />,
    onSelect: vi.fn(),
    tab,
    title: tab.id,
  };
}

function content(
  tab: SecondaryFileFixedPanelTab,
  extra: Partial<SecondaryPanelRenderableTab> = {},
): SecondaryPanelRenderableTab {
  return {
    label: `label ${tab.id}`,
    leadingVisual: <i data-icon={tab.id} />,
    onClose: vi.fn(),
    onSelect: vi.fn(),
    renderContent: () => null,
    statusLabel: null,
    tab,
    ...extra,
  };
}

describe("panel tab details", () => {
  it.each<
    [
      string,
      SecondaryPanelFixedTab | SecondaryPanelRenderableTab,
      ExperimentalPanelTabDetail,
    ]
  >([
    ["bb's Info tab", fixed(createThreadInfoFixedPanelTab()), { kind: "info" }],
    [
      "a plugin's thread fixed tab",
      fixed(createPluginFixedPanelTab({ pluginId: "git", tabId: "diff" })),
      {
        kind: "plugin",
        pluginId: "git",
        tab: { id: "diff", context: { kind: "thread" }, availability: "fixed" },
        params: null,
      },
    ],
    [
      "a plugin page's fixed tab",
      fixed(
        createPluginPageFixedPanelTab({
          fixedTabId: "notes",
          pageId: "board",
          pluginId: "tasks",
        }),
      ),
      {
        kind: "plugin",
        pluginId: "tasks",
        tab: { id: "notes", context: NAV_PANEL, availability: "fixed" },
        params: null,
      },
    ],
    [
      "a plugin action tab, in the surface's context, with its params",
      content(
        createPluginPanelFixedPanelTab({
          actionId: "chat",
          paramsJson: '{"issue":7}',
          pluginId: "tasks",
          title: "Chat",
        }),
      ),
      {
        kind: "plugin",
        pluginId: "tasks",
        tab: { id: "chat", context: NAV_PANEL, availability: "action" },
        params: { issue: 7 },
      },
    ],
    [
      "plugin details",
      content(
        createPluginDetailFixedPanelTab({
          detailKey: "github",
          title: "GitHub",
        }),
      ),
      { kind: "plugin-details", pluginId: "github" },
    ],
    [
      "a workspace file",
      content(
        createWorkspaceFilePreviewFixedPanelTab({
          environmentId: "env_1",
          projectId: null,
          tab: {
            path: "src/app.ts",
            lineRange: null,
            source: { kind: "working-tree" },
            statusLabel: null,
          },
        }),
      ),
      { kind: "file", path: "src/app.ts" },
    ],
    [
      "an attachment",
      content(
        createAttachmentFilePreviewFixedPanelTab({
          name: "log.txt",
          path: "uploads/log.txt",
          projectId: "proj_1",
        }),
      ),
      { kind: "file", path: "uploads/log.txt" },
    ],
    [
      "a Browser page",
      content(
        createBrowserFixedPanelTab({
          environmentId: null,
          url: "http://localhost:3000",
        }),
      ),
      { kind: "browser", url: "http://localhost:3000" },
    ],
    [
      "a terminal",
      content(createTerminalFixedPanelTab({ terminalId: "term_1" })),
      { kind: "terminal", terminalId: "term_1" },
    ],
    ["a new tab", content(createNewTabFixedPanelTab()), { kind: "new-tab" }],
  ])("describes %s", (_name, tab, detail) => {
    const isFixed = !("onClose" in tab);
    const state = buildAppPanelTabsState({
      activeTabId: null,
      actionContext: NAV_PANEL,
      fixedTabs: isFixed ? [tab as SecondaryPanelFixedTab] : [],
      isOpen: true,
      tabs: isFixed ? [] : [tab as SecondaryPanelRenderableTab],
    });
    expect(state.entries.map((entry) => entry.detail)).toEqual([detail]);
  });
});

describe("panel tabs through the panel controller", () => {
  function surface(tabs: readonly SecondaryPanelRenderableTab[]) {
    const info = fixed(createThreadInfoFixedPanelTab());
    const panel = createAppPanelController(() => ({
      activeTabId: null,
      close: vi.fn(),
      destinations: [],
    }));
    const publish = (activeTabId: string | null) =>
      panel.publishTabs(
        buildAppPanelTabsState({
          activeTabId,
          actionContext: { kind: "thread" },
          fixedTabs: [info],
          isOpen: true,
          tabs,
        }),
      );
    return { info, panel, publish };
  }

  it("selects and closes through the strip's own handlers, refusing tabs without a close button", () => {
    const terminal = content(createTerminalFixedPanelTab({ terminalId: "t" }));
    const pinned = content(createNewTabFixedPanelTab(), { isPinned: true });
    const { info, panel, publish } = surface([terminal, pinned]);
    publish(info.tab.id);

    expect(panel.getTabs()).toMatchObject({
      open: true,
      selectedKey: info.tab.id,
      tabs: [
        { key: info.tab.id, closable: false },
        {
          key: terminal.tab.id,
          title: `label ${terminal.tab.id}`,
          closable: true,
        },
        { key: pinned.tab.id, closable: false },
      ],
    });
    expect(panel.selectTab(terminal.tab.id)).toBe(true);
    expect(terminal.onSelect).toHaveBeenCalledOnce();
    expect(panel.selectTab(info.tab.id)).toBe(true);
    expect(info.onSelect).toHaveBeenCalledOnce();
    expect(panel.closeTab(terminal.tab.id)).toBe(true);
    expect(terminal.onClose).toHaveBeenCalledOnce();
    expect(panel.closeTab(info.tab.id)).toBe(false);
    expect(panel.closeTab(pinned.tab.id)).toBe(false);
    expect(pinned.onClose).not.toHaveBeenCalled();
    expect(panel.selectTab("missing")).toBe(false);
  });

  it("notifies plugins only when what they can read changes", () => {
    const browser = content(
      createBrowserFixedPanelTab({ environmentId: null, url: "" }),
    );
    const { info, panel, publish } = surface([browser]);
    const listener = vi.fn();
    panel.subscribeTabs(listener);

    publish(info.tab.id);
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = panel.getTabs();
    publish(info.tab.id);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(panel.getTabs()).toBe(snapshot);
    publish(browser.tab.id);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(panel.getTabs().selectedKey).toBe(browser.tab.id);
  });

  it("gives plugin components the published tabs of their own surface, and an empty panel after it unmounts", () => {
    const terminal = content(createTerminalFixedPanelTab({ terminalId: "t" }));
    const panel = createAppPanelController(() => ({
      activeTabId: null,
      close: vi.fn(),
      destinations: [],
    }));
    function Surface({ children }: { children?: ReactNode }) {
      return (
        <AppNavigationHostProvider capabilities={{ panel }}>
          <AppPanelTabsPublisher
            publish={panel.publishTabs}
            activeTabId={terminal.tab.id}
            actionContext={{ kind: "thread" }}
            fixedTabs={[]}
            isOpen={false}
            tabs={[terminal]}
          />
          {children}
        </AppNavigationHostProvider>
      );
    }
    const { result, unmount } = renderHook(() => experimental_usePanelTabs(), {
      wrapper: Surface,
    });
    expect(result.current).toEqual({
      open: false,
      selectedKey: terminal.tab.id,
      tabs: [
        {
          key: terminal.tab.id,
          title: `label ${terminal.tab.id}`,
          status: null,
          closable: true,
          detail: { kind: "terminal", terminalId: "t" },
        },
      ],
    });

    act(() => unmount());
    expect(panel.getTabs()).toEqual({
      open: false,
      selectedKey: null,
      tabs: [],
    });
  });
});
