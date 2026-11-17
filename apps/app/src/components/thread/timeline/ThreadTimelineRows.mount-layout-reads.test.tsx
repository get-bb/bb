// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { installFakeFlowLayout } from "@/test/fake-flow-layout";
import { conversationRow, toolRow } from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 140;
const LAYOUT_GETTERS = [
  [Element.prototype, "scrollTop"],
  [Element.prototype, "scrollLeft"],
  [Element.prototype, "scrollHeight"],
  [Element.prototype, "scrollWidth"],
  [Element.prototype, "clientHeight"],
  [Element.prototype, "clientWidth"],
  [Element.prototype, "clientTop"],
  [Element.prototype, "clientLeft"],
  [HTMLElement.prototype, "offsetHeight"],
  [HTMLElement.prototype, "offsetWidth"],
  [HTMLElement.prototype, "offsetTop"],
  [HTMLElement.prototype, "offsetLeft"],
] as const;
const LAYOUT_METHODS = [
  [Element.prototype, "getBoundingClientRect"],
  [Element.prototype, "getClientRects"],
] as const;

const restores: (() => void)[] = [];

afterEach(() => {
  cleanup();
  for (const restore of restores.splice(0).reverse()) restore();
  document.body.replaceChildren();
});

function recordLayoutReads() {
  const reads: string[] = [];
  let recording = false;
  const note = (name: string) => {
    if (recording) reads.push(name);
  };
  for (const [prototype, name] of LAYOUT_GETTERS) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    const get = descriptor?.get;
    if (descriptor === undefined || get === undefined) continue;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      get(this: Element) {
        note(name);
        return get.call(this);
      },
    });
    restores.push(() => Object.defineProperty(prototype, name, descriptor));
  }
  for (const [prototype, name] of LAYOUT_METHODS) {
    const original = prototype[name];
    Object.defineProperty(prototype, name, {
      configurable: true,
      writable: true,
      value(this: Element) {
        note(name);
        return Reflect.apply(original, this, []);
      },
    });
    restores.push(() =>
      Object.defineProperty(prototype, name, {
        configurable: true,
        writable: true,
        value: original,
      }),
    );
  }
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = (...args) => {
    note("getComputedStyle");
    return originalGetComputedStyle(...args);
  };
  restores.push(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });
  return {
    during(run: () => void): string[] {
      reads.length = 0;
      recording = true;
      try {
        run();
      } finally {
        recording = false;
      }
      return [...reads];
    },
  };
}

function historyRows(count: number, firstSeq = 1): TimelineRow[] {
  return Array.from({ length: count }, (_, offset): TimelineRow => {
    const seq = firstSeq + offset;
    if (seq % 3 === 0) {
      return toolRow({
        id: `row-${seq}`,
        seq,
        toolArgs: { path: `src/file-${seq}.ts`, limit: 200, offset: seq },
        toolName: "Read",
        turnId: `turn-${seq}`,
      });
    }
    return conversationRow({
      id: `row-${seq}`,
      role: seq % 3 === 1 ? "user" : "assistant",
      seq,
      text:
        seq % 3 === 1
          ? `Question ${seq}\n\n${"A line of the question.\n\n".repeat(24)}`
          : `Answer ${seq}\n\n| a | b |\n| - | - |\n| ${seq} | two |\n\n\`\`\`ts\nconst value = ${seq};\n\`\`\``,
      turnId: `turn-${seq}`,
    });
  });
}

function setup(rows: TimelineRow[]) {
  const layout = installFakeFlowLayout({
    heightOf: (element) =>
      element.hasAttribute("data-timeline-row-id") &&
      element.parentElement?.hasAttribute("data-timeline-items") === true
        ? ROW_HEIGHT
        : null,
    scrollElement: () =>
      document.querySelector<HTMLElement>("[data-page-scroll-viewport]"),
    viewportHeight: VIEWPORT_HEIGHT,
  });
  restores.push(layout.restore);
  const recorder = recordLayoutReads();
  const queryClient = new QueryClient();
  const tree = (timelineRows: TimelineRow[]) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BottomAnchoredScrollBody footer={null} maxWidthClassName="max-w-3xl">
          <ThreadTimelineRows
            timelineRows={timelineRows}
            threadRuntimeDisplayStatus="idle"
          />
        </BottomAnchoredScrollBody>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(rows));
  for (let frame = 0; frame < 3; frame += 1) act(() => layout.frame());
  const mounted = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        "[data-timeline-items] > [data-timeline-row-id]",
      ),
    ].map((row) => row.dataset.timelineRowId ?? "");
  return {
    layout,
    mounted,
    recorder,
    rerender: (timelineRows: TimelineRow[]) =>
      view.rerender(tree(timelineRows)),
  };
}

describe("timeline rows mounting", () => {
  it("reads no layout while a scroll mounts new rows, and covers the viewport by the next paint", () => {
    const harness = setup(historyRows(150));
    expect(harness.mounted()).not.toContain("row-1");

    act(() => harness.layout.userScrollTo(0));
    expect(harness.mounted()).not.toContain("row-4");
    const reads = harness.recorder.during(() =>
      act(() => harness.layout.runFrameCallbacks()),
    );
    act(() => harness.layout.flushResizeObservers());

    expect(harness.mounted()).toEqual(
      expect.arrayContaining(["row-1", "row-2", "row-3", "row-4"]),
    );
    expect(reads).toEqual([]);
  });

  it("reads no layout while a streamed row mounts at the end", () => {
    const rows = historyRows(150);
    const harness = setup(rows);
    const grown = [...rows, ...historyRows(1, 151)];

    const reads = harness.recorder.during(() =>
      act(() => harness.rerender(grown)),
    );

    expect(harness.mounted()).toContain("row-151");
    expect(reads).toEqual([]);
  });
});
