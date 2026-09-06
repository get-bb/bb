import { describe, expect, it } from "vitest";
import { createDesktopBrowserBroker } from "../src/desktop-browser-broker.js";
import type { DesktopBrowserViewManager } from "../src/desktop-browser-view.js";

type Broker = ReturnType<typeof createDesktopBrowserBroker>;
type BrokerWindow = Parameters<Broker["registerWindow"]>[0];

interface FakeWindow {
  destroyed: boolean;
  window: BrokerWindow;
}

function createFakeWindow(webContentsId: number): FakeWindow {
  const state = { destroyed: false };
  const window = {
    contentView: { addChildView() {}, removeChildView() {} },
    getContentBounds: () => ({ width: 1280, height: 720 }),
    isDestroyed: () => state.destroyed,
    get webContents() {
      if (state.destroyed) {
        throw new TypeError("Object has been destroyed");
      }
      return {
        id: webContentsId,
        isDestroyed: () => false,
        send() {},
      };
    },
    focus() {},
    show() {},
    restore() {},
    isMinimized: () => false,
  };
  return {
    get destroyed() {
      return state.destroyed;
    },
    set destroyed(value: boolean) {
      state.destroyed = value;
    },
    window: window as unknown as BrokerWindow,
  };
}

function createStubManager(): DesktopBrowserViewManager {
  return {
    listTabs: () => [],
    subscribeAutomationTabs: () => () => undefined,
    destroyAll() {},
  } as unknown as DesktopBrowserViewManager;
}

describe("desktop browser broker with a destroyed window", () => {
  it("releases a window while a sibling window is already destroyed", () => {
    const broker = createDesktopBrowserBroker({
      manager: createStubManager(),
      product: "Chrome/test",
    });
    const first = createFakeWindow(1);
    const second = createFakeWindow(2);
    broker.registerWindow(first.window);
    broker.registerWindow(second.window);
    expect(broker.listInstances()).toHaveLength(2);

    first.destroyed = true;

    expect(() => broker.releaseWindow(2)).not.toThrow();
    expect(broker.listInstances()).toHaveLength(0);
  });

  it("releases a window that is itself already destroyed", () => {
    const broker = createDesktopBrowserBroker({
      manager: createStubManager(),
      product: "Chrome/test",
    });
    const only = createFakeWindow(7);
    broker.registerWindow(only.window);
    expect(broker.listInstances()).toHaveLength(1);

    only.destroyed = true;

    expect(() => broker.releaseWindow(7)).not.toThrow();
    expect(broker.listInstances()).toHaveLength(0);
  });

  it("ignores a window that is destroyed before it registers", () => {
    const broker = createDesktopBrowserBroker({
      manager: createStubManager(),
      product: "Chrome/test",
    });
    const window = createFakeWindow(9);
    window.destroyed = true;

    expect(() => broker.registerWindow(window.window)).not.toThrow();
    expect(broker.listInstances()).toHaveLength(0);
  });
});
