// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  PluginCatalogSearchData,
  PluginCatalogSearchEntry,
} from "@/hooks/queries/plugin-catalog-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowsePluginsTab } from "./BrowsePluginsTab";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { PLUGINS_BROWSE_DESCRIPTION } from "../plugins-collection-copy";

vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-composer">{initialPrompt}</div>
  ),
}));

const MEMORY_ENTRY: PluginCatalogSearchEntry = {
  entryId: "memory",
  pluginId: "memory",
  displayName: "Memory",
  description: "Durable memory for agents.",
  icon: "Brain",
  iconUrl: null,
  iconTinted: false,
  categoryId: "memory-and-context",
  category: "Memory & Context",
  screenshots: [],
  collections: [],
  publishedAt: "2026-08-20T00:00:00Z",
  source: "builtin:memory",
  repositoryUrl: null,
  marketplace: "bb-official",
  marketplaceDisplayName: "BB Official",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  official: true,
  author: {
    name: "BB",
    github: "get-bb",
    url: "https://github.com/get-bb",
  },
  installed: false,
  installs: 4_210,
  compatible: true,
  incompatibleReason: null,
};

const SECURITY_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "security",
  pluginId: "security",
  displayName: "Security",
  description: "Protect agent work.",
  categoryId: "security",
  category: "Security",
  publishedAt: undefined,
  installs: 900,
};

const TASKS_ENTRY: PluginCatalogSearchEntry = {
  ...MEMORY_ENTRY,
  entryId: "tasks",
  pluginId: "tasks",
  displayName: "Tasks",
  description: "Track work.",
  categoryId: "tasks-and-workflows",
  category: "Tasks & Workflows",
  publishedAt: "2026-08-25T00:00:00Z",
  installs: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubCatalog(data: PluginCatalogSearchData) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/plugin-catalog/search")) {
        return jsonResponse({
          results: data.entries,
          collections: data.collections,
        });
      }
      return jsonResponse({ error: "not found" }, 404);
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderBrowse(
  data: PluginCatalogSearchData,
  initialEntry = "/plugins",
  onInstall = vi.fn(),
  onOpenPlugin = vi.fn(),
) {
  stubCatalog(data);
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BrowsePluginsTab
        onInstall={onInstall}
        onOpenPlugin={onOpenPlugin}
        onInstallFromSource={() => undefined}
      />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper },
  );
  return { onInstall, onOpenPlugin };
}

function cardOrder(): string[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Open "][aria-label$=" details"]',
    ),
  ].map((button) => button.getAttribute("aria-label") ?? "");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowsePluginsTab", () => {
  it("puts the shared create action in the compact toolbar and keeps the page description", async () => {
    stubCatalog({ entries: [MEMORY_ENTRY], collections: [] });
    const { wrapper } = createQueryClientTestHarness();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <MemoryRouter initialEntries={["/plugins?query=Memory"]}>
          <BrowsePluginsTab
            onInstall={() => undefined}
            onOpenPlugin={() => undefined}
            onInstallFromSource={() => undefined}
          />
          <LocationProbe />
        </MemoryRouter>
      </CompactViewportOverrideProvider>,
      { wrapper },
    );
    const create = await screen.findByRole("button", { name: "New plugin" });
    expect(create.closest("[data-resource-toolbar]")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "New plugin options" })
        .closest("[data-resource-toolbar]"),
    ).toBe(create.closest("[data-resource-toolbar]"));
    expect(
      screen.getAllByText(PLUGINS_BROWSE_DESCRIPTION).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Plugin Guide" })).toBeNull();
    fireEvent.click(create);
    expect(await screen.findByTestId("inline-composer")).toBeTruthy();
    expect(screen.getByTestId("location-search").textContent).toContain(
      "query=Memory&view=create",
    );
  });

  it("shows collection shelves before category shelves", async () => {
    renderBrowse({
      entries: [
        {
          ...MEMORY_ENTRY,
          collections: [{ id: "new-and-notable", rank: 1 }],
        },
        SECURITY_ENTRY,
        {
          ...TASKS_ENTRY,
          collections: [{ id: "new-and-notable", rank: 0 }],
        },
      ],
      collections: [
        {
          id: "new-and-notable",
          displayName: "New & notable",
          pluginIds: ["tasks", "memory"],
        },
      ],
    });

    await screen.findByRole("heading", { name: "New & notable" });
    const labels = [
      ...document.querySelectorAll("[data-testid='plugin-browse-shelves'] h2"),
    ].map((heading) => heading.textContent);
    expect(labels).toEqual([
      "New & notable",
      "Memory & Context",
      "Security",
      "Tasks & Workflows",
    ]);
    expect(screen.getAllByText("Memory")).toHaveLength(2);
    expect(screen.queryByText("BB Official plugins")).toBeNull();
  });

  it("round trips the search parameter", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY], collections: [] },
      "/plugins?query=Mem",
    );

    const search = await screen.findByRole("textbox", {
      name: "Search plugins",
    });
    expect((search as HTMLInputElement).value).toBe("Mem");
    fireEvent.change(search, { target: { value: "Memory" } });

    const params = new URLSearchParams(
      screen.getByTestId("location-search").textContent ?? "",
    );
    expect(params.get("query")).toBe("Memory");
  });

  it("routes the card author name and preserves the Browse filters", async () => {
    const onOpenPlugin = vi.fn();
    renderBrowse(
      { entries: [MEMORY_ENTRY], collections: [] },
      "/plugins?category=memory-and-context&sort=recently-added",
      vi.fn(),
      onOpenPlugin,
    );

    fireEvent.click(await screen.findByRole("link", { name: "BB Official" }));
    const params = new URLSearchParams(
      screen.getByTestId("location-search").textContent ?? "",
    );
    expect(params.get("author")).toBe("11:bb-official:github:get-bb");
    expect(params.getAll("category")).toEqual(["memory-and-context"]);
    expect(params.get("sort")).toBe("recently-added");
    expect(onOpenPlugin).not.toHaveBeenCalled();
  });

  it("round trips repeatable category parameters", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY, SECURITY_ENTRY, TASKS_ENTRY], collections: [] },
      "/plugins?category=memory-and-context&category=security",
    );

    const trigger = await screen.findByRole("button", {
      name: "Filter plugins by category: Memory & Context, Security",
    });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("option", { name: /Tasks & Workflows/u }),
    );

    const params = new URLSearchParams(
      screen.getByTestId("location-search").textContent ?? "",
    );
    expect(params.getAll("category")).toEqual([
      "memory-and-context",
      "security",
      "tasks-and-workflows",
    ]);
    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    const nextParams = new URLSearchParams(
      screen.getByTestId("location-search").textContent ?? "",
    );
    expect(nextParams.getAll("category")).toEqual([
      "memory-and-context",
      "tasks-and-workflows",
    ]);
  });

  it("orders category options by shelf order and omits missing categories", async () => {
    renderBrowse({
      entries: [
        TASKS_ENTRY,
        {
          ...MEMORY_ENTRY,
          entryId: "unknown",
          pluginId: "unknown",
          displayName: "Unknown",
          categoryId: "unknown-category",
          category: "Unknown Category",
        },
        {
          ...MEMORY_ENTRY,
          entryId: "uncategorized",
          pluginId: "uncategorized",
          displayName: "Uncategorized",
          categoryId: undefined,
          category: undefined,
        },
        SECURITY_ENTRY,
        MEMORY_ENTRY,
      ],
      collections: [],
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    expect(
      (await screen.findAllByRole("option")).map(
        (option) => option.textContent,
      ),
    ).toEqual([
      expect.stringContaining("Memory & Context"),
      expect.stringContaining("Security"),
      expect.stringContaining("Tasks & Workflows"),
      expect.stringContaining("Unknown Category"),
    ]);
  });

  it("disables the install sort when no listing publishes a count", async () => {
    renderBrowse({
      entries: [
        { ...MEMORY_ENTRY, installs: null },
        { ...SECURITY_ENTRY, installs: null },
      ],
      collections: [],
    });

    const sortTrigger = await screen.findByRole("button", {
      name: "Sort: Default",
    });
    fireEvent.pointerDown(sortTrigger);
    expect(
      screen
        .getByRole("menuitemradio", { name: "Installs" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("sorts by install count and sinks uncounted entries in both directions", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY, SECURITY_ENTRY, TASKS_ENTRY], collections: [] },
      "/plugins?sort=most-installed",
    );

    await screen.findByText("Memory");
    expect(cardOrder()).toEqual([
      "Open Memory details",
      "Open Security details",
      "Open Tasks details",
    ]);
    const trigger = screen.getByRole("button", {
      name: "Sort: Installs, descending",
    });
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Installs" }));
    expect(cardOrder()).toEqual([
      "Open Security details",
      "Open Memory details",
      "Open Tasks details",
    ]);
    expect(screen.getByText("Memory & Context")).toBeTruthy();
  });

  it("puts entries without a published date last in both directions", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY, SECURITY_ENTRY, TASKS_ENTRY], collections: [] },
      "/plugins?sort=recently-added",
    );

    await screen.findByText("Memory");
    expect(cardOrder()).toEqual([
      "Open Tasks details",
      "Open Memory details",
      "Open Security details",
    ]);
    const trigger = screen.getByRole("button", {
      name: "Sort: Published, descending",
    });
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Published" }));
    expect(cardOrder()).toEqual([
      "Open Memory details",
      "Open Tasks details",
      "Open Security details",
    ]);
  });

  it("clears a flat sort and restores the shelves", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY, SECURITY_ENTRY], collections: [] },
      "/plugins?sort=most-installed",
    );

    const trigger = await screen.findByRole("button", {
      name: "Sort: Installs, descending",
    });
    expect(screen.queryByTestId("plugin-browse-shelves")).toBeNull();
    fireEvent.pointerDown(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Clear sort" }));
    expect(await screen.findByTestId("plugin-browse-shelves")).toBeTruthy();
    const params = new URLSearchParams(
      screen.getByTestId("location-search").textContent ?? "",
    );
    expect(params.has("sort")).toBe(false);
    expect(params.has("direction")).toBe(false);
  });

  it("opens a category shelf route and returns to Browse", async () => {
    const entries = Array.from({ length: 8 }, (_, index) => ({
      ...MEMORY_ENTRY,
      entryId: `memory-${index}`,
      pluginId: `memory-${index}`,
      displayName: `Memory ${index}`,
    }));
    renderBrowse({ entries, collections: [] });

    await screen.findByTestId("plugin-browse-shelves");
    expect(cardOrder()).toHaveLength(6);
    fireEvent.click(
      screen.getAllByRole("link", { name: "See all Memory & Context" })[0]!,
    );
    expect(cardOrder()).toHaveLength(8);
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?shelf=category%3Amemory-and-context",
    );
    expect(
      screen.getByRole("heading", { name: "Memory & Context 8 plugins" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("plugin-browse-shelves")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Filter plugins by category:/ }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Browse plugins" }));
    expect(await screen.findByTestId("plugin-browse-shelves")).toBeTruthy();
    expect(cardOrder()).toHaveLength(6);
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("location-search").textContent).toBe("");
  });

  it("loads a curated shelf directly and preserves its order", async () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      ...MEMORY_ENTRY,
      entryId: `memory-${index}`,
      pluginId: `memory-${index}`,
      displayName: `Memory ${index}`,
      collections: [{ id: "new-and-notable", rank: 4 - index }],
    }));
    renderBrowse(
      {
        entries: [...entries, SECURITY_ENTRY],
        collections: [
          {
            id: "new-and-notable",
            displayName: "New & notable",
            pluginIds: [...entries].reverse().map((entry) => entry.entryId),
          },
        ],
      },
      "/plugins?shelf=collection%3Anew-and-notable",
    );

    await screen.findByRole("heading", { name: "New & notable 5 plugins" });
    expect(cardOrder()).toEqual(
      [...entries]
        .reverse()
        .map((entry) => `Open ${entry.displayName} details`),
    );
    expect(screen.queryByText("Security")).toBeNull();
    expect(screen.queryByTestId("plugin-browse-shelves")).toBeNull();
  });

  it("scopes a category page to its category and restores Browse filters on return", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY, SECURITY_ENTRY], collections: [] },
      "/plugins?shelf=category%3Amemory-and-context&category=security",
    );
    await screen.findByRole("heading", { name: "Memory & Context 1 plugin" });
    expect(cardOrder()).toEqual(["Open Memory details"]);
    fireEvent.click(screen.getByRole("link", { name: "Browse plugins" }));
    expect(screen.getByTestId("location-search").textContent).toBe(
      "?category=security",
    );
  });

  it("offers Browse when a shelf address does not exist", async () => {
    renderBrowse(
      { entries: [MEMORY_ENTRY], collections: [] },
      "/plugins?shelf=collection%3Amissing",
    );
    await screen.findByText("Shelf not found.");
    expect(
      screen.getByRole("link", { name: "Browse plugins" }).getAttribute("href"),
    ).toBe("/plugins");
  });

  it("uses the shared error state and retries catalog searches", async () => {
    let searchAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/api/v1/plugin-catalog/search")) {
          searchAttempts += 1;
          return searchAttempts === 1
            ? jsonResponse({ error: "unavailable" }, 503)
            : jsonResponse({ results: [MEMORY_ENTRY], collections: [] });
        }
        return jsonResponse({ error: "not found" }, 404);
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <BrowsePluginsTab
          onInstall={() => undefined}
          onOpenPlugin={() => undefined}
          onInstallFromSource={() => undefined}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "The plugin catalog is not available.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Memory")).toBeTruthy();
    expect(searchAttempts).toBe(2);
  });

  it("marks installed entries instead of offering install", async () => {
    renderBrowse({
      entries: [{ ...MEMORY_ENTRY, installed: true }],
      collections: [],
    });

    const installed = await screen.findByLabelText("Installed");
    expect(installed.textContent).toContain("Installed");
    expect(installed.querySelector('[data-icon="Check"]')).toBeTruthy();
    expect(screen.getByLabelText("4,210 installs")).toBeTruthy();
    expect(installed.tagName).toBe("SPAN");
    expect(
      screen.queryByRole("button", { name: /Install Memory/u }),
    ).toBeNull();
  });

  it("swaps the browse body for examples while composing", async () => {
    renderBrowse({ entries: [MEMORY_ENTRY], collections: [] });

    expect(
      await screen.findByRole("button", { name: "Open Memory details" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));
    expect(await screen.findByText("Start from an example")).toBeTruthy();
    expect(screen.getByText("Explore plugin capabilities")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Search plugins" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Memory details" }),
    ).toBeNull();
  });

  it("routes every create affordance into the inline composer", async () => {
    renderBrowse({ entries: [MEMORY_ENTRY], collections: [] });

    fireEvent.click(await screen.findByRole("button", { name: "New plugin" }));
    expect((await screen.findByTestId("inline-composer")).textContent).toBe(
      "Create a new bb plugin that ",
    );
    fireEvent.click(
      screen.getByText(
        "Ship a board your agents move cards across while they work.",
      ),
    );
    expect(
      (await screen.findByTestId("inline-composer")).textContent,
    ).toContain("kanban board panel");
    fireEvent.click(screen.getByText("CLI command"));
    expect(
      (await screen.findByTestId("inline-composer")).textContent,
    ).toContain("deploys the current branch to staging");
  });

  it("shows compact install data and reports the card trigger", async () => {
    const onInstall = vi.fn();
    const onOpenPlugin = vi.fn();
    renderBrowse(
      { entries: [MEMORY_ENTRY], collections: [] },
      "/plugins?sort=most-installed",
      onInstall,
      onOpenPlugin,
    );

    const install = await screen.findByRole("button", {
      name: "Install Memory — 4,210 installs",
    });
    expect(install.textContent).toContain("4.2K");
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalledWith({
      entryId: "memory",
      pluginId: "memory",
      marketplace: "bb-official",
      publisherLabel: "BB Official",
      displayName: "Memory",
      icon: "Brain",
      iconUrl: null,
      iconTinted: false,
      source: "builtin:memory",
    });
    const open = screen.getByRole("button", {
      name: "Open Memory details",
    });
    fireEvent.click(open);
    expect(onOpenPlugin).toHaveBeenCalledWith("memory", open);
  });
});
