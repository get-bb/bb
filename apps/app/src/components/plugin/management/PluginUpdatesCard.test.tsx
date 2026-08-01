// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  PluginDetailReleaseControl,
  pluginHasUpdateSurfaces,
} from "./PluginUpdatesCard";

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    name: "Linear",
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    sourceDisplay: "npm · @bb-plugins/linear · pinned",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pluginHasUpdateSurfaces", () => {
  it("hides update surfaces for bundled plugins regardless of provenance", () => {
    // A store-installed official: catalog provenance over a bundled source.
    expect(
      pluginHasUpdateSurfaces(
        plugin({ provenance: "catalog", source: "builtin:github" }),
      ),
    ).toBe(false);
    expect(
      pluginHasUpdateSurfaces(
        plugin({ provenance: "builtin", source: "builtin:secrets" }),
      ),
    ).toBe(false);
    // Managed direct/catalog installs keep manual update controls.
    expect(pluginHasUpdateSurfaces(plugin({ provenance: "direct" }))).toBe(
      true,
    );
    expect(pluginHasUpdateSurfaces(plugin({ provenance: "catalog" }))).toBe(
      true,
    );
  });
});

describe("PluginDetailReleaseControl", () => {
  it("offers a compatible update as a compact header action", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseControl
        plugin={plugin({
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            availableVersion: "1.9.0",
          },
        })}
      />,
      { wrapper },
    );

    expect(
      screen.getByRole("button", { name: "Update Linear to 1.9.0" }),
    ).toBeTruthy();
    expect(screen.queryByText("Compatible with your bb.")).toBeNull();
  });

  it("opens compatibility details from the blocked header action", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseControl
        plugin={plugin({
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            blockedVersion: "1.9.0",
            blockedReasons: ["requires bb >= 0.15"],
          },
        })}
      />,
      { wrapper },
    );

    const blockedAction = screen.getByRole("button", {
      name: "View why update 1.9.0 is blocked",
    });
    expect(blockedAction.className).not.toContain("text-warning");
    expect(
      blockedAction
        .querySelector('[data-icon="AlertTriangle"]')
        ?.getAttribute("class"),
    ).toContain("text-warning");

    fireEvent.click(blockedAction);
    expect(
      screen.getByRole("heading", { name: "Update Linear to 1.9.0?" }),
    ).toBeTruthy();
    expect(screen.getByText("requires bb >= 0.15")).toBeTruthy();
  });

  it("opens persisted rollback details from the failed-update action", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseControl
        plugin={plugin({
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            availableVersion: "1.9.0",
            lastFailure: {
              version: "1.9.0",
              at: null,
              detail: "The plugin failed to load.",
            },
          },
        })}
      />,
      { wrapper },
    );

    const failedAction = screen.getByRole("button", {
      name: "View failed update to 1.9.0",
    });
    expect(failedAction.className).not.toContain("text-destructive");
    expect(
      failedAction
        .querySelector('[data-icon="CircleX"]')
        ?.getAttribute("class"),
    ).toContain("text-destructive");

    fireEvent.click(failedAction);

    expect(screen.getByRole("heading", { name: "Update failed" })).toBeTruthy();
    expect(screen.getByText("The plugin failed to load.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Retry update to 1.9.0" }),
    ).toBeTruthy();
  });

  it("renders nothing for builtins (their update channel is the bb release)", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <PluginDetailReleaseControl
        plugin={{
          ...plugin({ provenance: "builtin" }),
          source: "builtin:linear",
        }}
      />,
      { wrapper },
    );
    expect(container.textContent).toBe("");
  });
});
