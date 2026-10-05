import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { sidebarGroupThreadsByEnvironmentAtom } from "./atoms.js";
import { preferenceValueAtom } from "./preferences-sync.js";

describe("sidebarGroupThreadsByEnvironmentAtom", () => {
  it("turns environment grouping off while grouping by read status", () => {
    const store = createStore();
    store.set(preferenceValueAtom("environmentGrouping"), true);
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(true);

    store.set(preferenceValueAtom("groupByReadStatus"), true);
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(false);

    store.set(preferenceValueAtom("groupByReadStatus"), false);
    expect(store.get(sidebarGroupThreadsByEnvironmentAtom)).toBe(true);
  });
});
