// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginSettingsForm } from "@/components/plugin/PluginSettings";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { usePluginSettingSearch } from "./usePluginSettingSearch";

const LINEAR_SETTINGS = {
  ok: true,
  schema: {
    apiKey: {
      type: "string",
      label: "API key",
      description: "Used to read and update issues.",
      secret: true,
    },
    team: { type: "string", label: "Default team" },
  },
  values: { apiKey: { set: false }, team: "core" },
};

const pluginEntries = [
  { hasSettingsForm: true, icon: null, id: "linear", label: "Linear" },
  { hasSettingsForm: false, icon: null, id: "workflows", label: "Workflows" },
];

function stubSettingsFetch(): string[] {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requested.push(url);
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(LINEAR_SETTINGS),
      } as Response;
    }),
  );
  return requested;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePluginSettingSearch", () => {
  it("loads nothing until search is used", async () => {
    const requested = stubSettingsFetch();
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => usePluginSettingSearch({ enabled: false, pluginEntries }),
      { wrapper },
    );

    await Promise.resolve();
    expect(requested).toEqual([]);
    expect(result.current).toEqual({ entries: [], isLoading: false });
  });

  it("loads the settings of each plugin that shows a settings form", async () => {
    const requested = stubSettingsFetch();
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => usePluginSettingSearch({ enabled: true, pluginEntries }),
      { wrapper },
    );

    expect(result.current.isLoading).toBe(true);
    await vi.waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(requested).toEqual(["/api/v1/plugins/linear/settings"]);
    expect(result.current.entries).toEqual([
      {
        description: "Used to read and update issues.",
        key: "apiKey",
        label: "API key",
        pluginId: "linear",
      },
      {
        description: null,
        key: "team",
        label: "Default team",
        pluginId: "linear",
      },
    ]);
  });

  it("names settings by the label their row on the plugin page is anchored with", async () => {
    stubSettingsFetch();
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => usePluginSettingSearch({ enabled: true, pluginEntries }),
      { wrapper },
    );
    render(<PluginSettingsForm pluginId="linear" />, { wrapper });

    await screen.findByText("Default team");
    await vi.waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });
    const anchors = [
      ...document.querySelectorAll<HTMLElement>("[data-settings-anchor]"),
    ].map((element) => element.dataset.settingsAnchor);
    expect(anchors).toEqual(result.current.entries.map((entry) => entry.label));
  });
});
