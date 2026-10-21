// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpandablePanel } from "@/components/ui/disclosure";
import {
  observeSharedResize,
  type SharedResizePhases,
  type SharedResizeSubscription,
} from "./shared-resize-observer";

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = [];

  readonly observedTargets: Element[] = [];

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe: ResizeObserver["observe"] = vi.fn((target: Element) => {
    this.observedTargets.push(target);
  });
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

const frames = new Map<number, FrameRequestCallback>();
const subscriptions: SharedResizeSubscription[] = [];
let nextFrame = 0;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  for (const subscription of subscriptions) subscription.disconnect();
  subscriptions.length = 0;
  frames.clear();
  ResizeObserverStub.instances.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function observe<T>(target: Element, phases: SharedResizePhases<T>) {
  const subscription = observeSharedResize(target, phases);
  subscriptions.push(subscription);
  return subscription;
}

function flushFrame() {
  const batch = [...frames.keys()];
  act(() => {
    for (const id of batch) {
      const callback = frames.get(id);
      frames.delete(id);
      callback?.(0);
    }
  });
}

function lastObserver(): ResizeObserverStub {
  const observer = ResizeObserverStub.instances.at(-1);
  if (!observer) {
    throw new Error("No ResizeObserver was installed");
  }
  return observer;
}

function makeEntry(target: Element, blockSize: number): ResizeObserverEntry {
  return {
    target,
    contentRect: new DOMRect(0, 0, 200, blockSize),
    borderBoxSize: [{ blockSize, inlineSize: 200 }],
    contentBoxSize: [{ blockSize, inlineSize: 200 }],
    devicePixelContentBoxSize: [{ blockSize, inlineSize: 200 }],
  };
}

function deliver(...entries: ResizeObserverEntry[]) {
  const observer = lastObserver();
  observer.callback(entries, observer);
}

describe("observeSharedResize", () => {
  it("commits only the latest size outside observer delivery", () => {
    const target = document.createElement("div");
    const heights: number[] = [];
    observe(target, {
      read: (entry) => entry?.borderBoxSize[0]?.blockSize,
      write: (height) => {
        if (height !== undefined) heights.push(height);
      },
    });

    deliver(makeEntry(target, 10));
    deliver(makeEntry(target, 20));

    expect(heights).toEqual([]);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(heights).toEqual([20]);
  });

  it("runs every registration's read before any write within a batch", () => {
    const order: string[] = [];
    const first = document.createElement("div");
    const second = document.createElement("div");
    const unobserveFirst = observe(first, {
      read: () => {
        order.push("read:first");
        return "first";
      },
      write: (value) => order.push(`write:${value}`),
    });
    const unobserveSecond = observe(second, {
      read: () => {
        order.push("read:second");
        return "second";
      },
      write: (value) => order.push(`write:${value}`),
    });

    expect(ResizeObserverStub.instances).toHaveLength(1);
    deliver(makeEntry(first, 10), makeEntry(second, 20));
    expect(order).toEqual(["read:first", "read:second"]);
    flushFrame();
    expect(order).toEqual([
      "read:first",
      "read:second",
      "write:first",
      "write:second",
    ]);
    unobserveFirst.disconnect();
    unobserveSecond.disconnect();
  });

  it("re-syncs every registration when a synthetic batch carries no entries", () => {
    const order: string[] = [];
    const seenEntries: (ResizeObserverEntry | undefined)[] = [];
    const targets = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    const unobservers = targets.map((target, index) =>
      observe(target, {
        read: (entry) => {
          seenEntries.push(entry);
          order.push(`read:${index}`);
          return index;
        },
        write: (value) => order.push(`write:${value}`),
      }),
    );

    deliver();
    flushFrame();
    expect(order).toEqual(["read:0", "read:1", "write:0", "write:1"]);
    expect(seenEntries).toEqual([undefined, undefined]);
    for (const unobserve of unobservers) unobserve.disconnect();
  });

  it("coalesces independently for registrations sharing a target", () => {
    const target = document.createElement("div");
    const latest: number[] = [];
    const totals: number[] = [];
    const read = (entry: ResizeObserverEntry | undefined) =>
      entry?.contentRect.height ?? 0;
    const first = observe(target, {
      read,
      write: (value) => latest.push(value),
    });
    observe(target, {
      read,
      write: (value) => totals.push(value),
      coalesce: (previous, value) => previous + value,
    });
    expect(lastObserver().observe).toHaveBeenCalledTimes(1);
    deliver(makeEntry(target, 10));
    deliver(makeEntry(target, 20));
    flushFrame();
    expect(latest).toEqual([20]);
    expect(totals).toEqual([30]);
    first.disconnect();
    expect(lastObserver().unobserve).not.toHaveBeenCalled();
    deliver(makeEntry(target, 5));
    flushFrame();
    expect(totals).toEqual([30, 5]);
  });

  it("discards queued work without ending observation and cancels an empty frame", () => {
    const target = document.createElement("div");
    const writes = vi.fn();
    const subscription = observe(target, {
      read: (entry) => entry?.contentRect.height,
      write: writes,
    });
    deliver(makeEntry(target, 10));
    subscription.discardPending();
    subscription.discardPending();
    expect(frames.size).toBe(0);
    flushFrame();
    expect(writes).not.toHaveBeenCalled();
    deliver(makeEntry(target, 20));
    flushFrame();
    expect(writes.mock.calls).toEqual([[20]]);
  });

  it.each([
    { phase: "read", action: "discardPending" },
    { phase: "write", action: "discardPending" },
    { phase: "read", action: "disconnect" },
    { phase: "write", action: "disconnect" },
  ] as const)(
    "invalidates another registration with $action from a $phase even after batch selection",
    ({ phase, action }) => {
      const first = document.createElement("div");
      const second = document.createElement("div");
      const readSecond = vi.fn(
        (entry: ResizeObserverEntry | undefined) => entry?.contentRect.height,
      );
      const writeSecond = vi.fn();
      const cancelSecond = () => secondSubscription[action]();
      observe(first, {
        read: () => {
          if (phase === "read") cancelSecond();
          return 10;
        },
        write: () => {
          if (phase === "write") cancelSecond();
        },
      });
      const secondSubscription = observe(second, {
        read: readSecond,
        write: writeSecond,
      });
      deliver(makeEntry(first, 10), makeEntry(second, 20));
      flushFrame();
      expect(readSecond).toHaveBeenCalledTimes(phase === "read" ? 0 : 1);
      expect(writeSecond).not.toHaveBeenCalled();
      deliver(makeEntry(second, 30));
      flushFrame();
      expect(writeSecond.mock.calls).toEqual(
        action === "disconnect" ? [] : [[30]],
      );
    },
  );

  it.each(["discardPending", "disconnect"] as const)(
    "does not enqueue work invalidated by %s during its own read",
    (action) => {
      const target = document.createElement("div");
      const write = vi.fn();
      const subscription = observe(target, {
        read: () => {
          subscription[action]();
          return 10;
        },
        write,
      });
      deliver(makeEntry(target, 10));
      expect(frames.size).toBe(0);
      flushFrame();
      expect(write).not.toHaveBeenCalled();
      expect(lastObserver().disconnect).toHaveBeenCalledTimes(
        action === "disconnect" ? 1 : 0,
      );
    },
  );

  it("does not restamp an older selection after a nested newer delivery", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const values: number[] = [];
    const read = vi.fn(
      (entry: ResizeObserverEntry | undefined) =>
        entry?.contentRect.height ?? 0,
    );
    observe(first, {
      read: () => deliver(makeEntry(second, 30)),
      write: () => {},
    });
    observe(second, { read, write: (value) => values.push(value) });
    deliver(makeEntry(first, 10), makeEntry(second, 20));
    flushFrame();
    expect(read).toHaveBeenCalledTimes(1);
    expect(values).toEqual([30]);
  });

  it("defers new work produced during a flush and skips superseded detached writes", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const values: number[] = [];
    observe(first, {
      read: () => null,
      write: () => deliver(makeEntry(second, 30)),
    });
    observe(second, {
      read: (entry) => entry?.contentRect.height ?? 0,
      write: (value) => values.push(value),
    });
    deliver(makeEntry(first, 10), makeEntry(second, 20));
    flushFrame();
    expect(values).toEqual([]);
    expect(frames.size).toBe(1);
    flushFrame();
    expect(values).toEqual([30]);
  });

  it("releases the shared observer once the last registration leaves and rejects retired deliveries", () => {
    const target = document.createElement("div");
    const write = vi.fn();
    const phases = { read: () => null, write };
    const unobserve = observe(target, phases);
    const observer = lastObserver();
    expect(observer.observe).toHaveBeenCalledWith(target);
    deliver(makeEntry(target, 10));
    unobserve.disconnect();
    unobserve.disconnect();
    expect(observer.unobserve).toHaveBeenCalledWith(target);
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);

    const unobserveAgain = observe(target, phases);
    expect(ResizeObserverStub.instances).toHaveLength(2);
    observer.callback([makeEntry(target, 20)], observer);
    observer.callback([], observer);
    flushFrame();
    expect(write).not.toHaveBeenCalled();
    deliver(makeEntry(target, 30));
    flushFrame();
    expect(write).toHaveBeenCalledTimes(1);
    unobserveAgain.disconnect();
  });

  it.each(["read", "write"] as const)("propagates %s errors", (phase) => {
    const target = document.createElement("div");
    const error = new Error(`failed ${phase}`);
    observe(target, {
      read: () => {
        if (phase === "read") throw error;
        return 10;
      },
      write: () => {
        throw error;
      },
    });
    if (phase === "read") {
      expect(() => deliver(makeEntry(target, 10))).toThrow(error);
    } else {
      deliver(makeEntry(target, 10));
      expect(flushFrame).toThrow(error);
    }
  });
});

describe("ExpandablePanel on the shared observer", () => {
  function renderTwoPanels() {
    return render(
      <>
        <ExpandablePanel
          isExpanded
          summaryContent="First tool call"
          headerToneClass="text-foreground"
          collapsedContent={<span>First summary</span>}
        >
          <span>First body</span>
        </ExpandablePanel>
        <ExpandablePanel
          isExpanded
          summaryContent="Second tool call"
          headerToneClass="text-foreground"
          collapsedContent={<span>Second summary</span>}
        >
          <span>Second body</span>
        </ExpandablePanel>
      </>,
    );
  }

  it("mounts many panels onto one observer and sizes each from its own entry", () => {
    const view = renderTwoPanels();
    expect(ResizeObserverStub.instances).toHaveLength(1);
    expect(lastObserver().observedTargets).toHaveLength(2);
    const regionOf = (text: string) => {
      const region =
        view.getByText(text).parentElement?.parentElement?.parentElement;
      if (!region) throw new Error("Panel body region was not rendered");
      return region;
    };
    const firstRegion = regionOf("First body");
    const secondRegion = regionOf("Second body");
    const [firstTarget, secondTarget] = lastObserver().observedTargets;
    if (!firstTarget || !secondTarget) {
      throw new Error("Panel bodies were not observed");
    }
    act(() => deliver(makeEntry(firstTarget, 40), makeEntry(secondTarget, 60)));
    flushFrame();
    expect(firstRegion.style.height).toBe("40px");
    expect(secondRegion.style.height).toBe("60px");
  });
});
