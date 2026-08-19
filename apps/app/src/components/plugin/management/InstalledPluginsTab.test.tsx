// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { InstalledPluginRow } from "./InstalledPluginsTab";

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return {
    id: "notify",
    source: "path:/tmp/bb-plugin-notify",
    rootDir: "/tmp/bb-plugin-notify",
    version: "0.2.1",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: "Desktop notifications when a thread needs you.",
    name: "Notify",
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "direct",
    isOrphanedBuiltin: false,
    catalogEntryId: null,
    publisherLabel: null,
    sourceDisplay: "path · /tmp/bb-plugin-notify",
    updateState: EMPTY_PLUGIN_UPDATE_STATE,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    capabilities: [],
    app: { hasApp: false, bundle: null },
    ...overrides,
  };
}

function renderRow(item: PluginListItem) {
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  return render(
    <MemoryRouter>
      <QueryClientWrapper>
        <InstalledPluginRow plugin={item} onUpdateClick={vi.fn()} />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("InstalledPluginRow", () => {
  it("shows the status word and detail at rest and marks the switch when a plugin is incompatible", () => {
    renderRow(
      plugin({
        status: "incompatible",
        statusDetail: "requires bb >=0.38.0 <0.39.0, this is 0.39.0",
      }),
    );

    expect(screen.getByTestId("plugin-runtime-status-notify").textContent).toBe(
      "Incompatible",
    );
    // The server's detail replaces the marketing description.
    expect(
      screen.getByText("requires bb >=0.38.0 <0.39.0, this is 0.39.0"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Desktop notifications when a thread needs you."),
    ).toBeNull();
    // The switch is still "on" (the user enabled it) but says so honestly.
    expect(screen.getByTestId("plugin-not-running-notify").textContent).toBe(
      "not running",
    );
    const toggle = screen.getByRole("switch", {
      name: "Disable notify (incompatible, not running)",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a running plugin's row quiet", () => {
    renderRow(plugin());

    expect(screen.queryByTestId("plugin-runtime-status-notify")).toBeNull();
    expect(screen.queryByTestId("plugin-not-running-notify")).toBeNull();
    expect(
      screen.getByText("Desktop notifications when a thread needs you."),
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Disable notify" })).toBeTruthy();
  });

  it("does not call a needs-configuration plugin not running", () => {
    renderRow(
      plugin({
        status: "needs-configuration",
        statusDetail: "Set an API token.",
      }),
    );

    expect(screen.getByTestId("plugin-runtime-status-notify").textContent).toBe(
      "Needs configuration",
    );
    expect(screen.getByText("Set an API token.")).toBeTruthy();
    expect(screen.queryByTestId("plugin-not-running-notify")).toBeNull();
  });
});
