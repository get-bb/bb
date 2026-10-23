import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PluginThreadFixedTabToggleHandler,
  PluginThreadPanelOpenHandler,
} from "@/components/plugin/plugin-thread-panel-navigation";
import type { PluginCommandPaletteActionSlot } from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { buildPluginPaletteActions } from "./palette-plugin-actions";

type AppCommandSlot = Extract<
  PluginCommandPaletteActionSlot,
  { target: "app" }
>;

function slot(
  overrides: Partial<AppCommandSlot> & { id: string },
): AppCommandSlot {
  return {
    target: "app",
    defaultShortcut: null,
    pluginId: "linear",
    generation: 1,
    title: `Title ${overrides.id}`,
    run: () => {},
    ...overrides,
  };
}

function build(
  slots: AppCommandSlot[],
  openThreadPanel: PluginThreadPanelOpenHandler | null = null,
  toggleThreadFixedTab: PluginThreadFixedTabToggleHandler | null = null,
) {
  return buildPluginPaletteActions({
    slots,
    threadId: "thr_1",
    projectId: "proj_1",
    openThreadPanel,
    toggleThreadFixedTab,
  });
}

afterEach(() => {
  resetPluginLogoStoreForTest();
  vi.restoreAllMocks();
});

describe("buildPluginPaletteActions", () => {
  it("buckets plugin actions together and attributes them to the manifest name", () => {
    setPluginLogoUrls(
      new Map([
        [
          "linear",
          {
            displayName: "Linear",
            icon: null,
            compactIconUrl: null,
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );

    expect(build([slot({ id: "listed" })])[0]).toMatchObject({
      bucket: "Plugins",
      group: "Linear",
    });
  });

  it("uses the stable plugin id when the manifest name is unavailable", () => {
    expect(build([slot({ id: "listed" })])[0]).toMatchObject({
      bucket: "Plugins",
      group: "linear",
    });
  });

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

  it("toggles the calling plugin's thread tab, or declines without a thread view", () => {
    const toggle: PluginThreadFixedTabToggleHandler = vi.fn(() => true);
    const results: boolean[] = [];
    const toggleSlot = slot({
      id: "toggle",
      run: (context) => {
        results.push(
          context.experimental_toggleTab({
            id: "diff",
            context: { kind: "thread" },
            availability: "fixed",
          }),
        );
      },
    });
    build([toggleSlot], null, toggle)[0]?.run();
    expect(toggle).toHaveBeenCalledWith({ pluginId: "linear", tabId: "diff" });
    build([toggleSlot])[0]?.run();
    expect(results).toEqual([true, false]);
  });
});
