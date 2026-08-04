// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
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
  pluginId: "memory",
  displayName: "Memory",
  description: "Provider-independent durable memory for agents.",
  icon: "Brain",
  category: "Context & knowledge",
  source: "builtin:memory",
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const CATALOG_STATUS = {
  pluginCount: 13,
  includedPluginCount: 8,
  optionalPluginCount: 5,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrowsePluginsTab", () => {
  it("shows the official plugins and entries", async () => {
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

    expect(
      await screen.findByRole("heading", { name: "Context & knowledge" }),
    ).toBeTruthy();
    expect(screen.queryByText("BB Official plugins")).toBeNull();
    const card = await screen.findByTestId("browse-card-memory");
    expect(card.querySelector('[data-icon="Brain"]')).not.toBeNull();

    const sourceLine = screen.getByTestId("browse-source-memory");
    expect(sourceLine.classList.contains("truncate")).toBe(true);
    expect(sourceLine.getAttribute("title")).toBe(MEMORY_ENTRY.source);
    expect(sourceLine.textContent).toBe(MEMORY_ENTRY.source);

    // The remote-catalog Refresh action is gone: plugins ship with the app.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      displayName: "Memory",
      icon: "Brain",
    });
  });

  it("marks installed entries instead of offering install", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [{ ...MEMORY_ENTRY, installed: true }],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<BrowsePluginsTab onInstall={() => {}} />, { wrapper });

    expect(await screen.findByText("Installed ✓")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });
});
