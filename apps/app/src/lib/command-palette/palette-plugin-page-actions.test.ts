import { describe, expect, it, vi } from "vitest";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import { buildPluginPagePaletteActions } from "./palette-plugin-page-actions";

function panel(overrides: Partial<PluginNavPanelSlot>): PluginNavPanelSlot {
  return {
    id: "board",
    title: "Board",
    icon: "Columns",
    path: "board",
    component: () => null,
    pluginId: "demo",
    generation: 1,
    ...overrides,
  };
}

describe("buildPluginPagePaletteActions", () => {
  it("offers every page except the ones hidden from navigation", () => {
    const navigate = vi.fn();
    const actions = buildPluginPagePaletteActions({
      navigate,
      panels: [
        panel({}),
        panel({
          id: "new-chat",
          title: "New chat here",
          path: "new-chat",
          experimental_hideFromNavigation: true,
        }),
        panel({
          id: "shown",
          title: "Shown",
          path: "shown",
          experimental_hideFromNavigation: false,
        }),
      ],
    });

    expect(actions.map((action) => action.title)).toEqual(["Board", "Shown"]);
    actions[0]?.run();
    expect(navigate).toHaveBeenCalledWith("/plugins/demo/board");
  });
});
