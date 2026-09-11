// @vitest-environment jsdom

import { createStore } from "jotai";
import { initializeNewThreadDraft } from "@/lib/drafts/resource-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closePanesForThreadsAtom,
  maximizedPaneIdAtom,
  MAXIMIZED_PANE_STORAGE_KEY,
  splitLayoutAtom,
} from "./atoms";
import { countPanes, findPaneByThread, listPanes, splitPane } from "./ops";
import {
  createSplitLayoutStorage,
  deserializeSplitLayout,
  serializeSplitLayout,
  serializeLegacySplitLayout,
  SPLIT_LAYOUT_STORAGE_KEY,
  LEGACY_SPLIT_LAYOUT_STORAGE_KEY,
} from "./persistence";
import type { SplitLayout } from "./types";

vi.mock("@/lib/drafts/resource-runtime", () => ({
  initializeNewThreadDraft: vi.fn(() => true),
}));

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
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function writeFromOtherTab(key: string, value: string): void {
  const previous = window.localStorage.getItem(key);
  window.localStorage.setItem(key, value);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: value,
      oldValue: previous,
      storageArea: window.localStorage,
    }),
  );
}

function hydrateLayoutOnLoad(): SplitLayout | null {
  const store = createStore();
  const unsubscribe = store.sub(splitLayoutAtom, () => {});
  const layout = store.get(splitLayoutAtom);
  unsubscribe();
  return layout;
}

describe("tab-scoped workspace state", () => {
  it("keeps this tab's panes when another tab opens a different thread", () => {
    const store = createStore();
    const unsubscribe = store.sub(splitLayoutAtom, () => {});
    store.set(splitLayoutAtom, singlePane("thread-1"));

    writeFromOtherTab(
      SPLIT_LAYOUT_STORAGE_KEY,
      serializeSplitLayout(singlePane("thread-2")),
    );

    expect(store.get(splitLayoutAtom)).toEqual(singlePane("thread-1"));
    unsubscribe();
  });

  it("keeps this tab's maximized pane when another tab maximizes a different one", () => {
    const store = createStore();
    const unsubscribe = store.sub(maximizedPaneIdAtom, () => {});
    store.set(splitLayoutAtom, twoPanes());
    store.set(maximizedPaneIdAtom, "pane-1");

    writeFromOtherTab(MAXIMIZED_PANE_STORAGE_KEY, "pane-2");

    expect(store.get(maximizedPaneIdAtom)).toBe("pane-1");
    unsubscribe();
  });

  it("seeds a new tab from the last arrangement, then reloads its own", () => {
    window.localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      serializeSplitLayout(twoPanes()),
    );
    expect(countPanes(hydrateLayoutOnLoad()!.root)).toBe(2);

    const store = createStore();
    store.set(splitLayoutAtom, singlePane("thread-3"));
    window.localStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      serializeSplitLayout(singlePane("thread-9")),
    );

    expect(hydrateLayoutOnLoad()).toEqual(singlePane("thread-3"));
  });
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

    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);

    expect(result.removedAny).toBe(true);
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
      focusedContent: null,
    });

    store.set(splitLayoutAtom, twoPanes());
    expect(store.set(closePanesForThreadsAtom, [])).toEqual({
      removedAny: false,
      focusedRoute: null,
      focusedContent: null,
    });
    expect(countPanes(store.get(splitLayoutAtom)!.root)).toBe(2);
  });
});

describe("draft layout migration", () => {
  it("keeps legacy panes and distinct migrated draft IDs across reloads", () => {
    const previous = {
      version: 1,
      layout: {
        root: {
          type: "split",
          dir: "row",
          sizes: [0.25, 0.25, 0.25, 0.25],
          children: [
            { type: "pane", paneId: "pane-1", content: { kind: "new-thread" } },
            { type: "pane", paneId: "pane-2", content: { kind: "new-thread" } },
            {
              type: "pane",
              paneId: "pane-3",
              content: { kind: "plugin-detail", pluginId: "notes" },
            },
            {
              type: "pane",
              paneId: "pane-4",
              content: { kind: "thread", projectId: "p1", threadId: "t1" },
            },
          ],
        },
        focusedPaneId: "pane-2",
      },
    };
    window.sessionStorage.setItem(
      LEGACY_SPLIT_LAYOUT_STORAGE_KEY,
      JSON.stringify(previous),
    );
    const storage = createSplitLayoutStorage();
    const migrated = storage.getItem(SPLIT_LAYOUT_STORAGE_KEY, null)!;
    const panes = listPanes(migrated.root);
    expect(migrated.focusedPaneId).toBe("pane-2");
    expect(panes[0]!.content).toMatchObject({
      kind: "new-thread",
      draftId: expect.stringMatching(/^drf_/),
    });
    expect(panes[0]!.content).not.toEqual(panes[1]!.content);
    expect(panes.slice(2)).toEqual(previous.layout.root.children.slice(2));
    expect(storage.getItem(SPLIT_LAYOUT_STORAGE_KEY, null)).toEqual(migrated);
    expect(
      JSON.parse(
        window.sessionStorage.getItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY)!,
      ),
    ).toEqual(previous);
  });

  it("preserves malformed values on read and the old projection when a new write fails", () => {
    const storage = createSplitLayoutStorage();
    window.sessionStorage.setItem(
      SPLIT_LAYOUT_STORAGE_KEY,
      "malformed current",
    );
    window.localStorage.setItem(
      LEGACY_SPLIT_LAYOUT_STORAGE_KEY,
      "malformed old",
    );
    expect(storage.getItem(SPLIT_LAYOUT_STORAGE_KEY, null)).toBeNull();
    expect(initializeNewThreadDraft).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBe(
      "malformed current",
    );
    expect(window.localStorage.getItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY)).toBe(
      "malformed old",
    );
    const original = Storage.prototype.setItem;
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === SPLIT_LAYOUT_STORAGE_KEY) throw new Error("quota");
        return original.call(this, key, value);
      });
    try {
      storage.setItem(SPLIT_LAYOUT_STORAGE_KEY, twoPanes());
      expect(window.localStorage.getItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY)).toBe(
        "malformed old",
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("retains legacy layout when the draft recovery checkpoint cannot be written", () => {
    const previous = JSON.stringify({
      version: 1,
      layout: {
        root: {
          type: "pane",
          paneId: "pane-1",
          content: { kind: "new-thread" },
        },
        focusedPaneId: "pane-1",
      },
    });
    window.sessionStorage.setItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY, previous);
    vi.mocked(initializeNewThreadDraft)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false);
    const storage = createSplitLayoutStorage();
    const migrated = storage.getItem(SPLIT_LAYOUT_STORAGE_KEY, null);
    expect(storage.getItem(SPLIT_LAYOUT_STORAGE_KEY, null)).toBe(migrated);
    storage.setItem(SPLIT_LAYOUT_STORAGE_KEY, migrated);
    expect(window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY)).toBe(
      previous,
    );
  });

  it("writes a rollback-readable projection after persisting the draft identity", () => {
    const layout = splitPane(singlePane("thread-1"), "pane-1", "right", {
      kind: "new-thread",
      draftId: "drf_persisted_identity",
    });
    createSplitLayoutStorage().setItem(SPLIT_LAYOUT_STORAGE_KEY, layout);
    expect(
      deserializeSplitLayout(
        window.sessionStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY),
      ),
    ).toEqual(layout);
    expect(window.sessionStorage.getItem(LEGACY_SPLIT_LAYOUT_STORAGE_KEY)).toBe(
      serializeLegacySplitLayout(layout),
    );
  });

  it("keeps the draft survivor when archiving the last thread pane", () => {
    const store = createStore();
    const content = {
      kind: "new-thread",
      draftId: "drf_surviving_draft",
    } as const;
    store.set(
      splitLayoutAtom,
      splitPane(singlePane("thread-1"), "pane-1", "right", content),
    );
    const result = store.set(closePanesForThreadsAtom, ["thread-1"]);
    expect(result.focusedContent).toEqual(content);
    expect(
      listPanes(store.get(splitLayoutAtom)!.root).map((pane) => pane.content),
    ).toEqual([content]);
  });
});
