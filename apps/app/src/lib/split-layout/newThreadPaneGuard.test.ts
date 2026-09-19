// @vitest-environment jsdom

import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "./atoms";
import {
  registerNewThreadPaneGuard,
  requestSplitLayoutChange,
} from "./newThreadPaneGuard";
import {
  removePane,
  replacePaneContent,
  replaceWithNewThreadComposer,
  splitPane,
} from "./ops";
import type { SplitLayout } from "./types";

function fixture() {
  const singleton: SplitLayout = {
    root: { type: "pane", paneId: "pane-1", content: { kind: "new-thread" } },
    focusedPaneId: "pane-1",
  };
  const layout = splitPane(singleton, "pane-1", "right", {
    kind: "new-thread",
  });
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  return { store, layout, paneId: layout.focusedPaneId };
}

describe("local composer discard guard", () => {
  it("blocks close, navigation replacement, and fresh composer replacement while creating", () => {
    const { store, layout, paneId } = fixture();
    const discard = vi.fn();
    const accepted = vi.fn();
    const unregister = registerNewThreadPaneGuard(store, {
      isCreating: () => true,
      setCreating: () => {},
      discard,
    });
    for (const next of [
      removePane(layout, paneId),
      replacePaneContent(layout, paneId, {
        kind: "thread",
        projectId: "p",
        threadId: "t",
      }),
      replaceWithNewThreadComposer(layout, paneId),
    ]) {
      requestSplitLayoutChange(store, next, accepted);
      expect(store.get(splitLayoutAtom)).toBe(layout);
    }
    expect(discard).not.toHaveBeenCalled();
    expect(accepted).not.toHaveBeenCalled();
    unregister();
  });

  it("defers a destructive change and rejects stale dialog completion", () => {
    const { store, layout, paneId } = fixture();
    let confirm: (() => boolean) | undefined;
    const unregister = registerNewThreadPaneGuard(store, {
      isCreating: () => false,
      setCreating: () => {},
      discard: (ids, accept) => {
        expect(ids).toEqual([paneId]);
        confirm = accept;
      },
    });
    const accepted = vi.fn();
    const cancelled = vi.fn();
    requestSplitLayoutChange(
      store,
      removePane(layout, paneId),
      accepted,
      cancelled,
    );
    expect(store.get(splitLayoutAtom)).toBe(layout);
    const changed = splitPane(layout, "pane-1", "bottom", {
      kind: "new-thread",
    });
    store.set(splitLayoutAtom, changed);
    expect(confirm?.()).toBe(false);
    expect(store.get(splitLayoutAtom)).toBe(changed);
    expect(accepted).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
    unregister();
  });

  it("commits only after confirming removal of the targeted composer", () => {
    const { store, layout, paneId } = fixture();
    const accepted = vi.fn();
    const next = removePane(layout, paneId);
    const unregister = registerNewThreadPaneGuard(store, {
      isCreating: () => false,
      setCreating: () => {},
      discard: (ids, accept) => {
        expect(ids).toEqual([paneId]);
        expect(store.get(splitLayoutAtom)).toBe(layout);
        expect(accept()).toBe(true);
      },
    });
    requestSplitLayoutChange(store, next, accepted);
    expect(store.get(splitLayoutAtom)).toBe(next);
    expect(accepted).toHaveBeenCalledOnce();
    unregister();
  });
});
