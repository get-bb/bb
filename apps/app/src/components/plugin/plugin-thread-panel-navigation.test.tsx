// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { BbNavigate } from "@get-bb/plugin-sdk";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPluginPaletteActions } from "@/lib/command-palette/palette-plugin-actions";
import { createPluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { runPluginMessageAction } from "@/lib/plugin-message-actions";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  resetThreadActionRegistryForTest,
  ThreadActionCollectors,
  useThreadActionEntries,
} from "@/lib/thread-actions/thread-action-registry";
import { threadListEntryActionTarget } from "@/lib/thread-actions/thread-action-target";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginContext } from "./plugin-context";
import { PluginPanelTabContent } from "./PluginPanelActions";
import {
  getActiveThreadPanelOpener,
  PluginThreadPanelNavigationProvider,
  resetActiveThreadPanelOpenerForTest,
  usePublishThreadPanelOpener,
  type PluginThreadPanelOpenHandler,
} from "./plugin-thread-panel-navigation";

function Pane({
  opener,
  isFocused,
}: {
  opener: PluginThreadPanelOpenHandler;
  isFocused: boolean;
}) {
  usePublishThreadPanelOpener(opener, isFocused);
  return null;
}

afterEach(() => {
  cleanup();
  resetActiveThreadPanelOpenerForTest();
  resetPluginSlotStoreForTest();
  resetThreadActionRegistryForTest();
});

it("publishes only the focused pane's opener", () => {
  const left = vi.fn(() => true);
  const right = vi.fn(() => true);
  const { rerender } = render(
    <>
      <Pane opener={left} isFocused={true} />
      <Pane opener={right} isFocused={false} />
    </>,
  );

  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(left).toHaveBeenCalledTimes(1);
  expect(right).not.toHaveBeenCalled();

  rerender(
    <>
      <Pane opener={left} isFocused={false} />
      <Pane opener={right} isFocused={true} />
    </>,
  );
  getActiveThreadPanelOpener()?.({ actionId: "a", pluginId: "p" });
  expect(right).toHaveBeenCalledTimes(1);
  expect(left).toHaveBeenCalledTimes(1);
});

it("reports no opener when no thread view is focused", () => {
  render(<Pane opener={vi.fn(() => true)} isFocused={false} />);
  expect(getActiveThreadPanelOpener()).toBeNull();
});

type OpenThreadPanel = BbNavigate["openThreadPanel"];

interface MountedOpener {
  pluginId: string;
  ownTabId: string | null;
  openThreadPanel: OpenThreadPanel;
}

interface OpenerSurface {
  name: string;
  mount(handler: PluginThreadPanelOpenHandler): Promise<MountedOpener>;
}

function withQueries(children: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function captureNavigate(onNavigate: (navigate: BbNavigate) => void) {
  function Capture() {
    onNavigate(useBbNavigate());
    return null;
  }
  return Capture;
}

function panelTabSurface(
  name: string,
  slot: "threadPanelActions" | "newThreadPanelActions",
  bodyPluginId: string,
): OpenerSurface {
  return {
    name,
    async mount(handler) {
      let navigate: BbNavigate | null = null;
      const Capture = captureNavigate((current) => {
        navigate = current;
      });
      function TabBody() {
        return bodyPluginId === "demo" ? (
          <Capture />
        ) : (
          <PluginContext.Provider value={bodyPluginId}>
            <Capture />
          </PluginContext.Provider>
        );
      }
      setPluginSlotRegistrations(
        "demo",
        makePluginRegistrationSet({
          [slot]: [{ id: "issue", title: "Issue", component: TabBody }],
        }),
      );
      const tab = createPluginPanelFixedPanelTab({
        pluginId: "demo",
        actionId: "issue",
        title: "Issue",
        paramsJson: null,
      });
      render(
        withQueries(
          <PluginThreadPanelNavigationProvider openThreadPanel={handler}>
            <PluginPanelTabContent
              tab={tab}
              context={
                slot === "threadPanelActions"
                  ? { kind: "thread", threadId: "thr_1" }
                  : { kind: "new-thread", projectId: null }
              }
            />
          </PluginThreadPanelNavigationProvider>,
        ),
      );
      const captured = await waitFor(() => {
        if (navigate === null) throw new Error("tab body not rendered");
        return navigate;
      });
      return {
        pluginId: bodyPluginId,
        ownTabId: bodyPluginId === "demo" ? tab.id : null,
        openThreadPanel: captured.openThreadPanel,
      };
    },
  };
}

const surfaces: readonly OpenerSurface[] = [
  panelTabSurface("a plugin's thread panel tab", "threadPanelActions", "demo"),
  panelTabSurface(
    "a plugin's New thread panel tab",
    "newThreadPanelActions",
    "demo",
  ),
  panelTabSurface(
    "another plugin's view inside that tab",
    "threadPanelActions",
    "other",
  ),
  {
    name: "a plugin view outside its panel tabs",
    async mount(handler) {
      let navigate: BbNavigate | null = null;
      const Capture = captureNavigate((current) => {
        navigate = current;
      });
      render(
        withQueries(
          <PluginThreadPanelNavigationProvider openThreadPanel={handler}>
            <PluginContext.Provider value="demo">
              <Capture />
            </PluginContext.Provider>
          </PluginThreadPanelNavigationProvider>,
        ),
      );
      const captured = await waitFor(() => {
        if (navigate === null) throw new Error("view not rendered");
        return navigate;
      });
      return {
        pluginId: "demo",
        ownTabId: null,
        openThreadPanel: captured.openThreadPanel,
      };
    },
  },
  {
    name: "a thread action",
    async mount(handler) {
      let navigate: BbNavigate | null = null;
      setPluginSlotRegistrations(
        "demo",
        makePluginRegistrationSet({
          threadActions: [
            {
              id: "details",
              title: "Details",
              icon: "Info",
              group: "5_plugin",
              item: (input) => {
                navigate = input.navigate;
                return null;
              },
            },
          ],
        }),
      );
      function FocusedThreadView() {
        usePublishThreadPanelOpener(handler, true);
        useThreadActionEntries(
          threadListEntryActionTarget(makeThreadListEntry({ id: "thr_1" })),
          {},
        );
        return null;
      }
      render(
        withQueries(
          <>
            <ThreadActionCollectors
              coreRegistrations={[]}
              requestRename={vi.fn()}
            />
            <FocusedThreadView />
          </>,
        ),
      );
      const captured = await waitFor(() => {
        if (navigate === null) throw new Error("thread action not evaluated");
        return navigate;
      });
      return {
        pluginId: "demo",
        ownTabId: null,
        openThreadPanel: captured.openThreadPanel,
      };
    },
  },
  {
    name: "a command palette action",
    async mount(handler) {
      let openThreadPanel: OpenThreadPanel | null = null;
      buildPluginPaletteActions({
        slots: [
          {
            target: "app",
            defaultShortcut: null,
            pluginId: "demo",
            generation: 1,
            id: "details",
            title: "Details",
            run: (context) => {
              openThreadPanel = context.openPanel;
            },
          },
        ],
        threadId: "thr_1",
        projectId: "proj_1",
        openThreadPanel: handler,
      })[0]?.run();
      if (openThreadPanel === null) throw new Error("palette action not run");
      return { pluginId: "demo", ownTabId: null, openThreadPanel };
    },
  },
  {
    name: "a message action",
    async mount(handler) {
      let openThreadPanel: OpenThreadPanel | null = null;
      runPluginMessageAction({
        slot: {
          pluginId: "demo",
          generation: 1,
          id: "details",
          title: "Details",
          run: (context) => {
            openThreadPanel = context.openPanel;
          },
        },
        threadId: "thr_1",
        message: {
          id: "msg_1",
          threadId: "thr_1",
          role: "assistant",
          text: "Done",
          sourceSeqEnd: 1,
          experimental_messageSeq: 1,
        },
        openThreadPanel: handler,
        composerHost: null,
      });
      if (openThreadPanel === null) throw new Error("message action not run");
      return { pluginId: "demo", ownTabId: null, openThreadPanel };
    },
  },
];

describe.each(surfaces)("$name", (surface) => {
  it("forwards only its plugin's id and the open options", async () => {
    const handler = vi.fn<PluginThreadPanelOpenHandler>(() => true);
    const { pluginId, openThreadPanel } = await surface.mount(handler);

    const opened = openThreadPanel({
      actionId: "issue",
      title: "Issue #2",
      params: { n: 2 },
      pluginId: "spoofed",
      replaceTabId: "terminal:term_1",
    } as Parameters<OpenThreadPanel>[0]);

    expect(opened).toBe(true);
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      pluginId,
      actionId: "issue",
      title: "Issue #2",
      params: { n: 2 },
    });
  });

  it("replaces the calling tab only from its plugin's own tab", async () => {
    const handler = vi.fn<PluginThreadPanelOpenHandler>(() => true);
    const { ownTabId, pluginId, openThreadPanel } =
      await surface.mount(handler);

    const replaced = openThreadPanel({
      actionId: "issue",
      title: "Issue #2",
      params: { n: 2 },
      experimental_replace: true,
    });

    expect(replaced).toBe(ownTabId !== null);
    expect(handler.mock.calls).toEqual(
      ownTabId === null
        ? []
        : [
            [
              {
                pluginId,
                actionId: "issue",
                title: "Issue #2",
                params: { n: 2 },
                replaceTabId: ownTabId,
              },
            ],
          ],
    );
  });
});
