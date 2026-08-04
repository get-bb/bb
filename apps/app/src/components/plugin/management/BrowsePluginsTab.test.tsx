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

const INCOMPATIBLE_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "future-memory",
  pluginId: "future-memory",
  displayName: "Future Memory",
  compatible: false,
  incompatibleReason: "Requires a newer BB version",
};

const GITHUB_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "github",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  category: "Developer tools",
  source: "builtin:github",
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
  it("sorts by plugin name ascending by default and reverses direction", async () => {
    const entries = [
      { ...MEMORY_ENTRY, displayName: "Zulu" },
      { ...GITHUB_ENTRY, displayName: "Alpha" },
      { ...INCOMPATIBLE_ENTRY, displayName: "Middle" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<BrowsePluginsTab onInstall={() => {}} onOpenPlugin={() => {}} />, {
      wrapper,
    });

    expect(await screen.findByText("Alpha")).toBeTruthy();
    const cardOrder = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open "][aria-label$=" details"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
    expect(cardOrder()).toEqual([
      "Open Alpha details",
      "Open Middle details",
      "Open Zulu details",
    ]);

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Plugin name" }));
    expect(cardOrder()).toEqual([
      "Open Zulu details",
      "Open Middle details",
      "Open Alpha details",
    ]);
  });

  it("renders every catalog entry once and filters the grid with category pills", async () => {
    const entries = Array.from(
      { length: CATALOG_STATUS.pluginCount },
      (_, index) => ({
        ...MEMORY_ENTRY,
        entryId: `official-${index + 1}`,
        pluginId: `official-${index + 1}`,
        displayName: `Official ${index + 1}`,
        category: index % 2 === 0 ? "Context & knowledge" : "Developer tools",
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({ results: entries });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<BrowsePluginsTab onInstall={() => {}} onOpenPlugin={() => {}} />, {
      wrapper,
    });

    expect(await screen.findByText("Official 1")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /^Open Official \d+ details$/ }),
    ).toHaveLength(CATALOG_STATUS.pluginCount);
    expect(
      screen.getByRole("radiogroup", { name: "Filter plugins by category" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Context & knowledge" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Developer tools" }));
    expect(
      screen.getAllByRole("button", { name: /^Open Official \d+ details$/ }),
    ).toHaveLength(6);
    expect(screen.queryByText("Official 1")).toBeNull();
    fireEvent.click(
      screen.getByRole("radio", { name: "Show all plugin categories" }),
    );
    expect(
      screen.getAllByRole("button", { name: /^Open Official \d+ details$/ }),
    ).toHaveLength(CATALOG_STATUS.pluginCount);
    expect(screen.queryByText("BB Official plugins")).toBeNull();
  });

  it("shows the official plugins and entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url === "/api/v1/plugin-catalog/search?q=") {
          return jsonResponse({
            results: [MEMORY_ENTRY, INCOMPATIBLE_ENTRY, GITHUB_ENTRY],
          });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const onInstall = vi.fn();
    const onOpenPlugin = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <BrowsePluginsTab onInstall={onInstall} onOpenPlugin={onOpenPlugin} />,
      { wrapper },
    );

    expect(await screen.findByText("Memory")).toBeTruthy();
    const memoryCard = (await screen.findByText("Memory")).closest("div");
    expect(memoryCard).not.toBeNull();
    // Scoped to the card on purpose: INCOMPATIBLE_ENTRY spreads MEMORY_ENTRY
    // and inherits its Brain icon, so a document-wide lookup passes even when
    // the Memory card renders no leading icon at all.
    expect(
      (memoryCard as HTMLElement).querySelector('[data-icon="Brain"]'),
    ).not.toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();
    const githubGrid = screen
      .getByRole("button", { name: "Open GitHub details" })
      .closest('[class*="auto-fill"]');
    expect(githubGrid?.className).toContain("auto-fill");
    expect(githubGrid?.className).toContain("18rem");
    const githubCard = screen
      .getByRole("button", { name: "Open GitHub details" })
      .closest(".group");
    expect(githubCard?.className).toContain("min-h-20");
    expect(githubCard?.className).toContain("p-2.5");
    const memoryDescriptions = screen.getAllByText(MEMORY_ENTRY.description);
    const githubDescription = screen.getByText(GITHUB_ENTRY.description);
    for (const memoryDescription of memoryDescriptions) {
      expect(memoryDescription.className).toContain("min-h-[2lh]");
      expect(memoryDescription.parentElement?.className).toContain(
        "line-clamp-2",
      );
    }
    expect(githubDescription.className).toContain("min-h-[2lh]");
    expect(
      screen.getByRole("radio", { name: "Context & knowledge" }),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Developer tools" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByRole("button", { name: "Install Memory" })).toBeTruthy();
    expect(screen.queryByText("BB Official plugins")).toBeNull();

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
    fireEvent.click(
      screen.getByRole("button", { name: "Open Memory details" }),
    );
    expect(onOpenPlugin).toHaveBeenCalledWith("memory");
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
    render(<BrowsePluginsTab onInstall={() => {}} onOpenPlugin={() => {}} />, {
      wrapper,
    });

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
    const onOpenPlugin = vi.fn();
    render(
      <BrowsePluginsTab onInstall={() => {}} onOpenPlugin={onOpenPlugin} />,
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
    expect(onOpenPlugin).toHaveBeenCalledWith("memory");
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
    const onOpenPlugin = vi.fn();
    render(
      <BrowsePluginsTab onInstall={() => {}} onOpenPlugin={onOpenPlugin} />,
      { wrapper },
    );

    expect(
      await screen.findByRole("button", { name: "Uninstall Docs" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Docs details" }));
    expect(onOpenPlugin).toHaveBeenCalledWith("simple-notes");
  });
});
