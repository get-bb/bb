// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { createThreadArchiveFilterAtom } from "./thread-lifecycle-filter";

const sidebarKey = "test.sidebar.archiveFilter";
const paletteKey = "test.palette.archiveFilter";

afterEach(() => {
  window.localStorage.removeItem(sidebarKey);
  window.localStorage.removeItem(paletteKey);
});

describe("browser-local thread filters", () => {
  it("restores independent selections without server preferences", () => {
    const store = createStore();
    const sidebar = createThreadArchiveFilterAtom(sidebarKey);
    const palette = createThreadArchiveFilterAtom(paletteKey);
    expect(store.get(sidebar)).toEqual(["active"]);
    store.set(sidebar, ["active", "archived"]);
    store.set(palette, ["archived"]);

    const reloaded = createStore();
    expect(reloaded.get(createThreadArchiveFilterAtom(sidebarKey))).toEqual([
      "active",
      "archived",
    ]);
    expect(reloaded.get(createThreadArchiveFilterAtom(paletteKey))).toEqual([
      "archived",
    ]);
  });

  it("falls back to Active for malformed, empty, or unsupported stored values", () => {
    for (const value of [
      "invalid JSON",
      "null",
      '"active"',
      "[]",
      '["draft"]',
      '["active","active"]',
      '["active","archived","unknown"]',
    ]) {
      window.localStorage.setItem(sidebarKey, value);
      expect(createStore().get(createThreadArchiveFilterAtom(sidebarKey))).toEqual([
        "active",
      ]);
    }
  });
});
