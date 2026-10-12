import { describe, expect, it, vi } from "vitest";
import type { DesktopBrowserChanged } from "@bb/host-daemon-contract";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  WebContentsView: class {},
  session: { fromPartition: () => ({}) },
  nativeImage: { createFromBuffer: () => ({}) },
}));

import { createDesktopBrowserBroker } from "../src/desktop-browser-broker.js";
import type {
  DesktopBrowserNativeTab,
  DesktopBrowserViewManager,
} from "../src/desktop-browser-view.js";

const ORIGIN_A = "http://127.0.0.1:38886";
const ORIGIN_B = "https://studio.tailnet.ts.net:38886";
const THREAD_A = "thr_23456789ab";
const THREAD_B = "thr_3456789abc";

function nativeTab(tabId: string, threadId: string): DesktopBrowserNativeTab {
  return {
    tabId,
    threadId,
    url: "https://example.com",
    title: "Example",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    generation: "tab-generation",
    presentation: "reveal",
  };
}

function createFakeManager() {
  const tabs = new Map<number, DesktopBrowserNativeTab[]>();
  const released: number[] = [];
  let notifyTabsChanged: () => void = () => undefined;
  const manager: Pick<
    DesktopBrowserViewManager,
    "listTabs" | "releaseWindow" | "subscribeAutomationTabs"
  > = {
    listTabs: ({ hostWebContentsId, threadId }) =>
      (tabs.get(hostWebContentsId) ?? []).filter(
        (tab) => threadId === null || tab.threadId === threadId,
      ),
    releaseWindow: (hostWebContentsId) => {
      released.push(hostWebContentsId);
      tabs.delete(hostWebContentsId);
      notifyTabsChanged();
    },
    subscribeAutomationTabs: (listener) => {
      notifyTabsChanged = listener;
      return () => undefined;
    },
  };
  return {
    manager: manager as DesktopBrowserViewManager,
    released,
    tabs,
  };
}

function createFakeWindow(webContentsId: number) {
  return {
    webContents: {
      id: webContentsId,
      isDestroyed: () => false,
      send: vi.fn(),
    },
    isDestroyed: () => false,
    isFocused: () => true,
    once: () => undefined,
    focus: () => undefined,
    show: () => undefined,
    restore: () => undefined,
    isMinimized: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    contentView: {
      addChildView: () => undefined,
      removeChildView: () => undefined,
    },
  };
}

describe("desktop browser broker server origins", () => {
  it("lists, publishes, and runs commands only for windows on the asking server", async () => {
    const { manager, tabs } = createFakeManager();
    tabs.set(1, [nativeTab("tab-a", THREAD_A)]);
    tabs.set(2, [nativeTab("tab-b", THREAD_B)]);
    const broker = createDesktopBrowserBroker({ manager, product: "Chrome/1" });
    const eventsA: DesktopBrowserChanged[] = [];
    const eventsB: DesktopBrowserChanged[] = [];
    broker.subscribe(ORIGIN_A, (event) => eventsA.push(event));
    broker.subscribe(ORIGIN_B, (event) => eventsB.push(event));
    broker.registerWindow(createFakeWindow(1), ORIGIN_A);
    broker.registerWindow(createFakeWindow(2), ORIGIN_B);
    broker.setHostId(ORIGIN_A, "host-a");
    broker.setHostId(ORIGIN_B, "host-b");

    const instancesA = broker.listInstances(ORIGIN_A);
    const instancesB = broker.listInstances(ORIGIN_B);
    expect(instancesA).toHaveLength(1);
    expect(instancesB).toHaveLength(1);
    const [instanceA] = instancesA;
    const [instanceB] = instancesB;
    if (!instanceA || !instanceB) throw new Error("Expected two instances");
    expect(
      new Set(
        eventsA.map((event) => [event.instanceId, event.threadId].join()),
      ),
    ).toEqual(new Set([[instanceA.instanceId, THREAD_A].join()]));
    expect(
      new Set(
        eventsB.map((event) => [event.instanceId, event.threadId].join()),
      ),
    ).toEqual(new Set([[instanceB.instanceId, THREAD_B].join()]));
    await expect(
      broker.execute(ORIGIN_A, { type: "desktop.browser.list_instances" }),
    ).resolves.toEqual({ instances: [instanceA] });
    await expect(
      broker.execute(ORIGIN_A, {
        type: "desktop.browser.list_tabs",
        instanceId: instanceB.instanceId,
        generation: instanceB.generation,
        threadId: THREAD_B,
      }),
    ).rejects.toThrow("unavailable");
    await expect(
      broker.execute(ORIGIN_B, {
        type: "desktop.browser.list_tabs",
        instanceId: instanceB.instanceId,
        generation: instanceB.generation,
        threadId: THREAD_B,
      }),
    ).resolves.toMatchObject({ tabs: [{ tabId: "tab-b" }] });
    broker.dispose();
  });

  it("moves a window to another server by closing only its tabs and fencing its old target", async () => {
    const { manager, released, tabs } = createFakeManager();
    tabs.set(1, [nativeTab("tab-a", THREAD_A)]);
    tabs.set(2, [nativeTab("tab-other", THREAD_A)]);
    const broker = createDesktopBrowserBroker({ manager, product: "Chrome/1" });
    broker.registerWindow(createFakeWindow(1), ORIGIN_A);
    broker.registerWindow(createFakeWindow(2), ORIGIN_A);
    broker.setHostId(ORIGIN_A, "host-a");
    const before = broker.getTarget(1);
    const other = broker.getTarget(2);
    if (!before || !other) throw new Error("Expected connected windows");
    await broker.execute(ORIGIN_A, {
      type: "desktop.browser.acquire_control",
      instanceId: before.instanceId,
      generation: before.generation,
      threadId: THREAD_A,
      leaseId: "lease",
      tabIds: ["tab-a"],
      controllerLabel: "Agent",
      expiresAt: Date.now() + 60_000,
    });
    expect(broker.getControl(1, "tab-a")?.control?.leaseId).toBe("lease");
    const registryChanged = vi.fn();
    broker.subscribeInstances(registryChanged);

    broker.setWindowServer(1, ORIGIN_B);

    expect(released).toEqual([1]);
    expect(broker.getControl(1, "tab-a")).toBeNull();
    expect(tabs.get(2)).toHaveLength(1);
    expect(registryChanged).toHaveBeenCalledTimes(1);
    expect(broker.listInstances(ORIGIN_A)).toEqual([
      {
        instanceId: other.instanceId,
        generation: other.generation,
        label: expect.any(String),
      },
    ]);
    const [moved] = broker.listInstances(ORIGIN_B);
    expect(moved?.instanceId).toBe(before.instanceId);
    expect(moved?.generation).not.toBe(before.generation);
    expect(broker.getTarget(1)).toBeNull();
    await expect(
      broker.execute(ORIGIN_A, {
        type: "desktop.browser.list_tabs",
        instanceId: before.instanceId,
        generation: before.generation,
        threadId: THREAD_A,
      }),
    ).rejects.toThrow("unavailable");

    broker.setWindowServer(1, ORIGIN_B);
    expect(released).toEqual([1]);
    expect(registryChanged).toHaveBeenCalledTimes(1);
    broker.dispose();
  });

  it("reports each window's target with its own server's host", () => {
    const { manager } = createFakeManager();
    const broker = createDesktopBrowserBroker({ manager, product: "Chrome/1" });
    broker.registerWindow(createFakeWindow(1), ORIGIN_A);
    broker.registerWindow(createFakeWindow(2), ORIGIN_B);
    broker.setHostId(ORIGIN_A, "host-a");
    broker.setHostId(ORIGIN_B, "host-b");
    expect(broker.getTarget(1)?.hostId).toBe("host-a");
    const targetB = broker.getTarget(2);
    expect(targetB?.hostId).toBe("host-b");

    broker.setHostId(ORIGIN_A, null);

    expect(broker.getTarget(1)).toBeNull();
    expect(broker.getTarget(2)).toEqual(targetB);
    broker.dispose();
  });
});
