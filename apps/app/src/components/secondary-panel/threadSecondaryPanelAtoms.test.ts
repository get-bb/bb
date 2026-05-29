// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { threadConversationCollapsedAtom } from "./threadSecondaryPanelAtoms";

const STORAGE_KEY = "bb.thread.conversation.collapsed";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("threadConversationCollapsedAtom", () => {
  it("defaults to collapsed=false and persists toggles to localStorage", () => {
    const store = createStore();
    expect(store.get(threadConversationCollapsedAtom)).toBe(false);

    store.set(threadConversationCollapsedAtom, true);
    expect(store.get(threadConversationCollapsedAtom)).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");

    store.set(threadConversationCollapsedAtom, false);
    expect(store.get(threadConversationCollapsedAtom)).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("hydrates the persisted preference when the atom initializes", async () => {
    // The atom reads storage when it is created (page load), so re-import the
    // module after seeding localStorage to exercise the parse path.
    window.localStorage.setItem(STORAGE_KEY, "true");
    vi.resetModules();
    const { threadConversationCollapsedAtom: hydratedAtom } =
      await import("./threadSecondaryPanelAtoms");

    expect(createStore().get(hydratedAtom)).toBe(true);
  });
});
