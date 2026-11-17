// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode, PaneContent, SplitLayout } from "@/lib/split-layout";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";

const rowRenders = vi.fn<(threadId: string) => void>();

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "p1", threadId };
}

function pane(paneId: string, threadId: string): LayoutNode {
  return { type: "pane", paneId, content: content(threadId) };
}

function split(sizes: [number, number], focusedPaneId: string): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes,
      children: [pane("pane-1", "t1"), pane("pane-2", "t2")],
    },
    focusedPaneId,
  };
}

function Row({ threadId }: { threadId: string }) {
  const rowContent = useMemo(() => content(threadId), [threadId]);
  const indicator = usePaneContentSplitIndicator(rowContent, true);
  rowRenders(threadId);
  return <div data-in-split={indicator.isOpenInSplit} />;
}

function renderedRows(): string[] {
  return rowRenders.mock.calls.map(([threadId]) => threadId).sort();
}

afterEach(() => {
  cleanup();
  rowRenders.mockClear();
});

describe("usePaneContentSplitIndicator", () => {
  it("re-renders only the rows open in the split when the layout changes", () => {
    const store = createStore();
    store.set(splitLayoutAtom, split([0.5, 0.5], "pane-1"));
    render(
      <Provider store={store}>
        {["t1", "t2", "t3", "t4"].map((threadId) => (
          <Row key={threadId} threadId={threadId} />
        ))}
      </Provider>,
    );
    rowRenders.mockClear();

    act(() => {
      store.set(splitLayoutAtom, split([0.5, 0.5], "pane-2"));
    });
    expect(renderedRows()).toEqual(["t1", "t2"]);

    rowRenders.mockClear();
    act(() => {
      store.set(splitLayoutAtom, split([0.6, 0.4], "pane-2"));
    });
    expect(renderedRows()).toEqual(["t1", "t2"]);

    rowRenders.mockClear();
    act(() => {
      store.set(splitLayoutAtom, split([0.6, 0.4], "pane-2"));
    });
    expect(renderedRows()).toEqual([]);
  });
});
