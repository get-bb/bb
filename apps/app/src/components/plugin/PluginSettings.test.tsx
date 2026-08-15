// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { PluginSettingsDetail, PluginSettingsForm } from "./PluginSettings";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";

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

function rowPlugin(
  status: PluginListItem["status"],
  logoUrl: string | null = null,
): PluginListItem {
  return {
    id: "linear",
    source: "path:/plugins/linear",
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
    capabilities: [],
    app: { hasApp: false, bundle: null },
    provenance: "direct" as const,
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    publisherLabel: null,
    sourceDisplay: "path · /plugins/linear",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
  };
}

describe("PluginSettingsDetail settings gating", () => {
  it("clears plugin-scoped drafts and isolates an in-flight save after navigation", async () => {
    let finishAlphaSave: (response: Response) => void = () => {
      throw new Error("Alpha save did not start");
    };
    const requests: RecordedRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        if (
          url === "/api/v1/plugins/alpha/settings" &&
          init?.method === "PUT"
        ) {
          return new Promise<Response>((resolve) => {
            finishAlphaSave = resolve;
          });
        }
        const greeting = url.includes("/beta/") ? "bonjour" : "hello";
        return jsonOk({
          ...SETTINGS_VIEW,
          values: { ...SETTINGS_VIEW.values, greeting },
        });
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { rerender } = render(
      <PluginSettingsDetail
        plugin={{ ...rowPlugin("running"), id: "alpha" }}
      />,
      { wrapper },
    );

    const alphaGreeting = (await screen.findByLabelText(
      "Greeting",
    )) as HTMLInputElement;
    fireEvent.change(alphaGreeting, { target: { value: "unsaved alpha" } });
    fireEvent.click(screen.getByRole("button", { name: /save settings/i }));
    await vi.waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.url === "/api/v1/plugins/alpha/settings" &&
            request.init?.method === "PUT",
        ),
      ).toBe(true);
    });

    rerender(
      <PluginSettingsDetail plugin={{ ...rowPlugin("running"), id: "beta" }} />,
    );
    await vi.waitFor(() => {
      expect(
        (screen.getByLabelText("Greeting") as HTMLInputElement).value,
      ).toBe("bonjour");
    });
    expect(
      (
        screen.getByRole("button", {
          name: /save settings/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    finishAlphaSave(
      jsonOk({
        ...SETTINGS_VIEW,
        values: { ...SETTINGS_VIEW.values, greeting: "saved alpha" },
      }),
    );
    await vi.waitFor(() => {
      expect(
        (screen.getByLabelText("Greeting") as HTMLInputElement).value,
      ).toBe("bonjour");
    });
    expect(
      requests.some(
        (request) =>
          request.url === "/api/v1/plugins/beta/settings" &&
          request.init?.method === "PUT",
      ),
    ).toBe(false);
  });

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

  it("renders a slot-only plugin configuration on the detail surface", async () => {
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
      composerCustomizations: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginSettingsDetail
        plugin={{
          ...rowPlugin("running"),
          id: "connect",
          provenance: "builtin",
          hasSettings: false,
        }}
      />,
      { wrapper },
    );

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Remote access",
      }),
    ).toBeDefined();
    expect(screen.getByText("Custom connect settings")).toBeDefined();
    expect(screen.queryByText("This plugin declares no settings.")).toBeNull();
  });
});
