// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusManager } from "@tanstack/react-query";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { resetAppRouteHistoryForTest } from "@/lib/app-route-history";
import { PluginsOverview } from "./PluginsOverview";

vi.mock("@/components/plugin/PluginNewThreadComposer", () => ({
  PluginNewThreadComposer: ({ initialPrompt }: { initialPrompt?: string }) => (
    <div data-testid="inline-composer">{initialPrompt}</div>
  ),
}));

function SwitchViewButton({ view }: { view: "browse" | "installed" }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() =>
        navigate(view === "browse" ? "/plugins" : "/plugins?view=installed")
      }
    >
      {`switch-to-${view}`}
    </button>
  );
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const AUTOMATIONS_PLUGIN = {
  id: "automations",
  source: "builtin:automations",
  rootDir: "/settings/plugins/automations",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Schedule recurring and one-shot agent or script work.",
  name: "Automations",
  icon: "Repeat",
  iconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  provenance: "builtin",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  isOrphanedBuiltin: false,
  sourceDisplay: "builtin · automations",
  updateState: {},
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  app: { hasApp: true, bundle: null },
};

const GITHUB_CATALOG_ENTRY = {
  entryId: "github",
  pluginId: "github",
  displayName: "GitHub",
  description: "Browse GitHub issues and pull requests in BB.",
  icon: "Github",
  iconUrl: null,
  categoryId: "code-and-reviews",
  category: "Developer tools",
  source: "builtin:github",
  marketplace: "bb-official",
  marketplaceDisplayName: "BB Official",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  official: true,
  author: { name: "BB", github: "get-bb", url: "https://github.com/get-bb" },
  installed: false,
  compatible: true,
  incompatibleReason: null,
};

const AUTOMATIONS_CATALOG_ENTRY = {
  ...GITHUB_CATALOG_ENTRY,
  entryId: "automations",
  pluginId: "automations",
  displayName: "Automations",
  description: AUTOMATIONS_PLUGIN.description,
  icon: AUTOMATIONS_PLUGIN.icon,
  categoryId: "tasks-and-workflows",
  category: "Workflow management",
  source: AUTOMATIONS_PLUGIN.source,
  installed: true,
};

const DOCS_CATALOG_ENTRY = {
  ...GITHUB_CATALOG_ENTRY,
  entryId: "docs",
  pluginId: "simple-notes",
  displayName: "Docs",
  description: "Create and edit Markdown documents.",
  icon: "NotebookText",
  categoryId: "memory-and-context",
  category: "Context & knowledge",
  source: "builtin:docs",
  installed: true,
};

function installFetch(plugins: readonly unknown[] = [AUTOMATIONS_PLUGIN]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const url = new URL(rawUrl, "http://localhost");
      if (url.pathname === "/api/v1/system/config") {
        return responseJson(makeSystemConfig());
      }
      if (url.pathname === "/api/v1/plugin-listings")
        return responseJson({ records: [], notices: [] });
      if (url.pathname === "/api/v1/plugins") {
        return responseJson({ plugins });
      }
      if (url.pathname === "/api/v1/plugin-catalog") {
        return responseJson({
          catalog: {
            pluginCount: 13,
            includedPluginCount: 8,
            optionalPluginCount: 5,
          },
        });
      }
      if (url.pathname === "/api/v1/plugin-catalog/search") {
        return responseJson({
          results: [
            AUTOMATIONS_CATALOG_ENTRY,
            DOCS_CATALOG_ENTRY,
            GITHUB_CATALOG_ENTRY,
          ],
          collections: [],
        });
      }
      if (url.pathname === "/api/v1/plugin-catalog/install") {
        return responseJson({
          ok: true,
          plugin: {
            ...AUTOMATIONS_PLUGIN,
            id: "github",
            source: GITHUB_CATALOG_ENTRY.source,
            rootDir: "/settings/plugins/github",
            name: GITHUB_CATALOG_ENTRY.displayName,
            description: GITHUB_CATALOG_ENTRY.description,
            icon: GITHUB_CATALOG_ENTRY.icon,
            provenance: "catalog",
            publisherKey: "bb-official",
            publisherLabel: "BB Official",
            catalogEntryId: GITHUB_CATALOG_ENTRY.entryId,
            sourceDisplay: "BB Official · GitHub",
          },
        });
      }
      return responseJson({ error: "not found" }, 404);
    }),
  );
}

function LocationPath() {
  return <span data-testid="location-path">{useLocation().pathname}</span>;
}

afterEach(() => {
  focusManager.setFocused(undefined);
  cleanup();
  resetAppRouteHistoryForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginsOverview", () => {
  it("opens on Browse and renders it before Installed", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Browse" })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Installed/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create a plugin" }),
    ).toBeTruthy();
    const comboTrigger = screen.getByRole("button", {
      name: "Create a plugin options",
    });
    fireEvent.pointerDown(comboTrigger);
    expect(
      screen.getByRole("menuitem", { name: "Install from source" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "New plugin" })).toBeNull();

    const catalogRequests = () =>
      vi.mocked(fetch).mock.calls.filter(([input]) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        return (
          new URL(rawUrl, "http://localhost").pathname ===
          "/api/v1/plugin-catalog/search"
        );
      });
    expect(catalogRequests()).toHaveLength(1);

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    await waitFor(() => expect(catalogRequests()).toHaveLength(1));
  });

  it("uses the existing sidebar history control to return from creation", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins"]}>
        <QueryClientWrapper>
          <SidebarHistoryNavigationControls />
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("GitHub");
    const createPlugin = screen.getByRole("button", {
      name: "Create a plugin",
    });

    fireEvent.click(createPlugin);
    expect(await screen.findByTestId("inline-composer")).toBeTruthy();
    expect(screen.queryByText("Back to browse plugins")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Close the composer" }),
    ).toBeNull();

    fireEvent.click(createPlugin);
    expect(screen.getByTestId("inline-composer")).toBeTruthy();

    const goBack = screen.getByRole("button", { name: "Go back" });
    await waitFor(() =>
      expect((goBack as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(goBack);
    await waitFor(() =>
      expect(screen.queryByTestId("inline-composer")).toBeNull(),
    );
  });

  it("shows category filters only in Browse", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "simple-notes",
        source: "builtin:docs",
        name: "Docs",
        description: DOCS_CATALOG_ENTRY.description,
        icon: DOCS_CATALOG_ENTRY.icon,
        provenance: "catalog",
        publisherKey: "bb-official",
        publisherLabel: "BB Official",
        catalogEntryId: "docs",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("GitHub")).toBeTruthy();
    const categoryTrigger = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
    fireEvent.click(categoryTrigger);
    fireEvent.click(
      screen.getByRole("option", { name: /Context & knowledge/u }),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.queryByText("GitHub")).toBeNull();
  });

  it("sends Installed's New plugin to the new-thread page with the seed", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <LocationPath />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New plugin" }));

    expect(screen.getByTestId("location-path").textContent).toBe("/");
  });

  it("shares the category filter and creation control with Browse", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Type" })).toBeNull();
    expect(screen.getByRole("button", { name: "New plugin" })).toBeTruthy();
  });

  it("keeps Browse filters in the toolbar rather than a separate pill band", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MemoryRouter initialEntries={["/plugins?view=browse"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("GitHub");
    expect(
      screen.queryByRole("radiogroup", {
        name: "Filter plugins by category",
      }),
    ).toBeNull();
    expect(
      container.querySelector(
        "[data-resource-collection-viewport] > .shrink-0",
      ),
    ).toBeNull();
    const search = screen.getByRole("textbox", { name: "Search plugins" });
    const toolbar = search.parentElement?.parentElement as HTMLElement;
    const category = screen.getByRole("button", {
      name: "Filter plugins by category: All categories",
    });
    const sort = screen.getByRole("button", { name: /^Sort:/ });
    expect(toolbar.contains(category)).toBe(true);
    expect(toolbar.contains(sort)).toBe(true);
    const heroHeading = screen.getByRole("heading", {
      level: 2,
      name: /^Turn bb into/,
    });
    expect(
      heroHeading.compareDocumentPosition(toolbar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens installed resources on the shared plugin detail route", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/settings/plugins"]}>
        <QueryClientWrapper>
          <Routes>
            <Route
              path="/settings/plugins"
              element={<PluginsOverview mode="installed" />}
            />
            <Route path="*" element={<LocationPath />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Automations plugin details",
      }),
    );
    expect(screen.getByTestId("location-path").textContent).toBe(
      "/plugins/automations",
    );
  });

  it("opens the canonical detail returned by a Browse install", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/plugins" element={<PluginsOverview />} />
            <Route path="*" element={<LocationPath />} />
          </Routes>
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Install GitHub" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Install GitHub?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Install GitHub" }));

    expect((await screen.findByTestId("location-path")).textContent).toBe(
      "/plugins/github",
    );
  });

  it("loads more installed plugins as the scroll sentinel is reached", async () => {
    const plugins = Array.from({ length: 14 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        name: `Plugin ${ordinal}`,
      };
    });
    const intersectionCallbacks = new Set<IntersectionObserverCallback>();
    vi.stubGlobal(
      "IntersectionObserver",
      class IntersectionObserverMock {
        constructor(private readonly callback: IntersectionObserverCallback) {
          intersectionCallbacks.add(this.callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          intersectionCallbacks.delete(this.callback);
        }
      },
    );
    const reachSentinel = () =>
      act(() => {
        for (const callback of intersectionCallbacks) {
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        }
      });
    installFetch(plugins);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 12")).toBeTruthy();
    expect(screen.queryByText("Plugin 13")).toBeNull();
    expect(
      document.querySelector("[data-resource-infinite-sentinel]"),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    reachSentinel();
    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("Plugin 14")).toBeTruthy();
    expect(
      document.querySelector("[data-resource-infinite-sentinel]"),
    ).toBeNull();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Plugin 01" } },
    );
    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(screen.queryByText("Plugin 12")).toBeNull();
  });

  it("sorts enabled plugins before inactive plugins and published plugins first within enabled", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-official",
        name: "Inactive Official",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "inactive-official",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-local-alpha",
        name: "Enabled Local",
        provenance: "direct",
        publisherLabel: null,
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-official-zulu",
        name: "Enabled Official Zulu",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-official-alpha",
        name: "Enabled Official Alpha",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-local",
        name: "Inactive Local",
        enabled: false,
        status: "disabled",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Enabled Official Alpha");
    const rows = [
      ...document.querySelectorAll('[data-testid^="plugin-card-"]'),
    ];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-local",
      "plugin-card-inactive-official",
    ]);
    const officialPills = screen.getAllByText("BB Official");
    expect(officialPills).toHaveLength(2);
    expect(screen.getAllByText("BB Community")).toHaveLength(1);

    const sortTrigger = screen.getByRole("button", {
      name: "Sort: Plugin name, ascending",
    });
    expect(sortTrigger.querySelector('[data-icon="ArrowUpDown"]')).toBeTruthy();
    fireEvent.pointerDown(sortTrigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Plugin name" }));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-official",
      "plugin-card-inactive-local",
    ]);

    fireEvent.keyDown(
      screen.getByRole("menu", {
        name: "Sort: Plugin name, descending",
      }),
      { key: "Escape" },
    );
    fireEvent.click(screen.getByText("switch-to-browse"));
    await screen.findByText("GitHub");
    fireEvent.click(screen.getByText("switch-to-installed"));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-card-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-card-enabled-official-alpha",
      "plugin-card-enabled-official-zulu",
      "plugin-card-enabled-local-alpha",
      "plugin-card-inactive-local",
      "plugin-card-inactive-official",
    ]);
  });

  it("combines category and search across the installed collection without changing its total", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "secure-one",
        name: "Secure One",
        categoryId: "security",
        category: "Security",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "secure-two",
        name: "Secure Two",
        categoryId: "security",
        category: "Security",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "local-one",
        name: "Local One",
        source: "path:/plugins/local",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );
    await screen.findByText("Local One");
    expect(screen.getByLabelText("3 plugins in this collection")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter plugins by category: All categories",
      }),
    );
    fireEvent.click(screen.getByRole("option", { name: /Security/u }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Two" } },
    );
    expect(screen.getByText("Secure Two")).toBeTruthy();
    expect(screen.queryByText("Secure One")).toBeNull();
    expect(screen.queryByText("Local One")).toBeNull();
    expect(screen.getByLabelText("3 plugins in this collection")).toBeTruthy();
  });

  it("keeps an unavailable bookmarked category selected and shows filtered emptiness", async () => {
    installFetch([AUTOMATIONS_PLUGIN]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter
        initialEntries={["/plugins?view=installed&category=security"]}
      >
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("No plugins match these filters."),
    ).toBeTruthy();
    expect(screen.getByLabelText("1 plugins in this collection")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Filter plugins by category: Security",
      }),
    ).toBeTruthy();
  });

  it("keeps disabled plugins installed regardless of provenance", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-builtin",
        name: "Inactive Builtin",
        enabled: false,
        status: "disabled",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-catalog",
        name: "Inactive Catalog Plugin",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: "inactive-catalog",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-local",
        name: "Inactive Local Plugin",
        enabled: false,
        status: "disabled",
        provenance: "direct",
        publisherLabel: null,
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      document.querySelectorAll('[data-testid^="plugin-card-"]'),
    ).toHaveLength(4);
    expect(screen.getByText("Inactive Builtin")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Enable inactive-builtin" }),
    ).toBeTruthy();
    expect(screen.getByText("Inactive Catalog Plugin")).toBeTruthy();
    expect(screen.getByText("Inactive Local Plugin")).toBeTruthy();
  });

  it("retains catalog author avatars and links without a By prefix", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "github",
        name: "GitHub",
        source: GITHUB_CATALOG_ENTRY.source,
        provenance: "catalog",
        publisherKey: "bb-community",
        publisherLabel: "BB Community",
        catalogEntryId: GITHUB_CATALOG_ENTRY.entryId,
        sourceDisplay: "BB Official · GitHub",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/plugins?view=installed"]}>
        <QueryClientWrapper>
          <PluginsOverview />
          <SwitchViewButton view="browse" />
          <SwitchViewButton view="installed" />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findAllByRole("link", { name: "BB" })).toHaveLength(2);
    expect(
      screen.getAllByRole("img", { name: "BB's GitHub avatar" }),
    ).toHaveLength(2);
    expect(screen.queryByText("By")).toBeNull();
  });
});
