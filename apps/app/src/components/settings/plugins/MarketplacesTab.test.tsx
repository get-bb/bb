// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { marketplaceSearchQueryKey } from "@/hooks/queries/plugin-marketplace-queries";
import { pluginListQueryKey } from "@/hooks/queries/plugin-settings-queries";
import { appToast } from "@/components/ui/app-toast.js";
import { MarketplacesTab } from "./MarketplacesTab";

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

// Server-shaped MarketplaceView (marketplace-service): name mirrors the id,
// displayName is the human label.
const ACME_VIEW = {
  id: "acme",
  name: "acme",
  displayName: "Acme Tools",
  source: "https://github.com/acme/bb-marketplace@main",
  resolvedCommit: "9e12f04aa00c",
  pluginCount: 2,
  lastRefreshAt: 1752300000000,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MarketplacesTab removal", () => {
  it("confirms, DELETEs without a body, and names the converted plugins", async () => {
    const requests: RecordedRequest[] = [];
    const successToast = vi.spyOn(appToast, "success").mockReturnValue("toast");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "/api/v1/marketplaces" && init?.method === undefined) {
          return jsonResponse({ marketplaces: [ACME_VIEW] });
        }
        if (url === "/api/v1/marketplaces/acme" && init?.method === "DELETE") {
          return jsonResponse({ convertedPluginIds: ["datadog", "todoist"] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<MarketplacesTab addOpen={false} onAddOpenChange={() => {}} />, {
      wrapper,
    });

    await screen.findByTestId("marketplace-row-acme");
    // The row shows the human display name, not the stable id.
    expect(screen.getByText("Acme Tools")).toBeTruthy();
    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Marketplace actions for Acme Tools",
      }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));

    // Nothing is deleted before the confirm; the copy states the keep rule.
    expect(await screen.findByText("Remove Acme Tools?")).toBeTruthy();
    expect(screen.getByText(/uninstalls nothing/)).toBeTruthy();
    expect(
      requests.filter((request) => request.init?.method === "DELETE"),
    ).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove marketplace" }));

    await vi.waitFor(() => {
      const del = requests.find((request) => request.init?.method === "DELETE");
      expect(del).toBeDefined();
      expect(del?.init?.body).toBeUndefined();
      expect(successToast).toHaveBeenCalledWith(
        "Removed Acme Tools",
        expect.objectContaining({
          description: "Kept as direct installs: datadog, todoist.",
        }),
      );
    });
  });

  it("refetches the plugin list after removal so converted rows re-render", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/v1/marketplaces" && init?.method === undefined) {
          return jsonResponse({ marketplaces: [ACME_VIEW] });
        }
        if (url === "/api/v1/marketplaces/acme" && init?.method === "DELETE") {
          return jsonResponse({ convertedPluginIds: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    // Converted plugins change provenance/sourceDisplay on the list rows.
    queryClient.setQueryData(pluginListQueryKey(true), { plugins: [] });
    render(<MarketplacesTab addOpen={false} onAddOpenChange={() => {}} />, {
      wrapper,
    });

    await screen.findByTestId("marketplace-row-acme");
    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Marketplace actions for Acme Tools",
      }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove marketplace" }),
    );

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(pluginListQueryKey(true))?.isInvalidated,
      ).toBe(true);
    });
  });

  it("says the cached catalog stays in use after a failed refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/marketplaces") {
          return jsonResponse({
            marketplaces: [{ ...ACME_VIEW, lastError: "fetch failed: 502" }],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<MarketplacesTab addOpen={false} onAddOpenChange={() => {}} />, {
      wrapper,
    });

    await screen.findByText("refresh failed");
    expect(screen.getByText(/using cached catalog from/)).toBeTruthy();
    // A failing marketplace offers Retry, not Refresh.
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });

  it("invalidates marketplace-search queries after a refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/v1/marketplaces" && init?.method === undefined) {
          return jsonResponse({ marketplaces: [ACME_VIEW] });
        }
        if (url === "/api/v1/marketplaces/acme/refresh") {
          return jsonResponse({ marketplace: ACME_VIEW });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    // A Browse-tab search result already in the cache must refetch after a
    // catalog refresh, or removed entries keep rendering.
    queryClient.setQueryData(marketplaceSearchQueryKey(""), []);
    render(<MarketplacesTab addOpen={false} onAddOpenChange={() => {}} />, {
      wrapper,
    });

    await screen.findByTestId("marketplace-row-acme");
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(marketplaceSearchQueryKey(""))?.isInvalidated,
      ).toBe(true);
    });
  });
});
