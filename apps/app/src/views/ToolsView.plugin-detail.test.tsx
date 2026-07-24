// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  pluginSettingsViewQueryKey,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginDetail, ToolsScrollPage } from "./ToolsView";

const GITHUB_PLUGIN = {
  id: "github",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Browse GitHub issues and pull requests in BB.",
  name: "GitHub",
  icon: "Github",
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  app: { hasApp: true, bundle: null },
  provenance: "catalog" as const,
  isOrphanedBuiltin: false,
  catalogEntryId: "github",
  sourceDisplay: "BB Official · GitHub",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
} satisfies PluginListItem;

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("ToolsScrollPage layout", () => {
  it("gives bounded collection pages a definite viewport height", () => {
    render(
      <ToolsScrollPage fillViewport>
        <div>Skills collection</div>
      </ToolsScrollPage>,
    );

    const content = screen.getByText("Skills collection").parentElement;
    const classes = content?.className.split(/\s+/) ?? [];
    expect(classes).toContain("h-full");
    expect(classes).toContain("min-h-full");
  });

  it("keeps bottom padding after detail content that exceeds the viewport", () => {
    render(
      <ToolsScrollPage>
        <div>Long plugin detail</div>
      </ToolsScrollPage>,
    );

    const content = screen.getByText("Long plugin detail").parentElement;
    const classes = content?.className.split(/\s+/) ?? [];
    expect(classes).toContain("min-h-full");
    expect(classes).toContain("pb-4");
    expect(classes).not.toContain("h-full");
  });
});

describe("PluginDetail official catalog lifecycle", () => {
  it("keeps catalog provenance and release management in the unified detail taxonomy", async () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const onDelete = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={GITHUB_PLUGIN}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={onDelete}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const official = screen.getByRole("button", {
      name: "Uninstall GitHub",
    });
    expect(official.textContent).toContain("BB Official");
    expect(official.textContent).toContain("Uninstall");
    expect(official.className).toContain("bg-transparent");
    expect(official.className).toContain("border-border/70");
    expect(
      official.querySelector('[data-icon="PackageReceive"]'),
    ).not.toBeNull();
    expect(screen.getByText("About")).toBeTruthy();
    expect(
      screen.getByText("Browse GitHub issues and pull requests in BB."),
    ).toBeTruthy();
    expect(screen.getByText("Release")).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Included with bb releases")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();

    expect(screen.queryByLabelText("GitHub: BB Official")).toBeNull();
    expect(container.querySelector('[data-icon="Github"]')).not.toBeNull();
    expect(container.querySelector('img[src="/bb-mark.svg"]')).toBeNull();
    fireEvent.click(official);
    expect(onDelete).toHaveBeenCalledWith(GITHUB_PLUGIN);
    expect(screen.queryByRole("button", { name: "GitHub actions" })).toBeNull();
  });

  it("uses a plugin-owned canonical icon when no rich logo is declared", () => {
    const compactIconUrl = "/api/v1/plugins/omega/assets/icon?h=abc";
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    const { container } = render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={{
              ...GITHUB_PLUGIN,
              id: "omega",
              name: "Omegacode",
              icon: null,
              compactIconUrl,
              source: "path:/plugins/omega",
              provenance: "direct",
              catalogEntryId: null,
            }}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const icon = container.querySelector(
      `[data-plugin-icon-asset="${compactIconUrl}"]`,
    );
    expect(icon).not.toBeNull();
    expect(icon?.className).toContain("size-full");
    expect(container.querySelector('img[src="/bb-mark.svg"]')).toBeNull();
  });

  it("shows built-in provenance with lifecycle controls and no ownership actions", async () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={{
              ...GITHUB_PLUGIN,
              id: "automations",
              name: "Automations",
              source: "builtin:automations",
              provenance: "builtin",
              catalogEntryId: null,
            }}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const builtIn = screen.getByLabelText("Automations: Built-in");
    expect(builtIn.className).toContain("bg-transparent");
    expect(builtIn.className).toContain("border-border/70");
    expect(
      builtIn.querySelector('[data-icon="PackageReceive"]'),
    ).not.toBeNull();
    fireEvent.pointerMove(builtIn);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Ships with bb",
    );
    expect(
      screen.getByRole("switch", { name: "Disable Automations" }),
    ).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: "Automations actions" }),
    ).toBeNull();
  });
});

describe("PluginDetail capability inventory", () => {
  it("names each contributed capability in roomy category groups", () => {
    const EmptySlot = () => null;
    setPluginSlotRegistrations("capability-demo", {
      homepageSections: [],
      settingsSections: [
        {
          id: "preferences",
          title: "Advanced preferences",
          component: EmptySlot,
        },
      ],
      navPanels: [
        {
          id: "run-monitor",
          title: "Run monitor",
          icon: "Workflow",
          path: "runs",
          component: EmptySlot,
        },
      ],
      threadPanelActions: [],
      composerCustomizations: [
        {
          id: "prompt-tools",
          actions: [{ id: "enhance-prompt", component: EmptySlot }],
        },
      ],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
      messageActions: [],
    });

    const plugin = {
      ...GITHUB_PLUGIN,
      id: "capability-demo",
      name: "Capability demo",
      source: "path:/plugins/capability-demo",
      provenance: "direct" as const,
      catalogEntryId: null,
      sourceDisplay: "Local path",
      hasSettings: true,
      cliCommand: {
        name: "capability",
        summary: "Inspect contributed capabilities.",
      },
      services: [
        { name: "watch", state: "running" as const },
        { name: "sync", state: "stopped" as const },
      ],
      schedules: [
        {
          name: "daily-cleanup",
          cron: "0 9 * * *",
          nextRunAt: 1_800_000_000_000,
          lastRunAt: null,
          lastStatus: null,
          lastError: null,
        },
      ],
    } satisfies PluginListItem;
    const { queryClient, wrapper: QueryClientWrapper } =
      createQueryClientTestHarness();
    queryClient.setQueryData(pluginSettingsViewQueryKey(plugin.id), {
      schema: {
        apiToken: {
          type: "string",
          label: "API token",
          secret: true,
        },
      },
      values: { apiToken: { set: true } },
    });
    const { container } = render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={plugin}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const includes = container.querySelector(
      '[data-resource-detail-section="includes"]',
    );
    expect(includes).not.toBeNull();
    const inventory = within(includes as HTMLElement);
    expect(inventory.getByText("Run monitor")).toBeTruthy();
    expect(inventory.getByText("Navigation panel")).toBeTruthy();
    expect(inventory.getByText("enhance-prompt")).toBeTruthy();
    expect(inventory.getByText("Composer action")).toBeTruthy();
    expect(inventory.getByText("Advanced preferences")).toBeTruthy();
    expect(inventory.getByText("Custom settings section")).toBeTruthy();
    expect(inventory.getByText("API token")).toBeTruthy();
    expect(inventory.getByText("apiToken")).toBeTruthy();
    expect(inventory.getByText("bb capability")).toBeTruthy();
    expect(inventory.getByText("watch")).toBeTruthy();
    expect(inventory.getByText("sync")).toBeTruthy();
    expect(inventory.getByText("daily-cleanup")).toBeTruthy();
    expect(inventory.getByText("0 9 * * *")).toBeTruthy();
    expect(includes?.textContent).not.toContain("2 background services");

    const groups = includes?.querySelectorAll("[data-plugin-capability-group]");
    expect(groups?.length).toBe(5);
    for (const group of groups ?? []) {
      const row = group.closest(".items-start");
      expect(row?.classList).toContain("px-3");
      expect(row?.classList).toContain("py-3");
    }
  });
});
