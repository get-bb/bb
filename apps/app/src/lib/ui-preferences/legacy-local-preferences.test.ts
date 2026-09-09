// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  clearLegacyLocalUiPreference,
  readLegacyLocalUiPreference,
} from "./legacy-local-preferences";

function seed(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

describe("legacy local ui preferences", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("returns undefined when nothing was stored and drops invalid values", () => {
    expect(
      readLegacyLocalUiPreference("sidebar.organizationMode"),
    ).toBeUndefined();
    seed("bb.sidebar.organizationMode", "by-color");
    expect(
      readLegacyLocalUiPreference("sidebar.organizationMode"),
    ).toBeUndefined();
    window.localStorage.setItem("bb.sidebar.collapsedProjects", "{not json");
    expect(
      readLegacyLocalUiPreference("sidebar.collapsedProjects"),
    ).toBeUndefined();
    seed("bb.sidebar.collapsedThreads", ["thr_a", 2]);
    expect(
      readLegacyLocalUiPreference("sidebar.collapsedThreads"),
    ).toBeUndefined();
  });

  it("reads values from their old browser keys", () => {
    seed("bb.sidebar.organizationMode", "machine");
    seed("bb.sidebar.collapsedThreads", ["thr_a", "thr_b"]);
    seed("bb.sidebar.navigationProvider", "docs/main");
    seed("bb.sidebar.visiblePluginPanels", ["docs/main"]);
    expect(readLegacyLocalUiPreference("sidebar.organizationMode")).toBe(
      "machine",
    );
    expect(readLegacyLocalUiPreference("sidebar.collapsedThreads")).toEqual([
      "thr_a",
      "thr_b",
    ]);
    expect(readLegacyLocalUiPreference("sidebar.navigationProvider")).toBe(
      "docs/main",
    );
    expect(readLegacyLocalUiPreference("sidebar.visiblePluginPanels")).toEqual([
      "docs/main",
    ]);
  });

  it("ignores retired folder-era and hidden-panel keys", () => {
    seed("bb.sidebar.folderSectionOrder", ["pinned", "folders"]);
    seed("bb.sidebar.collapsedFolders", ["proj_1::sec_1"]);
    seed("bb.sidebar.hiddenPluginPanels", ["docs/main"]);
    expect(
      readLegacyLocalUiPreference("sidebar.manualSectionOrder"),
    ).toBeUndefined();
    expect(
      readLegacyLocalUiPreference("sidebar.collapsedThreadSections"),
    ).toBeUndefined();
    expect(
      readLegacyLocalUiPreference("sidebar.pluginPanelOrder"),
    ).toBeUndefined();
    expect(
      readLegacyLocalUiPreference("sidebar.visiblePluginPanels"),
    ).toBeUndefined();
  });

  it("clears the old key and its retired predecessors", () => {
    seed("bb.sidebar.pluginPanelOrder", ["docs/main"]);
    seed("bb.sidebar.hiddenPluginPanels", ["docs/main"]);
    seed("bb.sidebar.collapsedThreadSections", ["proj_1::sec_1"]);
    seed("bb.sidebar.collapsedFolders", ["proj_1::sec_1"]);
    seed("bb.sidebar.manualSectionOrder", ["pinned"]);
    seed("bb.sidebar.folderSectionOrder", ["pinned"]);
    clearLegacyLocalUiPreference("sidebar.pluginPanelOrder");
    clearLegacyLocalUiPreference("sidebar.collapsedThreadSections");
    clearLegacyLocalUiPreference("sidebar.manualSectionOrder");
    for (const key of [
      "bb.sidebar.pluginPanelOrder",
      "bb.sidebar.hiddenPluginPanels",
      "bb.sidebar.collapsedThreadSections",
      "bb.sidebar.collapsedFolders",
      "bb.sidebar.manualSectionOrder",
      "bb.sidebar.folderSectionOrder",
    ]) {
      expect(window.localStorage.getItem(key)).toBeNull();
    }
  });
});
