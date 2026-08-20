import { describe, expect, it } from "vitest";
import type { PluginPanelFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { pluginPanelTabFillsRegion } from "./plugin-panel-tab-layout";

const ACTION_TAB: PluginPanelFixedPanelTab = {
  actionId: "viewer",
  id: "plugin-panel:docs:viewer:null",
  kind: "plugin-panel",
  paramsJson: null,
  pluginId: "docs",
  title: "Viewer",
};

describe("pluginPanelTabFillsRegion", () => {
  it("fills the region for file-opener tabs independently of panel actions", () => {
    expect(
      pluginPanelTabFillsRegion(
        {
          ...ACTION_TAB,
          fileOpenerOwner: {
            environmentId: "env_1",
            kind: "thread-storage-file-preview",
            tab: { lineRange: null, path: "artifact.md" },
            threadId: "thr_1",
          },
        },
        [],
      ),
    ).toBe(true);
  });

  it("fills the region only for the matching flush action", () => {
    expect(
      pluginPanelTabFillsRegion(ACTION_TAB, [
        {
          id: "viewer",
          layout: "flush",
          pluginId: "docs",
        },
      ]),
    ).toBe(true);
    expect(
      pluginPanelTabFillsRegion(ACTION_TAB, [
        {
          id: "viewer",
          layout: "padded",
          pluginId: "docs",
        },
        {
          id: "viewer",
          layout: "flush",
          pluginId: "tasks",
        },
      ]),
    ).toBe(false);
    expect(pluginPanelTabFillsRegion(null, [])).toBe(false);
  });
});
