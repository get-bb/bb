import { describe, expect, it, vi } from "vitest";
import type { PluginThreadPanelOpenHandler } from "@/components/plugin/plugin-thread-panel-navigation";
import type { PluginCommandPaletteActionSlot } from "@/lib/plugin-slots";
import { buildPluginPaletteActions } from "./palette-plugin-actions";

function slot(
  overrides: Partial<PluginCommandPaletteActionSlot> & { id: string },
): PluginCommandPaletteActionSlot {
  return {
    pluginId: "linear",
    generation: 1,
    title: `Title ${overrides.id}`,
    run: () => {},
    ...overrides,
  };
}

function build(
  slots: PluginCommandPaletteActionSlot[],
  openThreadPanel: PluginThreadPanelOpenHandler | null = null,
) {
  return buildPluginPaletteActions({
    slots,
    threadId: "thr_1",
    projectId: "proj_1",
    openThreadPanel,
  });
}

describe("buildPluginPaletteActions", () => {
  it("drops a row whose isAvailable declines or throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = build([
      slot({ id: "listed" }),
      slot({ id: "declined", isAvailable: () => false }),
      slot({
        id: "exploded",
        isAvailable: () => {
          throw new Error("boom");
        },
      }),
    ]);
    // A plugin that throws while the palette is deciding what to show must not
    // take the palette down, and must not be listed on a guess.
    expect(rows.map((row) => row.id)).toEqual(["plugin:linear/listed"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("routes openPanel to the focused thread view, or declines without one", () => {
    const openThreadPanel: PluginThreadPanelOpenHandler = vi.fn(() => true);
    const opened: boolean[] = [];
    build(
      [
        slot({
          id: "panel",
          run: ({ openPanel }) => {
            opened.push(openPanel({ actionId: "issue-panel" }));
          },
        }),
      ],
      openThreadPanel,
    )[0]?.run();
    // The plugin id is the host's half of the lookup: without it the opener
    // cannot tell whose `threadPanelAction` "issue-panel" names.
    expect(openThreadPanel).toHaveBeenCalledWith({
      actionId: "issue-panel",
      pluginId: "linear",
    });
    expect(opened).toEqual([true]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    build([
      slot({
        id: "panel",
        run: ({ openPanel }) => {
          opened.push(openPanel({ actionId: "issue-panel" }));
        },
      }),
    ])[0]?.run();
    expect(opened).toEqual([true, false]);
    warn.mockRestore();
  });
});
