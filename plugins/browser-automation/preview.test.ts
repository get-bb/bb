import { describe, expect, it, vi } from "vitest";
import { createPreview, type PreviewSocket } from "./preview.js";

interface FakePage {
  targetId: string;
  type: string;
  url: string;
  title: string;
}

function createFakeBrowser(initial: FakePage[]) {
  const pages = new Map(initial.map((page) => [page.targetId, page]));
  const sessions = new Map<string, string>();
  const acks: number[] = [];
  const casts: { targetId: string; session: string; maxWidth: number }[] = [];
  const connections: FakeSocket[] = [];
  let nextSession = 0;
  let nextFrame = 0;

  class FakeSocket implements PreviewSocket {
    readyState = 0;
    private listeners = new Map<
      string,
      ((event: { data: unknown }) => void)[]
    >();
    addEventListener(
      type: string,
      listener: (event: { data: unknown }) => void,
    ): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type: string, data: unknown = null) {
      for (const listener of this.listeners.get(type) ?? []) listener({ data });
    }
    event(method: string, params: unknown, sessionId?: string) {
      if (this.readyState !== 1) return;
      this.emit("message", JSON.stringify({ method, params, sessionId }));
    }
    send(raw: string) {
      const message = JSON.parse(raw) as {
        id: number;
        method: string;
        params: {
          targetId?: string;
          sessionId?: string | number;
          maxWidth?: number;
        };
        sessionId?: string;
      };
      queueMicrotask(() => {
        let result: unknown = {};
        if (message.method === "Target.setDiscoverTargets") {
          for (const page of pages.values())
            this.event("Target.targetCreated", { targetInfo: page });
        } else if (message.method === "Target.attachToTarget") {
          const sessionId = `session-${++nextSession}`;
          sessions.set(sessionId, message.params.targetId!);
          result = { sessionId };
        } else if (message.method === "Target.getTargetInfo") {
          result = { targetInfo: pages.get(message.params.targetId!) };
        } else if (message.method === "Target.detachFromTarget") {
          sessions.delete(String(message.params.sessionId));
        } else if (message.method === "Page.screencastFrameAck") {
          acks.push(Number(message.params.sessionId));
        }
        if (this.readyState !== 1) return;
        this.emit("message", JSON.stringify({ id: message.id, result }));
        if (message.method === "Page.startScreencast") {
          casts.push({
            targetId: sessions.get(message.sessionId!)!,
            session: message.sessionId!,
            maxWidth: message.params.maxWidth!,
          });
          browser.frame(sessions.get(message.sessionId!)!);
        }
      });
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit("close");
    }
  }

  const browser = {
    acks,
    casts,
    connections,
    open(): PreviewSocket {
      const socket = new FakeSocket();
      connections.push(socket);
      queueMicrotask(() => {
        socket.readyState = 1;
        socket.emit("open");
      });
      return socket;
    },
    live: () => connections.filter((socket) => socket.readyState === 1),
    castTargets: () => [...sessions.values()],
    frame(targetId: string, data = `frame-${++nextFrame}`) {
      for (const [sessionId, target] of sessions)
        if (target === targetId)
          for (const socket of browser.live())
            socket.event(
              "Page.screencastFrame",
              {
                data,
                sessionId: nextFrame,
                metadata: { deviceWidth: 1280, deviceHeight: 720 },
              },
              sessionId,
            );
    },
    update(page: FakePage, method: string | null = "Target.targetInfoChanged") {
      pages.set(page.targetId, page);
      if (method === null) return;
      for (const socket of browser.live())
        socket.event(method, { targetInfo: page });
    },
    destroy(targetId: string) {
      pages.delete(targetId);
      for (const [sessionId, target] of sessions)
        if (target === targetId) sessions.delete(sessionId);
      for (const socket of browser.live())
        socket.event("Target.targetDestroyed", { targetId });
    },
  };
  return browser;
}

const blank: FakePage = {
  targetId: "blank",
  type: "page",
  url: "about:blank",
  title: "",
};
const shop: FakePage = {
  targetId: "shop",
  type: "page",
  url: "https://shop.test/cart",
  title: "Cart",
};
const timing = {
  frameIntervalMs: 5,
  idleMs: 60,
  reconnectMs: 5,
  fullSizeHoldMs: 40,
  settleMs: 40,
};
const never = new AbortController().signal;

describe("live preview", () => {
  it("streams frames of the navigated page, long-polls, and throttles acks", async () => {
    const browser = createFakeBrowser([
      blank,
      shop,
      { ...shop, targetId: "worker", type: "service_worker" },
    ]);
    const preview = createPreview("ws://127.0.0.1:1/x", timing, browser.open);
    const first = await preview.next(0, 1_000, never, "thumbnail");
    expect(first).toMatchObject({
      sequence: 1,
      mimeType: "image/jpeg",
      data: "frame-1",
      width: 1280,
      height: 720,
      url: shop.url,
      title: "Cart",
    });
    expect(browser.castTargets()).toEqual(["shop"]);
    expect(
      await preview.next(first!.sequence, 20, never, "thumbnail"),
    ).toBeNull();
    const pending = preview.next(first!.sequence, 1_000, never, "thumbnail");
    browser.frame("shop");
    expect(await pending).toMatchObject({ sequence: 2, data: "frame-2" });
    expect(await preview.next(0, 1_000, never, "thumbnail")).toMatchObject({
      sequence: 2,
    });
    await vi.waitFor(() => expect(browser.acks).toEqual([1, 2]));
    preview.close();
  });

  it("follows the most recently navigated page and refreshes its title", async () => {
    const browser = createFakeBrowser([blank]);
    const preview = createPreview("ws://127.0.0.1:1/x", timing, browser.open);
    const initial = await preview.next(0, 1_000, never, "thumbnail");
    expect(initial).toMatchObject({ url: "about:blank" });
    browser.update(
      { ...shop, url: "about:blank", title: "" },
      "Target.targetCreated",
    );
    browser.update({ ...shop, title: "" });
    const navigated = await preview.next(
      initial!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    expect(navigated).toMatchObject({ url: shop.url, title: "" });
    expect(browser.castTargets()).toEqual(["shop"]);
    browser.update(shop);
    const titled = await preview.next(
      navigated!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    expect(titled).toMatchObject({ title: "Cart", data: navigated!.data });
    browser.update({ ...shop, title: "Checkout" }, null);
    browser.frame("shop");
    let silent = await preview.next(
      titled!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    if (silent!.title !== "Checkout")
      silent = await preview.next(silent!.sequence, 1_000, never, "thumbnail");
    expect(silent).toMatchObject({ url: shop.url, title: "Checkout" });
    browser.destroy("shop");
    await vi.waitFor(() => expect(browser.castTargets()).toEqual(["blank"]));
    const fallback = await preview.next(
      silent!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    expect(fallback).toMatchObject({ url: "about:blank" });
    preview.close();
  });

  it("picks up a title that settles after the last frame of a static page", async () => {
    const browser = createFakeBrowser([{ ...shop, title: "shop.test/cart" }]);
    const preview = createPreview(
      "ws://127.0.0.1:1/x",
      { ...timing, idleMs: 5_000 },
      browser.open,
    );
    const loading = await preview.next(0, 1_000, never, "thumbnail");
    expect(loading).toMatchObject({ title: "shop.test/cart" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    browser.update(shop, null);
    const settled = await preview.next(
      loading!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    expect(settled).toMatchObject({ title: "Cart", data: loading!.data });
    preview.close();
  });

  it("recasts the same page at full size on request, then returns to thumbnails", async () => {
    const browser = createFakeBrowser([shop]);
    const preview = createPreview(
      "ws://127.0.0.1:1/x",
      { ...timing, idleMs: 5_000 },
      browser.open,
    );
    const thumbnail = await preview.next(0, 1_000, never, "thumbnail");
    const full = await preview.next(thumbnail!.sequence, 1_000, never, "full");
    expect(full!.sequence).toBeGreaterThan(thumbnail!.sequence);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const back = await preview.next(full!.sequence, 1_000, never, "thumbnail");
    expect(back!.sequence).toBeGreaterThan(full!.sequence);
    expect(browser.casts.map((cast) => cast.maxWidth)).toEqual([
      800, 1280, 800,
    ]);
    expect(new Set(browser.casts.map((cast) => cast.session)).size).toBe(1);
    expect(browser.connections).toHaveLength(1);
    preview.close();
  });

  it("stops casting when nobody is watching and resumes on demand", async () => {
    const browser = createFakeBrowser([shop]);
    const preview = createPreview("ws://127.0.0.1:1/x", timing, browser.open);
    const first = await preview.next(0, 1_000, never, "thumbnail");
    await vi.waitFor(() => expect(browser.live()).toHaveLength(0));
    const resumed = await preview.next(
      first!.sequence,
      1_000,
      never,
      "thumbnail",
    );
    expect(resumed!.sequence).toBeGreaterThan(first!.sequence);
    expect(browser.connections).toHaveLength(2);
    preview.close();
  });

  it("recovers from a dropped browser connection", async () => {
    const browser = createFakeBrowser([shop]);
    const preview = createPreview("ws://127.0.0.1:1/x", timing, browser.open);
    const first = await preview.next(0, 1_000, never, "thumbnail");
    browser.live()[0]!.close();
    const next = await preview.next(first!.sequence, 1_000, never, "thumbnail");
    expect(next!.sequence).toBeGreaterThan(first!.sequence);
    preview.close();
  });

  it("rejects waiting consumers on cancellation and close", async () => {
    const browser = createFakeBrowser([]);
    const preview = createPreview("ws://127.0.0.1:1/x", timing, browser.open);
    const controller = new AbortController();
    const cancelled = preview.next(0, 1_000, controller.signal, "thumbnail");
    const closed = preview.next(0, 1_000, never, "thumbnail");
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled");
    preview.close();
    await expect(closed).rejects.toThrow("stopped");
    await expect(preview.next(0, 10, never, "thumbnail")).rejects.toThrow(
      "stopped",
    );
    expect(browser.live()).toHaveLength(0);
  });
});
