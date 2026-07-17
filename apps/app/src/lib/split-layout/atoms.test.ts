// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  closePanesForThreadsAtom,
  maximizedPaneIdAtom,
  MAXIMIZED_PANE_STORAGE_KEY,
  splitLayoutAtom,
} from "./atoms";
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

// pane-1 = thread-1, pane-2 = thread-2 (focused — splitPane focuses the new pane).
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
  it("persists a maximized pane id and rejects an empty stored id", () => {
    const store = createStore();
    store.set(maximizedPaneIdAtom, "pane-2");

    expect(window.localStorage.getItem(MAXIMIZED_PANE_STORAGE_KEY)).toBe(
      "pane-2",
    );

    window.localStorage.setItem(MAXIMIZED_PANE_STORAGE_KEY, "");
    const rehydrated = createStore();
    expect(rehydrated.get(maximizedPaneIdAtom)).toBeNull();
  });

  it("closes an unfocused pane and reports the unchanged focused survivor", () => {
    const store = createStore();
    store.set(splitLayoutAtom, twoPanes());

    // thread-1 is the unfocused pane; thread-2 stays focused.
    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);

    expect(result.removedAny).toBe(true);
    // Focused survivor is unchanged, so the provider will not navigate.
    expect(result.focusedRoute).toEqual({
      projectId: "project-1",
      threadId: "thread-2",
    });
    const layout = store.get(splitLayoutAtom);
    expect(countPanes(layout!.root)).toBe(1);
    expect(findPaneByThread(layout!.root, "project-1", "thread-1")).toBeNull();
  });

  it("closes the focused pane and reports the survivor the URL should follow", () => {
    const store = createStore();
    store.set(splitLayoutAtom, twoPanes());
    store.set(maximizedPaneIdAtom, "pane-2");

    // thread-2 is focused; closing it must surface thread-1 as the new focus.
    const result = store.set(closePanesForThreadsAtom, ["thread-2"]);

    expect(result.removedAny).toBe(true);
    expect(result.focusedRoute).toEqual({
      projectId: "project-1",
      threadId: "thread-1",
    });
    const layout = store.get(splitLayoutAtom);
    expect(layout!.focusedPaneId).toBe("pane-1");
    expect(store.get(maximizedPaneIdAtom)).toBeNull();
  });

  it("clears the layout when every open pane is archived (no valid survivor)", () => {
    const store = createStore();
    store.set(splitLayoutAtom, twoPanes());

    const result = store.set(closePanesForThreadsAtom, [
      "thread-1",
      "thread-2",
    ]);

    expect(result.removedAny).toBe(true);
    // No pane can survive, so the caller falls back to navigate-away.
    expect(result.focusedRoute).toBeNull();
    expect(store.get(splitLayoutAtom)).toBeNull();
  });

  it("never removes the last pane, so a single pane falls through to navigation", () => {
    const store = createStore();
    const layout = singlePane("thread-1");
    store.set(splitLayoutAtom, layout);

    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);

    expect(result.removedAny).toBe(false);
    expect(result.focusedRoute).toBeNull();
    expect(store.get(splitLayoutAtom)).toEqual(layout);
  });

  it("does nothing when there is no layout or no target threads", () => {
    const store = createStore();
    expect(store.set(closePanesForThreadsAtom, ["thread-1"])).toEqual({
      removedAny: false,
      focusedRoute: null,
    });

    store.set(splitLayoutAtom, twoPanes());
    expect(store.set(closePanesForThreadsAtom, [])).toEqual({
      removedAny: false,
      focusedRoute: null,
    });
    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(2);
  });
});
