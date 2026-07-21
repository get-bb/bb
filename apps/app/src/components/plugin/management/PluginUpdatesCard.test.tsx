// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  PluginReleaseFacts,
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

describe("PluginReleaseFacts", () => {
  it("shows current version and installation time without transport metadata", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/plugins/linear/source") {
        return jsonResponse({
          requested: "npm:@bb-plugins/linear@^1.4.0",
          resolved: "1.6.2",
          integrity: "sha512-9f2c",
          engines: { bb: ">=0.14" },
          installedAt: 1752200000000,
          history: [{ version: "1.6.2", activatedAt: 1752200000000 }],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginReleaseFacts plugin={plugin()} releaseVersion="1.6.2" />, {
      wrapper,
    });

    expect(screen.getByText("Current version")).toBeTruthy();
    expect(screen.getByText("1.6.2")).toBeTruthy();
    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(screen.queryByText("Requested")).toBeNull();
    expect(screen.queryByText("Resolved")).toBeNull();
    expect(screen.queryByText(/npm:@bb-plugins/)).toBeNull();
  });

  it("surfaces a newer-but-incompatible release on the card, not the list", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginReleaseFacts
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
      <PluginReleaseFacts plugin={plugin({ provenance: "builtin" })} />,
      { wrapper },
    );
    expect(container.textContent).toBe("");
  });
});
