// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SystemConfigResponse } from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginsOverview } from "./PluginsOverview";

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function systemConfig(): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: { placeholder: false, timelineWindowEventBudget: 1_500 },
    hostDaemonPort: null,
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    dataDir: "/tmp/bb-test",
  };
}

const AUTOMATIONS_PLUGIN = {
  id: "automations",
  source: "builtin:automations",
  rootDir: "/plugins/automations",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Schedule recurring and one-shot agent or script work.",
  name: "Automations",
  icon: "Clock",
  iconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  provenance: "builtin",
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
  category: "Developer tools",
  source: "github-release:ymichael/bb/bb-plugin-github-{version}.tgz@^0.1.0",
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
        return responseJson(systemConfig());
      }
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
        });
      }
      if (url.pathname === "/api/v1/plugin-catalog/install") {
        return responseJson({
          ok: true,
          plugin: {
            ...AUTOMATIONS_PLUGIN,
            id: "github",
            source: GITHUB_CATALOG_ENTRY.source,
            rootDir: "/official-plugins/github",
            name: GITHUB_CATALOG_ENTRY.displayName,
            description: GITHUB_CATALOG_ENTRY.description,
            icon: GITHUB_CATALOG_ENTRY.icon,
            provenance: "catalog",
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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PluginsOverview", () => {
  it("renders Installed and Browse as real collection projections", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    const installedTab = screen.getByRole("tab", {
      name: "Installed, 1 plugin",
    });
    expect(installedTab.className).toContain("cursor-pointer");
    expect(screen.getByRole("tab", { name: "Browse" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New plugin" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "New plugin options" }),
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Marketplaces/ })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Developer tools" })).toBeTruthy();
    expect(screen.queryByText("BB Official plugins")).toBeNull();
    expect(screen.getByRole("button", { name: "New plugin" })).toBeTruthy();
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
        catalogEntryId: "docs",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(
      screen.queryByRole("radiogroup", {
        name: "Filter plugins by category",
      }),
    ).toBeNull();
    expect(screen.queryByText("Category")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(
      await screen.findByRole("radiogroup", {
        name: "Filter plugins by category",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("Category")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Context & knowledge" }));
    expect(screen.getByText("Docs")).toBeTruthy();
    expect(screen.queryByText("Automations")).toBeNull();
  });

  it("keeps category pills visually secondary to the collection tabs", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins?view=browse"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("GitHub");
    const filters = screen.getByRole("radiogroup", {
      name: "Filter plugins by category",
    });
    const all = screen.getByRole("radio", {
      name: "Show all plugin categories",
    });
    expect(filters.className).toContain("py-2");
    expect(filters.className).toContain("gap-2");
    expect(all.className).toContain("cursor-pointer");
    expect(all.className).toContain("hover:border-foreground/20");
    expect(all.className).toContain("hover:shadow-xs");
    expect(all.className).toContain("data-[state=on]:bg-secondary/70");
    expect(all.className).not.toContain("data-[state=on]:bg-state-active");
    expect(screen.getByRole("tab", { name: "Browse" }).className).toContain(
      "bg-accent",
    );
  });

  it("opens installed resources on the canonical Tools detail route", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/plugins" element={<PluginsOverview />} />
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
      "/tools/plugins/automations",
    );
  });

  it("opens the canonical detail returned by a Browse install", async () => {
    installFetch();
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins?view=browse"]}>
        <QueryClientWrapper>
          <Routes>
            <Route path="/tools/plugins" element={<PluginsOverview />} />
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
      "/tools/plugins/github",
    );
  });

  it("paginates the installed plugin projection", async () => {
    const plugins = Array.from({ length: 12 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        name: `Plugin ${ordinal}`,
      };
    });
    installFetch(plugins);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Plugin 01")).toBeTruthy();
    expect(screen.getByText("1–10 of 12")).toBeTruthy();
    expect(screen.queryByText("Plugin 11")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("11–12 of 12")).toBeTruthy();
    expect(screen.getByText("Plugin 11")).toBeTruthy();
    expect(screen.queryByText("Plugin 01")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("1–10 of 12")).toBeTruthy();
    expect(screen.getByText("Plugin 01")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("11–12 of 12")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    expect(await screen.findByText("GitHub")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Installed, 12 plugins" }));
    expect(screen.getByText("11–12 of 12")).toBeTruthy();
    expect(screen.getByText("Plugin 11")).toBeTruthy();

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search installed plugins" }),
      { target: { value: "Plugin 01" } },
    );

    expect(screen.getByText("Plugin 01")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Results pagination" }),
    ).toBeNull();
  });

  it("fits installed plugin rows to the available height and keeps pagination outside the scroller", async () => {
    const plugins = Array.from({ length: 30 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        ...AUTOMATIONS_PLUGIN,
        id: `plugin-${ordinal}`,
        source: `builtin:plugin-${ordinal}`,
        name: `Plugin ${ordinal}`,
      };
    });
    let viewportHeight = 760;
    const clientHeightDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const resizeCallbacks = new Set<ResizeObserverCallback>();

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.id === "plugins-installed-results" ? viewportHeight : 0;
      },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const height = this.hasAttribute("data-resource-list-panel")
          ? viewportHeight
          : this.hasAttribute("data-resource-row")
            ? 50
            : 0;
        return new DOMRect(0, 0, 800, height);
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserverMock {
        constructor(private readonly callback: ResizeObserverCallback) {
          resizeCallbacks.add(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {
          resizeCallbacks.delete(this.callback);
        }
      },
    );

    try {
      installFetch(plugins);
      const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
      render(
        <MemoryRouter initialEntries={["/tools/plugins"]}>
          <QueryClientWrapper>
            <PluginsOverview />
          </QueryClientWrapper>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("1–15 of 30")).toBeTruthy();
      });
      const viewport = document.getElementById("plugins-installed-results");
      const footer = document.querySelector(
        "[data-resource-collection-footer]",
      );
      const collectionContent = document.querySelector(
        "[data-resource-collection-content]",
      );
      const listPanel = document.querySelector("[data-resource-list-panel]");
      expect(viewport?.contains(footer)).toBe(false);
      expect(collectionContent).toBeNull();
      expect(listPanel?.classList.contains("flex-1")).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(screen.getByText("16–30 of 30")).toBeTruthy();

      viewportHeight = 410;
      act(() => {
        for (const callback of resizeCallbacks) {
          callback([], {} as ResizeObserver);
        }
      });

      await waitFor(() => {
        expect(screen.getByText("9–16 of 30")).toBeTruthy();
      });
      expect(screen.getByText("Page 2 of 4")).toBeTruthy();
    } finally {
      if (clientHeightDescriptor === undefined) {
        Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
      } else {
        Object.defineProperty(
          HTMLElement.prototype,
          "clientHeight",
          clientHeightDescriptor,
        );
      }
    }
  });

  it("sorts enabled plugins before inactive plugins and BB Official first within enabled", async () => {
    installFetch([
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-official",
        name: "Inactive Official",
        enabled: false,
        status: "disabled",
        provenance: "catalog",
        catalogEntryId: "inactive-official",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "enabled-local-alpha",
        name: "Enabled Local",
        provenance: "direct",
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
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    await screen.findByText("Enabled Official Alpha");
    const rows = [...document.querySelectorAll('[data-testid^="plugin-row-"]')];
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-local",
      "plugin-row-inactive-official",
    ]);
    const officialPills = screen.getAllByText("BB Official");
    expect(officialPills).toHaveLength(3);
    expect(officialPills[0]?.parentElement?.className).toContain("rounded-md");
    expect(officialPills[0]?.parentElement?.className).toContain(
      "bg-surface-recessed/45",
    );
    expect(officialPills[0]?.parentElement?.className).toContain(
      "text-subtle-foreground",
    );
    expect(officialPills[0]?.parentElement?.className).toContain("font-medium");
    expect(officialPills[0]?.parentElement?.className).toContain("px-2");
    expect(officialPills[0]?.parentElement?.className).toContain("py-1");

    fireEvent.pointerDown(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Plugin name" }));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-official",
      "plugin-row-inactive-local",
    ]);

    fireEvent.keyDown(screen.getByRole("menu", { name: "Sort" }), {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    await screen.findByText("GitHub");
    fireEvent.click(screen.getByRole("tab", { name: "Installed, 5 plugins" }));
    expect(
      [...document.querySelectorAll('[data-testid^="plugin-row-"]')].map(
        (row) => row.getAttribute("data-testid"),
      ),
    ).toEqual([
      "plugin-row-enabled-official-zulu",
      "plugin-row-enabled-official-alpha",
      "plugin-row-enabled-local-alpha",
      "plugin-row-inactive-official",
      "plugin-row-inactive-local",
    ]);
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
        catalogEntryId: "inactive-catalog",
      },
      {
        ...AUTOMATIONS_PLUGIN,
        id: "inactive-local",
        name: "Inactive Local Plugin",
        enabled: false,
        status: "disabled",
        provenance: "direct",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Automations")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Installed, 4 plugins" }),
    ).toBeTruthy();
    expect(screen.getByText("Inactive Builtin")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Enable inactive-builtin" }),
    ).toBeTruthy();
    expect(screen.getByText("Inactive Catalog Plugin")).toBeTruthy();
    expect(screen.getByText("Inactive Local Plugin")).toBeTruthy();
  });

  it("consolidates built-in and catalog plugins under BB Official", async () => {
    installFetch([
      AUTOMATIONS_PLUGIN,
      {
        ...AUTOMATIONS_PLUGIN,
        id: "github",
        name: "GitHub",
        source: GITHUB_CATALOG_ENTRY.source,
        provenance: "catalog",
        catalogEntryId: GITHUB_CATALOG_ENTRY.entryId,
        sourceDisplay: "BB Official · GitHub",
      },
    ]);
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/tools/plugins"]}>
        <QueryClientWrapper>
          <PluginsOverview />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const official = await screen.findAllByText("BB Official");
    expect(official).toHaveLength(2);
    expect(official[0]?.parentElement?.className).toBe(
      official[1]?.parentElement?.className,
    );
  });
});
