import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { collapsedThreadIdsAtom, revealThreadIdsAtom } from "./atoms.js";
import { preferenceValueAtom } from "./preferences-sync.js";

function storeWithCollapsedThreads(ids: string[]) {
  const store = createStore();
  store.set(preferenceValueAtom("collapsedThreads"), ids);
  return store;
}

function toggle(ids: string[], id: string): string[] {
  return ids.includes(id)
    ? ids.filter((current) => current !== id)
    : [...ids, id];
}

describe("revealable collapsed atoms", () => {
  it("shows a revealed row expanded without changing the persisted list", () => {
    const store = storeWithCollapsedThreads(["parent", "other"]);

    store.set(revealThreadIdsAtom, new Set(["parent"]));

    expect(store.get(collapsedThreadIdsAtom)).toEqual(["other"]);
    expect(store.get(preferenceValueAtom("collapsedThreads"))).toEqual([
      "parent",
      "other",
    ]);
  });

  it("collapses a revealed row when the user toggles it", () => {
    const store = storeWithCollapsedThreads(["parent"]);
    store.set(revealThreadIdsAtom, new Set(["parent"]));

    store.set(collapsedThreadIdsAtom, (current) => toggle(current, "parent"));

    expect(store.get(collapsedThreadIdsAtom)).toEqual(["parent"]);
    expect(store.get(preferenceValueAtom("collapsedThreads"))).toEqual([
      "parent",
    ]);
  });

  it("keeps a revealed row's persisted collapse when the user expands another row", () => {
    const store = storeWithCollapsedThreads(["parent", "other"]);
    store.set(revealThreadIdsAtom, new Set(["parent"]));

    store.set(collapsedThreadIdsAtom, (current) => toggle(current, "other"));

    expect(store.get(collapsedThreadIdsAtom)).toEqual([]);
    expect(store.get(preferenceValueAtom("collapsedThreads"))).toEqual([
      "parent",
    ]);
  });
});
