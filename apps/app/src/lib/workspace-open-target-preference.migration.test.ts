// @vitest-environment jsdom

import { createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe("workspace open target preference migration", () => {
  it("rewrites stored Windsurf directory and file preferences", async () => {
    window.localStorage.setItem("bb.workspaceOpenTarget", "windsurf");
    window.localStorage.setItem("bb.fileOpenTarget", "windsurf");

    const {
      FILE_OPEN_TARGET_STORAGE_KEY,
      WORKSPACE_OPEN_TARGET_STORAGE_KEY,
      fileOpenTargetPreferenceAtom,
      workspaceOpenTargetPreferenceAtom,
    } = await import("./workspace-open-target-preference");
    const store = createStore();

    expect(store.get(workspaceOpenTargetPreferenceAtom)).toBe("devin-desktop");
    expect(store.get(fileOpenTargetPreferenceAtom)).toBe("devin-desktop");
    expect(window.localStorage.getItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "devin-desktop",
    );
    expect(window.localStorage.getItem(FILE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "devin-desktop",
    );
  });
});
