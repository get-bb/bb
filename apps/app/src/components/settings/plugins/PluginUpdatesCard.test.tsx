// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { appToast } from "@/components/ui/app-toast.js";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  pluginListQueryKey,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  PluginUpdatesSourceCard,
  pluginHasUpdateSurfaces,
} from "./PluginUpdatesCard";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    name: "Linear",
    icon: null,
    source: "npm:@example/linear@^1.6.0",
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    isOrphanedBuiltin: false,
    sourceDisplay: "npm · @bb-plugins/linear · pinned",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
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

describe("PluginUpdatesSourceCard check now", () => {
  it("POSTs the per-plugin update check and refetches the list", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "/api/v1/plugins/updates/check") {
          return jsonResponse({
            results: [
              {
                id: "linear",
                outcome: "current",
                installed: { version: "1.6.2", display: "1.6.2" },
              },
            ],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginListQueryKey(true), { plugins: [] });
    render(<PluginUpdatesSourceCard plugin={plugin()} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));

    await vi.waitFor(() => {
      const post = requests.find((request) =>
        request.url.endsWith("/updates/check"),
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({ id: "linear" });
      expect(
        queryClient.getQueryState(pluginListQueryKey(true))?.isInvalidated,
      ).toBe(true);
    });
  });

  it("toasts the server message when the check fails", async () => {
    const errorToast = vi.spyOn(appToast, "error").mockReturnValue("toast");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "registry unreachable" }, 422)),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginUpdatesSourceCard plugin={plugin()} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));

    await vi.waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        "The update check failed",
        expect.objectContaining({ description: "registry unreachable" }),
      );
    });
  });
});

describe("PluginUpdatesSourceCard source details", () => {
  it("lazily fetches /source on expand and renders the resolved detail", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/plugins/linear/source") {
        return jsonResponse({
          requested: "npm:@bb-plugins/linear@^1.4.0",
          resolved: "1.6.2",
          integrity: "sha512-9f2c",
          engines: { bb: ">=0.14" },
          history: [{ version: "1.6.2", activatedAt: 1752200000000 }],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginUpdatesSourceCard plugin={plugin()} />, { wrapper });

    // Collapsed: no fetch yet (lazy).
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/source")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    expect(
      await screen.findByText("npm:@bb-plugins/linear@^1.4.0"),
    ).toBeTruthy();
    expect(screen.getByText(/1\.6\.2 · sha512-9f2c/)).toBeTruthy();
  });

  it("surfaces a newer-but-incompatible release on the card, not the list", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard
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
      <PluginUpdatesSourceCard plugin={plugin({ provenance: "builtin" })} />,
      { wrapper },
    );
    expect(container.textContent).toBe("");
  });
});
