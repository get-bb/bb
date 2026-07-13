// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { closePanesForThreadsAtom, splitLayoutAtom } from "./atoms";
import { countPanes, findPaneByThread, splitPane } from "./ops";
import type { SplitLayout } from "./types";

function singlePane(threadId: string): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: "pane-1",
      content: { kind: "thread", projectId: "project-1", threadId },
    },
    focusedPaneId: "pane-1",
  };
}

function twoPanes(): SplitLayout {
  return splitPane(singlePane("thread-1"), "pane-1", "right", {
    kind: "thread",
    projectId: "project-1",
    threadId: "thread-2",
  });
}

afterEach(() => {
  window.localStorage.clear();
});

describe("closePanesForThreadsAtom", () => {
  it("closes the pane holding an archived/deleted thread when split", () => {
    const store = createStore();
    store.set(splitLayoutAtom, twoPanes());

    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);

    expect(result.removedAny).toBe(true);
    const layout = store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(1);
    expect(findPaneByThread(layout!.root, "project-1", "thread-1")).toBeNull();
    expect(
      findPaneByThread(layout!.root, "project-1", "thread-2"),
    ).not.toBeNull();
  });

  it("never removes the last pane, so a single pane falls through to navigation", () => {
    const store = createStore();
    const layout = singlePane("thread-1");
    store.set(splitLayoutAtom, layout);

    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);

    expect(result.removedAny).toBe(false);
    expect(store.get(splitLayoutAtom)).toEqual(layout);
  });

  it("does nothing when there is no layout or no target threads", () => {
    const store = createStore();
    expect(store.set(closePanesForThreadsAtom, ["thread-1"]).removedAny).toBe(
      false,
    );

    store.set(splitLayoutAtom, twoPanes());
    expect(store.set(closePanesForThreadsAtom, []).removedAny).toBe(false);
    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(2);
  });
});
