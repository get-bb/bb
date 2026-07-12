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
import { PluginUpdatesSourceCard } from "./PluginUpdatesCard";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    displayName: "Linear",
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    marketplaceName: null,
    sourceDisplay: "npm · @bb-plugins/linear · tracking ^1.4.0",
    updatePolicy: "compatible",
    autoApply: false,
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    ...overrides,
  };
}

// Full server-shaped MarketplaceView; autoApply=true forces every plugin
// installed from it.
const FORCING_MARKETPLACE = {
  id: "bb-official",
  name: "bb-official",
  displayName: "bb-official",
  source: "github.com/bb-plugins/official@stable",
  pluginCount: 3,
  enabled: true,
  scope: "builtin",
  autoCheck: true,
  autoApply: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PluginUpdatesSourceCard auto-apply", () => {
  it("POSTs the toggle and refetches the list on a matching echo", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "/api/v1/plugins/linear/auto-apply") {
          return jsonResponse({ autoApply: true });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      pluginListQueryKey(true),
      { autoApplyDisabled: false, plugins: [] },
    );
    render(
      <PluginUpdatesSourceCard plugin={plugin()} autoApplyDisabled={false} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("switch", { name: "Automatic updates" }));

    await vi.waitFor(() => {
      const post = requests.find((request) =>
        request.url.endsWith("/auto-apply"),
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({ enabled: true });
      expect(
        queryClient.getQueryState(pluginListQueryKey(true))
          ?.isInvalidated,
      ).toBe(true);
    });
  });

  it("rejects an echo mismatch with an error toast and no refetch", async () => {
    const errorToast = vi.spyOn(appToast, "error").mockReturnValue("toast");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugins/linear/auto-apply") {
          // The server persisted the opposite of what was asked.
          return jsonResponse({ autoApply: false });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      pluginListQueryKey(true),
      { autoApplyDisabled: false, plugins: [] },
    );
    render(
      <PluginUpdatesSourceCard plugin={plugin()} autoApplyDisabled={false} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("switch", { name: "Automatic updates" }));

    await vi.waitFor(() => {
      expect(errorToast).toHaveBeenCalledWith(
        "Changing automatic updates failed",
        expect.objectContaining({
          description: expect.stringMatching(/unrecognized auto-apply/),
        }),
      );
    });
    expect(
      queryClient.getQueryState(pluginListQueryKey(true))
        ?.isInvalidated,
    ).toBe(false);
  });

  it("shows the org note with the switch off and disabled, even when effective autoApply is on", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard
        plugin={plugin({ autoApply: true })}
        autoApplyDisabled
      />,
      { wrapper },
    );

    expect(
      screen.getByText("Automatic updates are disabled by your organization."),
    ).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: "Automatic updates",
    }) as HTMLButtonElement;
    // Never imply active while the org kill-switch overrides.
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(true);
  });

  it("shows the marketplace-forced note with the switch on and disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/marketplaces") {
          return jsonResponse({ marketplaces: [FORCING_MARKETPLACE] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard
        plugin={plugin({
          provenance: "marketplace",
          marketplaceName: "bb-official",
          autoApply: true,
        })}
        autoApplyDisabled={false}
      />,
      { wrapper },
    );

    expect(
      await screen.findByText("Enabled via the bb-official marketplace."),
    ).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: "Automatic updates",
    }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.disabled).toBe(true);
  });

  it("hides the row on older servers that predate the effective autoApply field", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "not found" }, 404)),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard
        plugin={plugin({ autoApply: null })}
        autoApplyDisabled={false}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId("plugin-auto-apply-row")).toBeNull();
  });
});

describe("PluginUpdatesSourceCard update history", () => {
  it("lazily fetches on expand and renders events newest first, including rollbacks", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/plugins/linear/history") {
        return jsonResponse({
          events: [
            {
              kind: "rollback",
              fromVersion: "1.7.0",
              toVersion: "1.6.2",
              outcome: "rolled-back",
              detail: "failed to start",
              at: 1752300000000,
            },
            {
              kind: "activate",
              fromVersion: "1.6.2",
              toVersion: "1.7.0",
              outcome: "ok",
              at: 1752200000000,
            },
          ],
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard plugin={plugin()} autoApplyDisabled={false} />,
      { wrapper },
    );

    // Collapsed: no fetch yet (lazy).
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/history")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "History" }));

    expect(
      await screen.findByText(/rollback · 1\.7\.0 → 1\.6\.2 · rolled-back/),
    ).toBeTruthy();
    expect(screen.getByText("failed to start")).toBeTruthy();
    expect(screen.getByText(/activate · 1\.6\.2 → 1\.7\.0 · ok/)).toBeTruthy();
  });

  it("shows the empty state when the plugin has no update activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugins/linear/history") {
          return jsonResponse({ events: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginUpdatesSourceCard plugin={plugin()} autoApplyDisabled={false} />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByText("No update activity yet.")).toBeTruthy();
  });
});
