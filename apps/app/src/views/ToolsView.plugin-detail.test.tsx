// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import {
  PluginDetail,
  PluginDetailBanners,
  ToolsScrollPage,
} from "./ToolsView";

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
  capabilities: [],
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

    // Provenance is a passive label beside the name, not a control. It used to
    // be a button that swapped to a red Uninstall on hover — a status that
    // deleted on click.
    expect(screen.getByText("BB Official")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Uninstall GitHub" }),
    ).toBeNull();

    // About is prose only. Release is gone as a section, and its two facts sit
    // in the header meta line with the identity rather than in a bordered
    // table carrying the same weight as Capabilities.
    expect(screen.getByText("About")).toBeTruthy();
    expect(screen.queryByText("Release")).toBeNull();
    expect(
      screen.getByText("Browse GitHub issues and pull requests in BB."),
    ).toBeTruthy();
    const meta = screen.getByText("0.1.0");
    expect(meta.className).toContain("font-mono");
    expect(meta.closest("[data-resource-detail-section]")).toBeNull();
    expect(screen.getByText("Updates with bb")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();

    expect(container.querySelector('[data-icon="Github"]')).not.toBeNull();
    expect(container.querySelector('img[src="/bb-mark.svg"]')).toBeNull();

    // Uninstall is irreversible, so it sits with the other ownership actions
    // rather than beside the reversible enable toggle.
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "GitHub actions" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Uninstall" }));
    expect(onDelete).toHaveBeenCalledWith(GITHUB_PLUGIN);
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

    expect(screen.getByText("Built-in")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "Disable Automations" }),
    ).toBeTruthy();

    // A built-in cannot be edited, opened, or removed, so it gets no menu at
    // all rather than an empty one.
    expect(
      screen.queryByRole("button", { name: "Automations actions" }),
    ).toBeNull();
  });
});

describe("PluginDetail runtime health", () => {
  function renderRuntimeStatus(
    status: Extract<
      PluginListItem["status"],
      | "error"
      | "incompatible"
      | "missing"
      | "needs-configuration"
      | "degraded"
    >,
  ) {
    const { queryClient, wrapper: QueryClientWrapper } =
      createQueryClientTestHarness();
    const plugin = {
      ...GITHUB_PLUGIN,
      source: "builtin:github",
      provenance: "builtin" as const,
      catalogEntryId: null,
      status,
      statusDetail: "The runtime reported a problem.",
    };
    // Banners and page are siblings in production too (ToolsView.tsx:236): the
    // stack renders outside the scroll page so it can span the pane.
    const result = render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetailBanners plugin={plugin} />
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
    return { ...result, queryClient };
  }

  it("lifts a failed runtime status into a destructive alert above the content", () => {
    const { container } = renderRuntimeStatus("error");
    const alert = screen.getByRole("alert");

    expect(alert.textContent).toContain("Failed");
    expect(alert.textContent).toContain("The runtime reported a problem.");
    expect(alert.textContent).toContain("Reload the plugin.");
    expect(alert.className).toContain("border-destructive/30");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();

    // The banner spans the pane rather than sitting inset in the detail
    // column, and it precedes every section: a broken runtime is a condition
    // on the page, not a block of its content.
    expect(alert.className).not.toContain("rounded");
    const about = container.querySelector(
      '[data-resource-detail-section="overview"]',
    ) as HTMLElement;
    expect(
      alert.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("spans the pane instead of sitting inset in the detail column", () => {
    const { container } = renderRuntimeStatus("error");
    const alert = screen.getByRole("alert");

    // Full-bleed: the tinted surface has no radius and no side borders, only a
    // rule under it, so it reads as a bar across the pane rather than a card.
    expect(alert.className).toContain("border-b");
    expect(alert.className).not.toContain("rounded");
    expect(alert.className).not.toContain("mx-");

    // Only the text lines up with the page gutter, using the same column width
    // and padding as ToolsScrollPage (ToolsView.tsx:87), so a banner and a
    // section heading share a left edge.
    const inner = alert.firstElementChild as HTMLElement;
    expect(inner.className).toContain("max-w-5xl");
    expect(inner.className).toContain("px-4");
    expect(inner.className).toContain("md:px-5");

    // And it is outside the detail page entirely, not nested in a section.
    expect(alert.closest("[data-resource-detail-section]")).toBeNull();
    expect(
      container.querySelector('[data-resource-detail-section="overview"]'),
    ).not.toBeNull();
  });

  it("offers Reload for degraded runtime status", () => {
    renderRuntimeStatus("degraded");

    expect(screen.getByRole("alert").className).toContain("border-warning/30");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it.each(["incompatible", "missing"] as const)(
    "does not offer Reload for %s runtime status",
    (status) => {
      renderRuntimeStatus(status);

      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    },
  );

  it("keeps needs-configuration actionless because saving Settings retries it", () => {
    renderRuntimeStatus("needs-configuration");

    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("reloads the affected plugin and reflects its pending state", async () => {
    let resolveReload: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveReload = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient } = renderRuntimeStatus("error");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/plugins/reload?id=github",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const pending = screen.getByRole("button", { name: "Reloading…" });
    expect(pending.getAttribute("disabled")).not.toBeNull();

    resolveReload?.(
      new Response(JSON.stringify({ ok: true, plugins: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["plugin-list"] });
    });
  });
});

describe("PluginDetail capability inventory", () => {
  it("lists each contributed capability and keeps health separate", () => {
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
      capabilities: [
        {
          kind: "skill",
          id: "review",
          label: "review",
          detail: "Review repository changes.",
        },
        {
          kind: "agent-tool",
          id: "fetch_issues",
          label: "fetch_issues",
          detail: "Fetches repository issues.",
        },
        {
          kind: "thread-integration",
          id: "pull-request-mentions",
          label: "Pull request mentions",
          detail: "Displays pull request references.",
        },
        {
          kind: "theme",
          id: "github.dark",
          label: "GitHub Dark",
          detail: "A dark GitHub-inspired theme.",
        },
      ],
      services: [
        { name: "watch", state: "running" as const },
        { name: "restart", state: "backoff" as const },
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
        {
          name: "in-progress",
          cron: "0 10 * * *",
          nextRunAt: 1_800_000_000_000,
          lastRunAt: null,
          lastStatus: "running" as const,
          lastError: null,
        },
        {
          name: "completed",
          cron: "0 11 * * *",
          nextRunAt: 1_800_000_000_000,
          lastRunAt: null,
          lastStatus: "ok" as const,
          lastError: null,
        },
        {
          name: "failed",
          cron: "0 12 * * *",
          nextRunAt: 1_800_000_000_000,
          lastRunAt: null,
          lastStatus: "error" as const,
          lastError: "Timed out",
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
    expect(includes?.querySelector("table")).not.toBeNull();
    expect(
      includes?.querySelector("[data-plugin-capability-group]"),
    ).toBeNull();
    for (const text of [
      "Run monitor",
      "Adds a page to the app sidebar.",
      "enhance-prompt",
      "Adds an action beside the thread composer.",
      "Advanced preferences",
      "Custom settings section",
      "API token",
      "Setting",
      "apiToken",
      "bb capability",
      "Inspect contributed capabilities.",
      "review",
      "Review repository changes.",
      "fetch_issues",
      "Fetches repository issues.",
      "Pull request mentions",
      "Displays pull request references.",
      "GitHub Dark",
      "A dark GitHub-inspired theme.",
    ]) {
      expect(inventory.getByText(text)).toBeTruthy();
    }
    expect(inventory.queryByText("watch")).toBeNull();
    expect(inventory.queryByText("daily-cleanup")).toBeNull();
    expect(includes?.textContent).not.toContain("2 background services");

    // Services and schedules are two objects with two status vocabularies, so
    // they are two named tables rather than groups inside a "Health" wrapper.
    const [services, schedules] = Array.from(
      container.querySelectorAll('[data-resource-detail-section="activity"]'),
    ) as HTMLElement[];
    expect(schedules).toBeTruthy();
    expect(container.textContent).not.toContain("Health");

    const serviceTable = within(services as HTMLElement);
    expect(serviceTable.getByText("Background services")).toBeTruthy();
    expect(serviceTable.getByText("watch")).toBeTruthy();
    expect(serviceTable.getByText("restart")).toBeTruthy();
    expect(serviceTable.getByText("sync")).toBeTruthy();
    expect(serviceTable.queryByText("daily-cleanup")).toBeNull();

    const scheduleTable = within(schedules as HTMLElement);
    expect(scheduleTable.getByText("Scheduled jobs")).toBeTruthy();
    expect(scheduleTable.getByText("daily-cleanup")).toBeTruthy();
    expect(scheduleTable.getByText("in-progress")).toBeTruthy();
    expect(scheduleTable.getByText("completed")).toBeTruthy();
    expect(scheduleTable.getByText("failed")).toBeTruthy();
    expect(scheduleTable.getByText("Timed out")).toBeTruthy();
    expect(scheduleTable.queryByText("watch")).toBeNull();

    for (const [scope, label, icon] of [
      [serviceTable, "Running", "CircleCheck"],
      [serviceTable, "Restarting", "RotateCcw"],
      [serviceTable, "Stopped", "Pause"],
      [scheduleTable, "Scheduled", "Clock"],
      // A running job shimmers its own clock. The app never swaps a row's icon
      // for a spinner to say "working" (ThreadRow.tsx:144).
      [scheduleTable, "Running", "Clock"],
      [scheduleTable, "Succeeded", "CircleCheck"],
      [scheduleTable, "Failed", "CircleX"],
    ] as const) {
      const status = scope
        .getAllByRole("img", { name: label })
        .find(
          (element) => element.querySelector(`[data-icon="${icon}"]`) !== null,
        );
      expect(status, `${label} should use ${icon}`).toBeTruthy();
      expect(status?.getAttribute("tabindex")).toBe("0");
    }
    expect(
      scheduleTable
        .getAllByRole("img", { name: "Running" })
        .some((element) =>
          element
            .querySelector('[data-icon="Clock"]')
            ?.getAttribute("class")
            ?.includes("animate-shine-icon"),
        ),
    ).toBe(true);
  });
});
