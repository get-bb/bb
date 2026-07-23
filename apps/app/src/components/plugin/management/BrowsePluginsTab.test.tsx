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
  category: "Productivity",
  source: "builtin:memory",
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const CATALOG_STATUS = { pluginCount: 4 };

const INCOMPATIBLE_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "future-memory",
  pluginId: "future-memory",
  displayName: "Future Memory",
  compatible: false,
  incompatibleReason: "Requires a newer BB version",
};

const INSTALLED_MEMORY_PLUGIN = {
  id: "memory",
  source: "builtin:memory",
  rootDir: "/official-plugins/memory",
  version: "0.1.0",
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "memory",
  sourceDisplay: "BB Official · Memory",
  updateState: {},
  enabled: true,
  description: MEMORY_ENTRY.description,
  name: MEMORY_ENTRY.displayName,
  icon: MEMORY_ENTRY.icon,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
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
            results: [MEMORY_ENTRY, INCOMPATIBLE_ENTRY],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const onInstall = vi.fn();
    const onOpenInstalled = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <BrowsePluginsTab
        onInstall={onInstall}
        onOpenInstalled={onOpenInstalled}
      />,
      { wrapper },
    );

    expect(await screen.findByText("BB Official plugins")).toBeTruthy();
    expect(await screen.findByText("Memory")).toBeTruthy();
    expect(document.querySelector('[data-icon="Brain"]')).not.toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();

    expect(screen.queryByText(MEMORY_ENTRY.source)).toBeNull();
    expect(screen.getByText("Requires a newer BB version")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Install Future Memory" })
        .hasAttribute("disabled"),
    ).toBe(true);

    // The remote-catalog Refresh action is gone: plugins ship with the app.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    const install = screen.getByRole("button", { name: "Install Memory" });
    expect(install.className).toContain("w-7");
    fireEvent.pointerMove(install);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Install Memory",
    );
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      displayName: "Memory",
      icon: "Brain",
    });
  });

  it("uses the shared error state and retries catalog searches", async () => {
    let searchAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          searchAttempts += 1;
          return searchAttempts === 1
            ? jsonResponse({ error: "unavailable" }, 503)
            : jsonResponse({ results: [MEMORY_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <BrowsePluginsTab onInstall={() => {}} onOpenInstalled={() => {}} />,
      { wrapper },
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "BB's official plugins are unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Memory")).toBeTruthy();
    expect(searchAttempts).toBe(2);
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
        if (url === "/api/v1/plugins") {
          return jsonResponse({
            enabled: true,
            plugins: [INSTALLED_MEMORY_PLUGIN],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const onOpenInstalled = vi.fn();
    render(
      <BrowsePluginsTab
        onInstall={() => {}}
        onOpenInstalled={onOpenInstalled}
      />,
      { wrapper },
    );

    const installed = await screen.findByRole("button", {
      name: "Uninstall Memory",
    });
    expect(installed.className).toContain("w-7");
    fireEvent.pointerMove(installed);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Uninstall Memory",
    );
    expect(document.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Open Memory details" }),
    );
    expect(onOpenInstalled).toHaveBeenCalledWith("memory");
  });

  it("uses the catalog's canonical plugin id for uninstall", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [
              {
                ...MEMORY_ENTRY,
                entryId: "docs",
                pluginId: "simple-notes",
                displayName: "Docs",
                source: "builtin:docs",
                installed: true,
              },
            ],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({
            enabled: true,
            plugins: [
              {
                ...INSTALLED_MEMORY_PLUGIN,
                id: "simple-notes",
                source: "npm:bb-plugin-simple-notes@^0.1.0",
                catalogEntryId: "simple-notes",
              },
            ],
          });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    const onOpenInstalled = vi.fn();
    render(
      <BrowsePluginsTab
        onInstall={() => {}}
        onOpenInstalled={onOpenInstalled}
      />,
      { wrapper },
    );

    expect(
      await screen.findByRole("button", { name: "Uninstall Docs" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Docs details" }));
    expect(onOpenInstalled).toHaveBeenCalledWith("simple-notes");
  });
});
