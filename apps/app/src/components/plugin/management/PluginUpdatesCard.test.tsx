// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  PluginCompatibilityBanner,
  pluginHasUpdateSurfaces,
} from "./PluginUpdatesCard";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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

describe("PluginCompatibilityBanner", () => {
  it("surfaces a newer-but-incompatible release", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginCompatibilityBanner
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

    expect(
      screen.getByText("1.9.0 isn't compatible with this bb"),
    ).toBeTruthy();
    expect(screen.getByText("requires bb >= 0.15")).toBeTruthy();
  });

  it("renders nothing for builtins (their update channel is the bb release)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { container } = render(
      <PluginCompatibilityBanner plugin={plugin({ provenance: "builtin" })} />,
      { wrapper },
    );
    expect(container.textContent).toBe("");
  });
});
