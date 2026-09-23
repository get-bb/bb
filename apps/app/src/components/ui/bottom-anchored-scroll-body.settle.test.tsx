// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { settleScrollElementIntoView } from "./bottom-anchored-scroll-body";

afterEach(() => {
  vi.unstubAllGlobals();
});

function rect({ bottom, top }: { bottom: number; top: number }): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top,
    width: 100,
    x: 0,
    y: top,
  };
}

interface SettleHarness {
  row: HTMLElement;
  scrollElement: HTMLElement;
  setScrollTop: (value: number) => void;
  writes: number[];
}

function createHarness({
  clientHeight,
  rowHeight,
  rowTop,
  rowTopAfterFirstWrite,
  scrollHeight,
  snapScrollTop = (value) => value,
}: {
  clientHeight: number;
  rowHeight: number;
  rowTop: number;
  rowTopAfterFirstWrite?: number;
  scrollHeight: number;
  snapScrollTop?: (value: number) => number;
}): SettleHarness {
  const scrollElement = document.createElement("div");
  const maxScrollOffset = Math.max(0, scrollHeight - clientHeight);
  const writes: number[] = [];
  let scrollTop = 0;
  const setScrollTop = (value: number) => {
    scrollTop = snapScrollTop(Math.min(Math.max(0, value), maxScrollOffset));
  };
  Object.defineProperty(scrollElement, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  Object.defineProperty(scrollElement, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scrollElement, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      writes.push(value);
      setScrollTop(value);
    },
  });
  scrollElement.getBoundingClientRect = () =>
    rect({ bottom: clientHeight, top: 0 });
  const row = document.createElement("div");
  row.getBoundingClientRect = () => {
    const top =
      writes.length > 0 && rowTopAfterFirstWrite !== undefined
        ? rowTopAfterFirstWrite
        : rowTop;
    return rect({ bottom: top + rowHeight - scrollTop, top: top - scrollTop });
  };
  scrollElement.append(row);
  return { row, scrollElement, setScrollTop, writes };
}

function stubFrameQueue(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return frames;
}

async function runNextFrame(frames: FrameRequestCallback[]): Promise<void> {
  const callback = frames.shift();
  callback?.(0);
  await Promise.resolve();
  await Promise.resolve();
}

describe("settleScrollElementIntoView", () => {
  it("settles a row whose first reveal landed short", async () => {
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 240,
      scrollHeight: 2_000,
    });

    await settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
    });

    expect(harness.scrollElement.scrollTop).toBe(240);
    expect(harness.writes).toEqual([240]);
  });

  it("terminates for a last row that cannot scroll to the top", async () => {
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 500,
      scrollHeight: 400,
    });

    await settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
    });

    expect(harness.scrollElement.scrollTop).toBe(200);
    expect(harness.writes).toEqual([200]);
  });

  it("does not write when the row is already fully visible", async () => {
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 0,
      scrollHeight: 2_000,
    });

    await settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
    });

    expect(harness.writes).toEqual([]);
  });

  it("keeps settling when the browser snaps a written scroll position", async () => {
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 240.3,
      rowTopAfterFirstWrite: 420.3,
      scrollHeight: 2_000,
      snapScrollTop: (value) => Math.round(value * 2) / 2,
    });

    await settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
    });

    expect(harness.writes).toEqual([240.3, 420.3]);
    expect(harness.scrollElement.scrollTop).toBe(420.5);
  });

  it("stops when the reader scrolls between attempts", async () => {
    const frames = stubFrameQueue();
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 240,
      scrollHeight: 2_000,
    });
    const settled = settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
    });

    await runNextFrame(frames);
    expect(harness.writes).toEqual([240]);

    harness.setScrollTop(50);
    const writesBeforeUserScroll = harness.writes.length;
    await runNextFrame(frames);

    expect(harness.writes.length).toBe(writesBeforeUserScroll);
    await settled;
  });

  it("stops without writing once cancelled", async () => {
    const frames = stubFrameQueue();
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 240,
      scrollHeight: 2_000,
    });
    let cancelled = false;
    const settled = settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => harness.scrollElement,
      isCancelled: () => cancelled,
    });

    cancelled = true;
    await runNextFrame(frames);

    expect(harness.writes).toEqual([]);
    await settled;
  });

  it("stops when the scroll element disappears", async () => {
    const frames = stubFrameQueue();
    const harness = createHarness({
      clientHeight: 200,
      rowHeight: 40,
      rowTop: 240,
      scrollHeight: 2_000,
    });
    let available = true;
    const settled = settleScrollElementIntoView({
      element: harness.row,
      getScrollElement: () => (available ? harness.scrollElement : null),
    });

    available = false;
    await runNextFrame(frames);

    expect(harness.writes).toEqual([]);
    await settled;
  });
});
