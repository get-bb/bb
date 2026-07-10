// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SystemConfigResponse } from "@bb/server-contract";
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
  PluginToggleRow,
} from "./PluginsSettingsSection";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function jsonOk(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
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
    featureFlags: { placeholder: false },
    hostDaemonPort: null,
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

function rowPlugin(status: string, logoUrl: string | null = null) {
  return {
    id: "linear",
    version: "0.1.0",
    enabled: true,
    status,
    statusDetail: null,
    description: null,
    displayName: null,
    icon: null,
    logoUrl,
    logoDarkUrl: null,
    hasSettings: true,
  };
}

describe("PluginSettingsDetail settings gating", () => {
  it("renders the settings form for a needs-configuration plugin (regression: the plugin that most needs configuring must be configurable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW))),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsDetail plugin={rowPlugin("needs-configuration")} />, {
      wrapper,
    });
    expect(await screen.findByLabelText("Greeting")).toBeTruthy();
  });

  it("renders no form for an errored plugin (no schema exists server-side)", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW)));
    vi.stubGlobal("fetch", fetchSpy);
    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsDetail plugin={rowPlugin("error")} />, { wrapper });
    expect(screen.queryByLabelText("Greeting")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
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
      composerAccessories: [],
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
            plugins: [
              {
                id: "connect",
                version: "0.1.0",
                enabled: true,
                status: "running",
                statusDetail: null,
                description: null,
                logoUrl: null,
                logoDarkUrl: null,
                hasSettings: false,
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { wrapper } = createQueryClientTestHarness();
    render(<PluginSettingsDetailSection pluginId="connect" />, { wrapper });

    expect(await screen.findByText("Remote access")).toBeDefined();
    expect(screen.getByText("Custom connect settings")).toBeDefined();
    expect(screen.queryByText("This plugin declares no settings.")).toBeNull();
  });
});

describe("PluginToggleRow", () => {
  it("POSTs disable when toggling an enabled plugin off", async () => {
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
        <PluginToggleRow plugin={rowPlugin("running")} />
      </MemoryRouter>,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable linear" }));

    await vi.waitFor(() => {
      const post = requests.find((request) => request.init?.method === "POST");
      expect(post?.url).toBe("/api/v1/plugins/linear/disable");
    });
  });
});
