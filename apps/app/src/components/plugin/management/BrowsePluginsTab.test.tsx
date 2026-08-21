// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PluginCatalogSearchEntry } from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowsePluginsTab } from "./BrowsePluginsTab";

// The hero mounts bb's real new-thread composer on demand; it needs live
// project/host/provider queries this suite doesn't provide, and the tab's own
// contract is only that create affordances open it.
vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-composer">{initialPrompt}</div>
  ),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const MEMORY_ENTRY: PluginCatalogSearchEntry = {
  entryId: "memory",
  marketplace: "bb-community",
  pluginId: "memory",
  displayName: "Memory",
  description: "Provider-independent durable memory for agents.",
  icon: "Brain",
  iconUrl: null,
  iconTinted: false,
  category: "Context & knowledge",
  source: "builtin:memory",
  repositoryUrl: null,
  marketplaceDisplayName: "BB Community",
  publisherKey: "builtin",
  publisherLabel: "BB Official",
  official: true,
  author: null,
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
  marketplace: "bb-community",
  pluginId: "future-memory",
  displayName: "Future Memory",
  compatible: false,
  incompatibleReason: "Requires a newer BB version",
};

const GITHUB_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "github",
  marketplace: "bb-community",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  iconUrl: null,
  iconTinted: false,
  category: "Developer tools",
  source: "builtin:github",
};

const INSTALLED_MEMORY_PLUGIN = {
  id: "memory",
  source: "builtin:memory",
  rootDir: "/plugins/memory",
  version: "0.1.0",
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "memory",
  publisherKey: "bb-community",
  publisherLabel: "BB Community",
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
  // Browse groups by marketplace only; entries render as one flat grid per
  // marketplace, so the sort direction orders the whole group.
  it("sorts by plugin name across the grid and reverses direction", async () => {
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
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      {
        wrapper,
      },
    );

    expect(await screen.findByText("Alpha")).toBeTruthy();
    const cardOrder = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="Open "][aria-label$=" details"]',
        ),
      ].map((button) => button.getAttribute("aria-label"));
    // "Middle" is the incompatible entry: hidden from Browse entirely.
    expect(cardOrder()).toEqual(["Open Alpha details", "Open Zulu details"]);

    const sortTrigger = screen.getByRole("button", {
      name: "Sort: Plugin name, ascending",
    });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Plugin name" }));
    expect(cardOrder()).toEqual(["Open Zulu details", "Open Alpha details"]);
    // Category never renders as a heading; it stays a filter only.
    expect(screen.queryByText("Context & knowledge")).toBeNull();
    expect(screen.queryByText("Developer tools")).toBeNull();
  });

  it("groups entries by marketplace and names third-party origins on cards", async () => {
    const entries = [
      { ...MEMORY_ENTRY, displayName: "Memory" },
      {
        ...MEMORY_ENTRY,
        entryId: "notes",
        pluginId: "notes",
        displayName: "Acme Notes",
        category: "Git Tools",
        marketplace: "acme-plugins",
        marketplaceDisplayName: "Acme Plugins",
        publisherKey: "acme-plugins",
        publisherLabel: "Acme Plugins",
        official: false,
        author: { name: "Acme", url: "https://github.com/acme" },
        repositoryUrl: "https://github.com/acme/notes",
      },
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
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findByText("Acme Notes");
    // Two marketplaces, so each group names itself and the third-party one
    // says what it is.
    expect(screen.getByText("BB Official")).toBeTruthy();
    expect(screen.getAllByText("Acme Plugins").length).toBeGreaterThan(0);
    expect(screen.getByText("third-party marketplace")).toBeTruthy();
    // Cards carry the author with the "By:" prefix.
    expect(screen.getByText("By: Acme")).toBeTruthy();
    // The card links the repository; a bundled entry has none to link.
    const repositoryLink = screen.getByRole("link", {
      name: "Open Acme Notes repository",
    });
    expect(repositoryLink.getAttribute("href")).toBe(
      "https://github.com/acme/notes",
    );
    expect(
      screen.queryByRole("link", { name: "Open Memory repository" }),
    ).toBeNull();
  });

  it("keeps a marketplace that copies a publisher label in its own group", async () => {
    const entries = [
      { ...MEMORY_ENTRY, displayName: "Memory" },
      {
        ...MEMORY_ENTRY,
        entryId: "notes",
        pluginId: "notes",
        displayName: "Acme Notes",
        marketplace: "acme-plugins",
        marketplaceDisplayName: "BB Official",
        // The manifest names itself, so a third-party marketplace can claim a
        // BB label. The server refuses it; grouping must not restore it by
        // keying on the label the entry carries.
        publisherKey: "acme-plugins",
        publisherLabel: "acme-plugins",
        official: false,
        author: { name: "Acme", url: "https://github.com/acme" },
      },
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
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    await screen.findByText("Acme Notes");
    // Two groups, and the third-party one keeps its note. Merging would have
    // hidden that note and lent the entry BB's badge.
    expect(screen.getByText("BB Official")).toBeTruthy();
    expect(screen.getByText("third-party marketplace")).toBeTruthy();
  });

  it("renders every catalog entry once and filters the grid by category", async () => {
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
    const { container } = render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // An open Radix menu marks the grid aria-hidden, so count cards in the DOM.
    const cardCount = () =>
      container.querySelectorAll('[aria-label^="Open Official "]').length;

    expect(await screen.findByText("Official 1")).toBeTruthy();
    expect(cardCount()).toBe(CATALOG_STATUS.pluginCount);
    // Category is a toolbar multi-select, not a pill row, so the browse page
    // keeps one flush content band.
    expect(
      screen.queryByRole("radiogroup", { name: "Filter plugins by category" }),
    ).toBeNull();
    const categoryTrigger = screen.getByRole("button", { name: "Category" });
    fireEvent.pointerDown(categoryTrigger);
    // No explicit "All" row: an empty selection already means every category.
    expect(screen.queryByRole("menuitemcheckbox", { name: "All" })).toBeNull();

    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Developer tools" }),
    );
    expect(cardCount()).toBe(6);
    expect(
      container.querySelector('[aria-label="Open Official 1 details"]'),
    ).toBeNull();

    // Selections accumulate rather than replace.
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Context & knowledge" }),
    );
    expect(cardCount()).toBe(CATALOG_STATUS.pluginCount);

    // Clearing every category returns to unfiltered, not empty.
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Developer tools" }),
    );
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Context & knowledge" }),
    );
    expect(cardCount()).toBe(CATALOG_STATUS.pluginCount);
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
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={onInstall}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
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
    expect(
      screen.getAllByText(MEMORY_ENTRY.description).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(GITHUB_ENTRY.description)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Category" })).toBeTruthy();
    // The catalog grid stays flat — no per-source section heading above it.
    // The discovery hero's own heading sits above the results and is expected.
    expect(
      screen.queryByRole("heading", { name: /BB Official plugins/i }),
    ).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain(
      "Turn bb into",
    );
    expect(screen.getByRole("button", { name: "Install Memory" })).toBeTruthy();
    expect(screen.queryByText("BB Official plugins")).toBeNull();

    expect(screen.queryByText(MEMORY_ENTRY.source)).toBeNull();
    // Incompatible entries never render on Browse: an entry this BB cannot
    // install is noise. The CLI search still reports them with reasons.
    expect(screen.queryByText("Future Memory")).toBeNull();
    expect(screen.queryByText("Requires a newer BB version")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Install Future Memory" }),
    ).toBeNull();

    // The remote-catalog Refresh action is gone: plugins ship with the app.
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();

    const install = screen.getByRole("button", { name: "Install Memory" });
    expect(install.querySelector('[data-icon="Download"]')).not.toBeNull();
    fireEvent.pointerMove(install);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Install Memory",
    );
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      marketplace: "bb-community",
      publisherLabel: "BB Official",
      displayName: "Memory",
      icon: "Brain",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:memory",
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
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={() => {}}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      {
        wrapper,
      },
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
    const onOpenPlugin = vi.fn();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    const installed = await screen.findByRole("button", {
      name: "Uninstall Memory",
    });
    fireEvent.pointerMove(installed);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Installed — uninstall Memory",
    );
    // A check, not a download arrow: the corner glyph must read as state
    // ("installed"), never as an available install action.
    expect(installed.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(installed.querySelector('[data-icon="Download"]')).toBeNull();
    // The installed state reads as a plain success-tinted glyph: no outline,
    // no fill, at rest or on hover/focus.
    // Tokenize: `toContain` also matches inside the hover:/focus-visible:
    // twins, which would leave the resting state unverified.
    const installedClasses = new Set(installed.className.split(/\s+/));
    for (const restingClass of ["border-transparent", "bg-transparent"]) {
      expect(installedClasses.has(restingClass)).toBe(true);
    }
    for (const variantClass of [
      "hover:border-transparent",
      "hover:bg-transparent",
      "focus-visible:border-transparent",
      "focus-visible:bg-transparent",
    ]) {
      expect(installedClasses.has(variantClass)).toBe(true);
    }
    // Tokenized for the same reason as the border/bg checks above: the resting
    // tint IS the feature here, and `toContain` would be satisfied by the
    // hover:/focus-visible: twins alone, leaving it unverified.
    const successTint =
      "text-[color:color-mix(in_oklab,var(--success)_72%,var(--ink))]";
    expect(installedClasses.has(successTint)).toBe(true);
    expect(installedClasses.has(`hover:${successTint}`)).toBe(true);
    expect(installedClasses.has(`focus-visible:${successTint}`)).toBe(true);
    expect(installedClasses.has("text-success-foreground")).toBe(false);
    expect(installedClasses.has("hover:text-foreground")).toBe(false);
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    fireEvent.click(installed);
    expect(
      screen.getByRole("heading", { name: "Uninstall Memory?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

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
                marketplace: "bb-community",
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
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => {}}
          onOpenPlugin={onOpenPlugin}
          onInstallFromSource={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      await screen.findByRole("button", { name: "Uninstall Docs" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open Docs details" }));
    expect(onOpenPlugin).toHaveBeenCalledWith("simple-notes");
  });

  it("swaps the browse body for examples while composing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search")) {
          return jsonResponse({ results: [MEMORY_ENTRY, GITHUB_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstallFromSource={() => {}}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // Default state: search + catalog, no example cards anywhere.
    expect(
      await screen.findByRole("button", { name: "Open Memory details" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("textbox", { name: "Search plugins" }),
    ).toBeTruthy();
    expect(screen.queryByText("Start from an example")).toBeNull();

    // Composing: examples replace the search + catalog wholesale.
    fireEvent.click(screen.getByRole("button", { name: "Create a plugin" }));
    expect(await screen.findByText("Start from an example")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Search plugins" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Memory details" }),
    ).toBeNull();

    // Create is enter-only: repeated activation keeps the creation body open.
    fireEvent.click(screen.getByRole("button", { name: "Create a plugin" }));
    expect(await screen.findByText("Start from an example")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Open Memory details" }),
    ).toBeNull();
  });

  it("routes every create affordance into the inline composer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/v1/plugin-catalog") {
          return jsonResponse({ catalog: CATALOG_STATUS });
        }
        if (url.startsWith("/api/v1/plugin-catalog/search")) {
          return jsonResponse({ results: [MEMORY_ENTRY] });
        }
        if (url === "/api/v1/plugins") {
          return jsonResponse({ enabled: true, plugins: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstallFromSource={() => {}}
          onInstall={() => {}}
          onOpenPlugin={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // The CTA opens the composer blank, which also reveals the example cards.
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a plugin" }),
    );
    const blank = await screen.findByTestId("inline-composer");
    expect(blank.textContent).toBe("Create a new bb plugin that ");

    // A use-case card re-seeds the open composer with its brief.
    // (The hook is the unique handle; the title also appears on a hero chip.)
    fireEvent.click(
      screen.getByText(
        "Ship a board your agents move cards across while they work.",
      ),
    );
    const seeded = await screen.findByTestId("inline-composer");
    expect(seeded.textContent).toContain("kanban board panel");

    // A capability-tier card seeds its own brief the same way.
    fireEvent.click(screen.getByText("CLI command"));
    expect(
      (await screen.findByTestId("inline-composer")).textContent,
    ).toContain("deploys the current branch to staging");
  });
});
