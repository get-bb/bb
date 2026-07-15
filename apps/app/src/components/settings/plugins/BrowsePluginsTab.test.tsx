// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pluginCatalogSearchQueryKey,
  pluginCatalogStatusQueryKey,
  type PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowsePluginsTab } from "./BrowsePluginsTab";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MEMORY_ENTRY: PluginCatalogSearchEntry = {
  entryId: "memory",
  displayName: "Memory",
  description: "Provider-independent durable memory for agents.",
  icon: "Brain",
  category: "Productivity",
  source: "github-release:ymichael/bb/bb-plugin-memory-{version}.tgz@^0.1.0",
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const CATALOG_STATUS = {
  pluginCount: 3,
  lastRefreshAt: 1_752_300_000_000,
  lastAttemptAt: 1_752_300_000_000,
  lastError: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrowsePluginsTab", () => {
  it("shows the official catalog status and entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [MEMORY_ENTRY],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const onInstall = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(<BrowsePluginsTab onInstall={onInstall} />, { wrapper });

    expect(await screen.findByText("BB Official catalog")).toBeTruthy();
    const card = await screen.findByTestId("browse-card-memory");
    expect(card.querySelector('[data-icon="Brain"]')).not.toBeNull();

    const sourceLine = screen.getByTestId("browse-source-memory");
    expect(sourceLine.classList.contains("truncate")).toBe(true);
    expect(sourceLine.getAttribute("title")).toBe(MEMORY_ENTRY.source);
    expect(sourceLine.textContent).toBe(MEMORY_ENTRY.source);

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      displayName: "Memory",
      icon: "Brain",
    });
  });

  it("invalidates catalog search results after a successful refresh", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog/refresh") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginCatalogStatusQueryKey(), CATALOG_STATUS);
    queryClient.setQueryData(pluginCatalogSearchQueryKey(""), [MEMORY_ENTRY]);
    queryClient.setQueryData(pluginCatalogSearchQueryKey("cached"), []);
    render(<BrowsePluginsTab onInstall={() => {}} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await vi.waitFor(() => {
      expect(
        queryClient.getQueryState(pluginCatalogSearchQueryKey("cached"))
          ?.isInvalidated,
      ).toBe(true);
    });
  });

  it("keeps cached results when refresh reports a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog/refresh") {
          return jsonResponse({
            catalog: {
              ...CATALOG_STATUS,
              lastError: "upstream unavailable",
            },
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginCatalogStatusQueryKey(), CATALOG_STATUS);
    queryClient.setQueryData(pluginCatalogSearchQueryKey(""), [MEMORY_ENTRY]);
    render(<BrowsePluginsTab onInstall={() => {}} />, { wrapper });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(
      (await screen.findByTestId("catalog-refresh-error")).textContent,
    ).toContain("upstream unavailable");
    expect(screen.getByTestId("browse-card-memory")).toBeTruthy();
    expect(
      queryClient.getQueryState(pluginCatalogSearchQueryKey(""))?.isInvalidated,
    ).not.toBe(true);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
