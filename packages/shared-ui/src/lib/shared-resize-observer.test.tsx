// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, useState } from "react";
import { useMeasuredValue } from "../components/ui/hooks/use-measured-value";
import { observeSharedResize } from "./shared-resize-observer";

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

afterEach(() => {
  ResizeObserverStub.instances.length = 0;
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe("observeSharedResize", () => {
  it("runs every registration's read before any write within a batch", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const order: string[] = [];
    const first = document.createElement("div");
    const second = document.createElement("div");
    const unobserveFirst = observeSharedResize(first, {
      read: () => {
        order.push("read:first");
        return "first";
      },
      write: (value) => order.push(`write:${value}`),
    });
    const unobserveSecond = observeSharedResize(second, {
      read: () => {
        order.push("read:second");
        return "second";
      },
      write: (value) => order.push(`write:${value}`),
    });

    expect(ResizeObserverStub.instances).toHaveLength(1);
    lastObserver().callback(
      [makeEntry(first, 10), makeEntry(second, 20)],
      lastObserver(),
    );

    expect(order).toEqual([
      "read:first",
      "read:second",
      "write:first",
      "write:second",
    ]);
    unobserveFirst();
    unobserveSecond();
  });

  it("re-syncs every registration when a synthetic batch carries no entries", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const order: string[] = [];
    const seenEntries: (ResizeObserverEntry | undefined)[] = [];
    const targets = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    const unobservers = targets.map((target, index) =>
      observeSharedResize(target, {
        read: (entry) => {
          seenEntries.push(entry);
          order.push(`read:${index}`);
          return index;
        },
        write: (value) => order.push(`write:${value}`),
      }),
    );

    lastObserver().callback([], lastObserver());

    expect(order).toEqual(["read:0", "read:1", "write:0", "write:1"]);
    expect(seenEntries).toEqual([undefined, undefined]);
    for (const unobserve of unobservers) unobserve();
  });

  it("runs a registration once per batch however many of its targets changed", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const targets = [
      document.createElement("div"),
      document.createElement("div"),
    ];
    const writes: number[] = [];
    let reads = 0;
    const unobserve = observeSharedResize(targets, {
      read: () => ++reads,
      write: (value) => writes.push(value),
    });

    expect(lastObserver().observedTargets).toEqual(targets);
    lastObserver().callback(
      targets.map((target) => makeEntry(target, 10)),
      lastObserver(),
    );
    lastObserver().callback([], lastObserver());

    expect(writes).toEqual([1, 2]);
    unobserve();
    expect(lastObserver().disconnect).toHaveBeenCalled();
  });

  it("releases the shared observer once the last registration leaves", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const target = document.createElement("div");
    const phases = { read: () => null, write: () => {} };

    const unobserve = observeSharedResize(target, phases);
    const observer = lastObserver();
    expect(observer.observe).toHaveBeenCalledWith(target);

    unobserve();
    expect(observer.unobserve).toHaveBeenCalledWith(target);
    expect(observer.disconnect).toHaveBeenCalled();

    const unobserveAgain = observeSharedResize(target, phases);
    expect(ResizeObserverStub.instances).toHaveLength(2);
    unobserveAgain();
  });
});

function band(width: number): string {
  return width >= 500 ? "wide" : "narrow";
}

function stubClientWidth(initial: number): { current: number } {
  const width = { current: initial };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width.current,
  );
  return width;
}

function readBand(element: HTMLElement): string {
  return band(element.clientWidth);
}

describe("same-frame resize state", () => {
  it("renders React state written by a resize before the observer callback returns", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const width = stubClientWidth(700);
    function Band() {
      const ref = useRef<HTMLDivElement>(null);
      const [value, setValue] = useState("unmeasured");
      useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) return;
        setValue(readBand(element));
        return observeSharedResize(element, {
          read: () => readBand(element),
          write: setValue,
        });
      }, []);
      return <div ref={ref}>{value}</div>;
    }
    render(<Band />);
    expect(screen.getByText("wide")).toBeTruthy();

    width.current = 300;
    lastObserver().callback([], lastObserver());

    expect(screen.getByText("narrow")).toBeTruthy();
  });

  it("measures a hook target on mount and on each resize in the same frame", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const width = stubClientWidth(700);
    function Band() {
      const ref = useRef<HTMLDivElement>(null);
      const value = useMeasuredValue(ref, readBand, "unmeasured");
      return <div ref={ref}>{value}</div>;
    }
    render(<Band />);
    expect(screen.getByText("wide")).toBeTruthy();

    width.current = 300;
    lastObserver().callback([], lastObserver());
    expect(screen.getByText("narrow")).toBeTruthy();

    width.current = 900;
    lastObserver().callback([], lastObserver());
    expect(screen.getByText("wide")).toBeTruthy();
  });
});
