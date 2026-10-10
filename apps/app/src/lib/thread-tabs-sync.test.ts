import { openSecondaryPanelTabInState } from "@bb/client-core";
import type { ThreadTab } from "@bb/server-contract";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { setCachedThreadTabs } from "@/hooks/cache-owners/thread-tabs-cache-owner";
import {
  createBrowserFixedPanelTab,
  createEmptyFixedPanelTabsState,
  createNewTabFixedPanelTab,
  createTerminalFixedPanelTab,
  createThreadInfoFixedPanelTab,
  type FixedPanelTab,
} from "./fixed-panel-tabs-state";
import { createPluginPageFixedPanelTab } from "./fixed-panel-tabs-state";
import {
  areThreadTabListsEquivalent,
  mergeThreadTabChanges,
  reconcileFixedPanelTabsState,
  resolveFixedPanelTabsHydration,
  scheduleThreadTabsPersistence,
} from "./thread-tabs-sync";

const updateThreadTabs = vi.hoisted(() => vi.fn());

vi.mock("./sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sdk")>();
  return {
    ...actual,
    sdk: { threads: { tabs: { update: updateThreadTabs } } },
  };
});

function browserTab(
  id: string,
  title: string,
): Extract<ThreadTab, { kind: "browser" }> {
  return {
    environmentId: null,
    id: `browser:${id}:none`,
    kind: "browser",
    title,
    url: `https://${id}.example.com`,
  };
}

describe("thread tab synchronization", () => {
  it("preserves remote additions and edits when removing a local tab", () => {
    const source = browserTab("source", "Source");
    const updatedSource = { ...source, title: "Updated elsewhere" };
    const detour = browserTab("detour", "Detour");
    const remote = browserTab("remote", "Remote");
    expect(
      mergeThreadTabChanges(
        [updatedSource, detour, remote],
        [source, detour],
        [source],
      ),
    ).toEqual([updatedSource, remote]);
  });

  it("inserts a replacement without restoring other remotely closed tabs", () => {
    const source = browserTab("source", "Source");
    const placeholder = browserTab("placeholder", "Placeholder");
    const neighbor = browserTab("neighbor", "Neighbor");
    const terminal = createTerminalFixedPanelTab({ terminalId: "replacement" });
    expect(
      mergeThreadTabChanges(
        [placeholder, neighbor],
        [source, placeholder, neighbor],
        [source, terminal, neighbor],
      ),
    ).toEqual([terminal, neighbor]);
  });

  it("keeps the server's desktop window when saving a local page update", () => {
    const closedWindow = {
      hostId: "host-1",
      instanceId: "closed-window",
      generation: "g1",
    };
    const liveWindow = {
      hostId: "host-1",
      instanceId: "live-window",
      generation: "g2",
    };
    const local = {
      ...browserTab("native", "Before"),
      id: "native-tab",
      desktopTarget: closedWindow,
    };
    const adopted = { ...local, desktopTarget: liveWindow };
    expect(
      mergeThreadTabChanges(
        [adopted],
        [local],
        [{ ...local, title: "Reopened" }],
      ),
    ).toEqual([{ ...adopted, title: "Reopened" }]);
  });

  it("keeps remote ordering unless the local operation reorders tabs", () => {
    const a = browserTab("a", "A");
    const b = browserTab("b", "B");
    const c = browserTab("c", "C");
    const remote = browserTab("remote", "Remote");
    expect(mergeThreadTabChanges([c, a, b], [a, b, c], [a, c])).toEqual([c, a]);
    expect(
      mergeThreadTabChanges([a, remote, b, c], [a, b, c], [c, a, b]),
    ).toEqual([c, remote, a, b]);
  });

  it("preserves local presentation state while adopting remote tabs", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const current = createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: {
        activeTabId: first.id,
        isOpen: true,
        tabs: [first],
      },
    });

    const withBoth = reconcileFixedPanelTabsState(current, [first, second]);
    expect(withBoth).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: first.id, isOpen: true },
    });
    expect(withBoth.secondary.tabs).toEqual([first, second]);

    const withoutActive = reconcileFixedPanelTabsState(withBoth, [second]);
    expect(withoutActive).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: second.id, isOpen: true },
    });
  });

  it("drops legacy native side-chat tabs persisted before their removal", () => {
    const browser = browserTab("first", "First");
    const legacySideChat: ThreadTab = {
      id: "side-chat:legacy",
      kind: "side-chat",
      sourceMessageText: "anchor",
      sourceSeqEnd: null,
      threadId: "thr_legacy",
      title: "Side chat",
    };
    const current = createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: { activeTabId: null, isOpen: true, tabs: [] },
    });

    const reconciled = reconcileFixedPanelTabsState(current, [
      browser,
      legacySideChat,
    ]);

    expect(reconciled.secondary.tabs).toEqual([browser]);
  });

  it("keeps plugin page fixed tabs out of thread synchronization", () => {
    const pageTab = createPluginPageFixedPanelTab({
      fixedTabId: "navigation",
      pageId: "tasks",
      pluginId: "tasks",
    });

    expect(areThreadTabListsEquivalent([pageTab], [])).toBe(true);
  });
});

it("returns to the prior terminal when another client removes the active terminal before its close callback", () => {
  const source = createTerminalFixedPanelTab({ terminalId: "source" });
  const detour = createTerminalFixedPanelTab({ terminalId: "detour" });
  const state = openSecondaryPanelTabInState({
    state: createEmptyFixedPanelTabsState({
      secondary: {
        tabs: [createThreadInfoFixedPanelTab(), source],
        activeTabId: source.id,
        isOpen: true,
      },
    }),
    tab: detour,
  });
  const reconciled = reconcileFixedPanelTabsState(state, [
    createThreadInfoFixedPanelTab(),
    source,
  ]);
  expect(reconciled.secondary.activeTabId).toBe(source.id);
});

it("does not restore a removed placeholder when a stale client closes a terminal", async () => {
  const queryClient = new QueryClient();
  const threadId = "stale-terminal-close";
  const info = createThreadInfoFixedPanelTab();
  const source = createTerminalFixedPanelTab({ terminalId: "source" });
  const detour = createTerminalFixedPanelTab({ terminalId: "detour" });
  const placeholder = createNewTabFixedPanelTab();
  setCachedThreadTabs(queryClient, threadId, {
    revision: 9,
    tabs: [info, source, detour],
  });
  updateThreadTabs.mockResolvedValue({ revision: 10, tabs: [info, source] });

  scheduleThreadTabsPersistence({
    queryClient,
    threadId,
    previousTabs: [info, source, placeholder, detour],
    tabs: [info, source, placeholder],
  });

  await vi.waitFor(() => {
    expect(updateThreadTabs).toHaveBeenCalledWith({
      expectedRevision: 9,
      tabs: [info, source],
      threadId,
    });
  });
});

describe("resolveFixedPanelTabsHydration", () => {
  const localTab = createBrowserFixedPanelTab({
    environmentId: null,
    url: "https://local.example.com",
  });
  const remoteTab = createBrowserFixedPanelTab({
    environmentId: null,
    url: "https://remote.example.com",
  });
  const openWith = (tabs: FixedPanelTab[]) =>
    createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: { activeTabId: tabs[0]?.id ?? null, isOpen: true, tabs },
    });

  it("migrates existing local tabs when the server has no tab row", () => {
    const current = openWith([localTab]);
    expect(
      resolveFixedPanelTabsHydration({
        current,
        hasPendingWrite: false,
        localTabs: current.secondary.tabs,
        server: { revision: 0, tabs: [] },
      }),
    ).toEqual({ kind: "migrate-local-tabs" });
  });

  it("adopts server tabs while keeping presentation state local", () => {
    const current = openWith([createThreadInfoFixedPanelTab()]);
    expect(
      resolveFixedPanelTabsHydration({
        current,
        hasPendingWrite: false,
        localTabs: current.secondary.tabs,
        server: { revision: 4, tabs: [remoteTab] },
      }),
    ).toEqual({
      kind: "replace",
      state: {
        ...current,
        secondary: {
          activeTabId: remoteTab.id,
          isOpen: true,
          tabs: [remoteTab],
        },
      },
    });
  });

  it("closes an open thread panel when hydration leaves no tabs", () => {
    const current = openWith([]);
    expect(
      resolveFixedPanelTabsHydration({
        current,
        hasPendingWrite: false,
        localTabs: [],
        server: { revision: 2, tabs: [] },
      }),
    ).toEqual({
      kind: "replace",
      state: {
        ...current,
        secondary: { activeTabId: null, isOpen: false, tabs: [] },
      },
    });
  });

  it("leaves a state the server already matches untouched so storage is not rewritten", () => {
    const current = openWith([remoteTab]);
    expect(
      resolveFixedPanelTabsHydration({
        current,
        hasPendingWrite: false,
        localTabs: current.secondary.tabs,
        server: { revision: 4, tabs: [remoteTab] },
      }),
    ).toBeNull();
  });
});
