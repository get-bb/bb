// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { marketplaceSearchQueryKey } from "@/hooks/queries/plugin-marketplace-queries";
import { MarketplacesTab } from "./MarketplacesTab";

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

// Server-shaped MarketplaceView (marketplace-service): name mirrors the id,
// displayName is the human label; no scope/sourceDisplay fields exist.
const ACME_VIEW = {
  id: "acme",
  name: "acme",
  displayName: "Acme Tools",
  source: "https://github.com/acme/bb-marketplace@main",
  resolvedCommit: "9e12f04aa00c",
  pluginCount: 2,
  lastRefreshAt: 1752300000000,
  enabled: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketplacesTab removal", () => {
  it("runs the 422 affectedPlugins flow: chooser radios drive the disposition DELETE", async () => {
    const requests: RecordedRequest[] = [];
    let deletes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (url === "/api/v1/marketplaces" && init?.method === undefined) {
          return jsonResponse({ marketplaces: [ACME_VIEW] });
        }
        if (url === "/api/v1/marketplaces/acme" && init?.method === "DELETE") {
          deletes += 1;
          if (deletes === 1) {
            // First attempt carries no dispositions → the server refuses and
            // names the installed plugins that came from this marketplace.
            return jsonResponse(
              {
                error: "2 installed plugins came from this marketplace",
                affectedPlugins: [
                  { id: "datadog", version: "0.4.1" },
                  { id: "todoist", version: "2.3.0" },
                ],
              },
              422,
            );
          }
          return jsonResponse({ kept: ["datadog"], uninstalled: ["todoist"] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<MarketplacesTab />, { wrapper });

    await screen.findByTestId("marketplace-row-acme");
    // The row shows the human display name, not the stable id.
    expect(screen.getByText("Acme Tools")).toBeTruthy();
    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Marketplace actions for Acme Tools",
      }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove…" }));

    // The blocked DELETE opens the chooser with keep-as-direct defaults.
    expect(await screen.findByText("Remove Acme Tools?")).toBeTruthy();
    const firstDelete = requests.filter(
      (request) => request.init?.method === "DELETE",
    )[0];
    expect(JSON.parse(String(firstDelete?.init?.body))).toEqual({
      dispositions: [],
    });

    // Uninstall todoist, keep datadog.
    fireEvent.click(
      screen.getByLabelText("Uninstall", {
        selector: "#dispose-todoist-uninstall",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove marketplace" }));

    await vi.waitFor(() => {
      const finalDelete = requests.filter(
        (request) => request.init?.method === "DELETE",
      )[1];
      expect(finalDelete).toBeDefined();
      expect(JSON.parse(String(finalDelete?.init?.body))).toEqual({
        dispositions: [
          { pluginId: "datadog", action: "keep" },
          { pluginId: "todoist", action: "uninstall" },
        ],
      });
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
    render(<MarketplacesTab />, { wrapper });

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
    render(<MarketplacesTab />, { wrapper });

    await screen.findByTestId("marketplace-row-acme");
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(marketplaceSearchQueryKey(""))?.isInvalidated,
      ).toBe(true);
    });
  });
});
