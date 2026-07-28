// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  InstalledPlugin,
  SystemConfigResponse,
} from "@bb/server-contract";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
} from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  PluginSettingsDetail,
  PluginSettingsDetailSection,
  PluginSettingsForm,
  PluginsSettingsSection,
} from "./PluginsSettingsSection";
import { InstalledPluginRow } from "./plugins/InstalledPluginsTab";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  pluginListQueryKey,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function responseJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function systemConfig(pluginsEnabled: boolean): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: { ...defaultExperiments, plugins: pluginsEnabled },
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

const SETTINGS_VIEW = {
  ok: true,
  schema: {
    greeting: { type: "string", label: "Greeting" },
    enabled: { type: "boolean", label: "Enabled" },
    apiKey: { type: "string", label: "API key", secret: true },
  },
  values: { greeting: "hello", enabled: true, apiKey: { set: false } },
};

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.unstubAllGlobals();
});

describe("PluginSettingsForm", () => {
  it("renders the schema as a form and round-trips a PUT with only changes", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (init?.method === "PUT") {
          return jsonOk({
            ...SETTINGS_VIEW,
            values: { ...SETTINGS_VIEW.values, greeting: "hi" },
          });
        }
        return jsonOk(SETTINGS_VIEW);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsForm pluginId="demo" />, { wrapper });

    const greeting = (await screen.findByLabelText(
      "Greeting",
    )) as HTMLInputElement;
    expect(greeting.value).toBe("hello");

    // Secrets are write-only: no value, only a set/not-set placeholder.
    const apiKey = screen.getByLabelText("API key") as HTMLInputElement;
    expect(apiKey.value).toBe("");
    expect(apiKey.placeholder).toBe("[not set]");

    const save = screen.getByRole("button", { name: /save settings/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(greeting, { target: { value: "hi" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    const put = await vi.waitFor(() => {
      const found = requests.find((request) => request.init?.method === "PUT");
      expect(found).toBeDefined();
      return found;
    });
    expect(put?.url).toBe("/api/v1/plugins/demo/settings");
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      values: { greeting: "hi" },
    });

    // The refreshed view replaces the drafts; the input shows the saved value.
    await vi.waitFor(() => {
      expect(
        (screen.getByLabelText("Greeting") as HTMLInputElement).value,
      ).toBe("hi");
    });
  });

  it("never sends an untouched secret and includes a typed one", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonOk(SETTINGS_VIEW);
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsForm pluginId="demo" />, { wrapper });

    const apiKey = (await screen.findByLabelText(
      "API key",
    )) as HTMLInputElement;
    fireEvent.change(apiKey, { target: { value: "sk-123" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));

    const put = await vi.waitFor(() => {
      const found = requests.find((request) => request.init?.method === "PUT");
      expect(found).toBeDefined();
      return found;
    });
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      values: { apiKey: "sk-123" },
    });
  });
});

describe("PluginsSettingsSection", () => {
  it("offers only Installed and Browse management tabs", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(systemConfigQueryKey(), systemConfig(true));
    queryClient.setQueryData(pluginListQueryKey(true), { plugins: [] });
    render(
      <MemoryRouter>
        <PluginsSettingsSection />
      </MemoryRouter>,
      { wrapper },
    );

    const tabs = within(await screen.findByRole("tablist")).getAllByRole(
      "button",
    );
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.textContent).toContain("Installed");
    expect(tabs[1]?.textContent).toBe("Browse");
  });
});

function serverPlugin(
  overrides: Partial<InstalledPlugin> = {},
): InstalledPlugin {
  return {
    id: "linear",
    source: "builtin:linear",
    rootDir: "/plugins/linear",
    version: "0.1.0",
    provenance: "builtin",
    isOrphanedBuiltin: false,
    sourceDisplay: "builtin",
    updateState: {},
    enabled: true,
    description: null,
    name: null,
    icon: null,
    experimental_iconUrl: null,
    status: "running",
    statusDetail: null,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    hasSettings: true,
    app: { hasApp: false, bundle: null },
    logoUrl: null,
    logoDarkUrl: null,
    ...overrides,
  };
}

function rowPlugin(
  status: PluginListItem["status"],
  logoUrl: string | null = null,
): PluginListItem {
  return {
    id: "linear",
    rootDir: "/plugins/linear",
    version: "0.1.0",
    enabled: true,
    status,
    statusDetail: null,
    description: null,
    name: null,
    icon: null,
    compactIconUrl: null,
    logoUrl,
    logoDarkUrl: null,
    hasSettings: true,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    app: { hasApp: false, bundle: null },
    provenance: "builtin" as const,
    source: "builtin:linear",
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    sourceDisplay: "builtin",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
  };
}

describe("PluginSettingsDetail settings gating", () => {
  it("renders the settings form for a needs-configuration plugin (regression: the plugin that most needs configuring must be configurable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW))),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginSettingsDetail plugin={rowPlugin("needs-configuration")} />
      </MemoryRouter>,
      { wrapper },
    );
    expect(await screen.findByLabelText("Greeting")).toBeTruthy();
  });

  it("renders no form for an errored plugin (no schema exists server-side)", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW)));
    vi.stubGlobal("fetch", fetchSpy);
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginSettingsDetail plugin={rowPlugin("error")} />
      </MemoryRouter>,
      { wrapper },
    );
    expect(screen.queryByLabelText("Greeting")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes a stale builtin plugin from its detail page", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonOk({ ok: true });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginSettingsDetail
          plugin={{
            ...rowPlugin("disabled"),
            isOrphanedBuiltin: true,
          }}
        />
      </MemoryRouter>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(
      screen.getByText(/BB remembers the removal so the plugin stays hidden/),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Remove plugin" }));

    await vi.waitFor(() => {
      expect(requests).toContainEqual({
        url: "/api/v1/plugins/linear",
        init: expect.objectContaining({ method: "DELETE" }),
      });
    });
  });

  it("renders a slot-only settings page while the plugins experiment is off", async () => {
    function ConnectSettings() {
      return <div>Custom connect settings</div>;
    }
    setPluginSlotRegistrations("connect", {
      homepageSections: [],
      settingsSections: [
        { id: "remote", title: "Remote access", component: ConnectSettings },
      ],
      navPanels: [],
      threadPanelActions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        const path = new URL(rawUrl, "http://localhost").pathname;
        if (path === "/api/v1/system/config") {
          return responseJson(systemConfig(false));
        }
        if (path === "/api/v1/plugins") {
          return responseJson({
            enabled: false,
            plugins: [serverPlugin({ id: "connect", hasSettings: false })],
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <PluginSettingsDetailSection pluginId="connect" />
      </MemoryRouter>,
      { wrapper },
    );

    expect(await screen.findByText("Remote access")).toBeDefined();
    expect(screen.getByText("Custom connect settings")).toBeDefined();
    expect(screen.queryByText("This plugin declares no settings.")).toBeNull();
  });
});

describe("InstalledPluginRow", () => {
  it("uses the rich logo in a roomy settings row when an icon also exists", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ ok: true })),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <InstalledPluginRow
          plugin={{
            ...rowPlugin("running", "/plugin-logo.svg"),
            icon: "Smartphone",
          }}
          onUpdateClick={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(
      screen.getByTestId("plugin-settings-logo-linear").getAttribute("src"),
    ).toBe("/plugin-logo.svg");
    expect(document.querySelector('[data-icon="Smartphone"]')).toBeNull();
  });

  it("falls back to the manifest icon when a plugin logo fails to load", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ ok: true })),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <InstalledPluginRow
          plugin={{
            ...rowPlugin("running", "/missing-logo.svg"),
            icon: "Smartphone",
          }}
          onUpdateClick={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    fireEvent.error(screen.getByTestId("plugin-settings-logo-linear"));

    expect(document.querySelector('[data-icon="Smartphone"]')).not.toBeNull();
    expect(screen.queryByTestId("plugin-settings-logo-linear")).toBeNull();
  });

  it("POSTs disable when toggling an enabled plugin off", async () => {
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonOk({
          ok: true,
          plugin: serverPlugin({ enabled: false, status: "disabled" }),
        });
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <InstalledPluginRow
          plugin={rowPlugin("running")}
          onUpdateClick={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable linear" }));

    await vi.waitFor(() => {
      const post = requests.find((request) => request.init?.method === "POST");
      expect(post?.url).toBe("/api/v1/plugins/linear/disable");
    });
  });

  it("badges an available update and routes the pill to the confirmation", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ ok: true })),
    );
    const onUpdateClick = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <InstalledPluginRow
          plugin={{
            ...rowPlugin("running"),
            updateState: {
              ...EMPTY_PLUGIN_UPDATE_STATE,
              availableVersion: "1.7.0",
            },
          }}
          onUpdateClick={onUpdateClick}
        />
      </MemoryRouter>,
      { wrapper },
    );

    // At rest the row shows no version, no source string, no menu.
    expect(screen.queryByText(/v0\.1\.0/)).toBeNull();
    fireEvent.click(screen.getByTestId("plugin-update-pill-linear"));
    expect(onUpdateClick).toHaveBeenCalledTimes(1);
  });

  it("never badges a newer-but-incompatible release (nothing is actionable)", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ ok: true })),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <InstalledPluginRow
          plugin={{
            ...rowPlugin("running"),
            updateState: {
              ...EMPTY_PLUGIN_UPDATE_STATE,
              blockedVersion: "1.9.0",
              blockedReasons: ["requires bb >= 0.15"],
            },
          }}
          onUpdateClick={() => {}}
        />
      </MemoryRouter>,
      { wrapper },
    );

    expect(screen.queryByTestId("plugin-update-pill-linear")).toBeNull();
    expect(screen.queryByTestId("plugin-attention-pill-linear")).toBeNull();
  });
});
