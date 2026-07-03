// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginRow, PluginSettingsForm } from "./PluginsSettingsSection";

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

describe("PluginRow settings gating", () => {
  function rowPlugin(status: string, logoUrl: string | null = null) {
    return {
      id: "linear",
      version: "0.1.0",
      enabled: true,
      status,
      statusDetail: null,
      logoUrl,
      logoDarkUrl: null,
    };
  }

  it("renders the settings form for a needs-configuration plugin (regression: the plugin that most needs configuring must be configurable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW))),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(<PluginRow plugin={rowPlugin("needs-configuration")} />, {
      wrapper,
    });
    expect(await screen.findByLabelText("Greeting")).toBeTruthy();
  });

  it("renders no form for an errored plugin (no schema exists server-side)", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW)));
    vi.stubGlobal("fetch", fetchSpy);
    const { wrapper } = createQueryClientTestHarness();
    render(<PluginRow plugin={rowPlugin("error")} />, { wrapper });
    expect(screen.queryByLabelText("Greeting")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the plugin's logo next to the id when served, nothing otherwise", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonOk(SETTINGS_VIEW))),
    );
    const { wrapper } = createQueryClientTestHarness();
    const logoUrl = "/api/v1/plugins/linear/assets/logo?h=f00d";
    const { unmount } = render(
      <PluginRow plugin={rowPlugin("running", logoUrl)} />,
      { wrapper },
    );
    expect(
      screen.getByTestId("plugin-settings-logo-linear").getAttribute("src"),
    ).toBe(logoUrl);
    unmount();

    render(<PluginRow plugin={rowPlugin("running")} />, { wrapper });
    expect(screen.queryByTestId("plugin-settings-logo-linear")).toBeNull();
  });
});
