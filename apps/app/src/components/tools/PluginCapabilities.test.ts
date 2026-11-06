import { describe, expect, it } from "vitest";
import { EMPTY_PLUGIN_SLOT_SNAPSHOT } from "@/lib/plugin-slots";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { pluginAppSurfaceItems } from "./PluginCapabilities";

describe("pluginAppSurfaceItems", () => {
  it("keeps the internal setup guide row out of a plugin's capabilities, as on main", () => {
    const plugin = makePluginListItem({ id: "connect" });
    const withoutGuideRow = pluginAppSurfaceItems(
      plugin,
      EMPTY_PLUGIN_SLOT_SNAPSHOT,
      undefined,
    );
    const items = pluginAppSurfaceItems(
      plugin,
      {
        ...EMPTY_PLUGIN_SLOT_SNAPSHOT,
        setupGuideSections: [
          {
            pluginId: "connect",
            generation: 1,
            id: "remote-access",
            component: () => null,
          },
        ],
      },
      undefined,
    );

    expect(items.map((item) => item.key)).toEqual(
      withoutGuideRow.map((item) => item.key),
    );
    expect(items.some((item) => item.key.startsWith("setup-guide"))).toBe(
      false,
    );
  });
});
