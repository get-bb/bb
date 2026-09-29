// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_FIRST_SCREEN_PLUGIN_IDS,
  readFirstScreenOwners,
  rememberFirstScreenOwners,
} from "./plugin-first-screen-owners";

const STORAGE_KEY = "bb.plugin-first-screen-owners.1";

function snapshot({
  navigations = [],
  threadLists = [],
}: {
  navigations?: string[];
  threadLists?: string[];
}) {
  const slot = (pluginId: string) => ({ pluginId });
  return {
    experimentalSidebarNavigations: navigations.map(slot),
    threadLists: threadLists.map(slot),
  };
}

afterEach(() => {
  window.localStorage.clear();
});

describe("first-screen plugin owners", () => {
  it("defaults to the bundled thread list and navigation on a first visit", () => {
    expect(readFirstScreenOwners()).toEqual(["thread-list", "navigation"]);
    expect(DEFAULT_FIRST_SCREEN_PLUGIN_IDS).toEqual([
      "thread-list",
      "navigation",
    ]);
  });

  it("remembers whichever plugins filled the thread list and navigation slots", () => {
    rememberFirstScreenOwners(
      snapshot({
        navigations: ["navigation"],
        threadLists: ["my-thread-list", "navigation"],
      }),
    );
    expect(readFirstScreenOwners()).toEqual(["my-thread-list", "navigation"]);
  });

  it("keeps the previous owners when no plugin registered either slot", () => {
    rememberFirstScreenOwners(snapshot({ threadLists: ["my-thread-list"] }));
    rememberFirstScreenOwners(snapshot({}));
    expect(readFirstScreenOwners()).toEqual(["my-thread-list"]);
  });

  it("falls back to the defaults when the stored value is malformed", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(readFirstScreenOwners()).toEqual(DEFAULT_FIRST_SCREEN_PLUGIN_IDS);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }));
    expect(readFirstScreenOwners()).toEqual(DEFAULT_FIRST_SCREEN_PLUGIN_IDS);
  });
});
