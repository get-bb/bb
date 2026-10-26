import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPanelController } from "@/lib/app-fixed-tab-navigation";
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
  panel: AppPanelController | null = null,
) {
  return buildPluginPaletteActions({
    slots,
    threadId: "thr_1",
    projectId: "proj_1",
    panel,
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

  it("routes experimental_panel and the retired openPanel to the focused surface's controller, or declines without one", () => {
    const panel: AppPanelController = {
      openTab: vi.fn(() => true),
      toggleTab: vi.fn(() => true),
      close: vi.fn(() => true),
    };
    const issueTab = {
      id: "issue-panel",
      context: { kind: "thread" },
      availability: "action",
    } as const;
    const results: boolean[] = [];
    const run = (
      context: Parameters<AppCommandSlot["run"]>[0] & {
        openPanel?: (options: { actionId: string }) => boolean;
      },
    ) => {
      results.push(
        context.experimental_panel.toggleTab({ tab: issueTab }),
        context.experimental_panel.close(),
        context.openPanel?.({ actionId: "issue-panel" }) ?? false,
      );
    };
    build([slot({ id: "panel", run })], panel)[0]?.run();
    const intent = {
      tab: { ownerId: "plugin-thread:linear", tabId: "issue-panel" },
      availability: "action",
    };
    expect(panel.toggleTab).toHaveBeenCalledWith(intent);
    expect(panel.openTab).toHaveBeenCalledWith(intent);
    expect(results).toEqual([true, true, true]);

    build([slot({ id: "panel", run })])[0]?.run();
    expect(results).toEqual([true, true, true, false, false, false]);
  });
});
