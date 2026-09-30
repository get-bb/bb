// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render as renderView,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemProviderCatalogEntry } from "@bb/server-contract";
import type { ProviderInfo } from "@bb/domain";
import { defaultAppSettings } from "@bb/domain";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import {
  ProvidersSettingsSection,
  reorderProviderIds,
} from "./ProvidersSettingsSection";

const mocks = vi.hoisted(() => ({
  providers: [] as ProviderInfo[],
  catalog: [] as SystemProviderCatalogEntry[],
  setEnabled: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: mocks.providers, isPending: false }),
  useSystemProviderCatalog: () => ({ data: mocks.catalog, isPending: false }),
}));

vi.mock("@/hooks/mutations/provider-mutations", () => ({
  useSetProviderEnabled: () => ({ mutate: mocks.setEnabled, isPending: false }),
}));

function render(ui: ReactElement) {
  return renderView(<MemoryRouter>{ui}</MemoryRouter>);
}

function openActions(name: string) {
  fireEvent.keyDown(
    screen.getByRole("button", { name: `Actions for ${name}` }),
    { key: "Enter" },
  );
}

function provider(id: string, displayName: string): ProviderInfo {
  return makeProviderInfo({
    id,
    displayName,
    logoUrl: null,
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsFork: false,
      supportsSessionRewind: false,
      modelCatalogScope: "workspace",
      permissionModes: ["full"],
    },
  });
}

afterEach(() => {
  cleanup();
  mocks.catalog = [];
  mocks.setEnabled.mockClear();
});

describe("ProvidersSettingsSection", () => {
  it("shows the server-wide fast tier setting and saves changes", () => {
    mocks.providers = [];
    const onChange = vi.fn();
    render(
      <ProvidersSettingsSection
        disabled={false}
        generalSettings={{ ...defaultAppSettings, allowFastServiceTier: false }}
        onGeneralSettingsChange={onChange}
      />,
    );

    const control = screen.getByRole("switch", {
      name: "Allow fast service tier",
    });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith({
      ...defaultAppSettings,
      allowFastServiceTier: true,
    });
  });

  it("shows reorder handles and writes the default as a user setting", () => {
    mocks.providers = [
      provider("alpha", "Alpha"),
      provider("beta", "Beta"),
      provider("gamma", "Gamma"),
    ];
    const onChange = vi.fn();
    render(
      <ProvidersSettingsSection
        disabled={false}
        generalSettings={defaultAppSettings}
        onGeneralSettingsChange={onChange}
      />,
    );

    const providersSection = screen
      .getByRole("heading", { name: "Providers" })
      .closest("section");
    if (providersSection === null) throw new Error("Providers section missing");
    const rows = within(providersSection).getAllByText(/Alpha|Beta|Gamma/);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(screen.getAllByText("Default")).toHaveLength(1);

    const reorderHandles = screen.getAllByRole("button", {
      name: /Reorder (Alpha|Beta|Gamma)/,
    });
    expect(reorderHandles).toHaveLength(3);
    expect(reorderHandles[0]?.parentElement?.className).toContain(
      "group/provider-row",
    );

    openActions("Gamma");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultAppSettings,
      defaultProviderId: "gamma",
    });
  });

  it("marks an unavailable provider and blocks it as the default", () => {
    mocks.providers = [
      provider("alpha", "Alpha"),
      { ...provider("beta", "Beta"), available: false },
    ];
    render(
      <ProvidersSettingsSection
        disabled={false}
        generalSettings={{ ...defaultAppSettings, defaultProviderId: "alpha" }}
        onGeneralSettingsChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
    openActions("Beta");
    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Default" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("shows each provider's finished turn display and stores only overrides", () => {
    mocks.providers = [
      {
        ...provider("claude-code", "Claude Code"),
        completedTurnDisplay: "flat",
      },
      provider("codex", "Codex"),
    ];
    const onChange = vi.fn();
    const generalSettings = {
      ...defaultAppSettings,
      providerCompletedTurnDisplay: { codex: "flat" as const },
    };
    render(
      <ProvidersSettingsSection
        disabled={false}
        generalSettings={generalSettings}
        onGeneralSettingsChange={onChange}
      />,
    );

    const claudeSwitch = screen.getByRole("switch", {
      name: "Collapse finished Claude Code turns",
    });
    const codexSwitch = screen.getByRole("switch", {
      name: "Collapse finished Codex turns",
    });
    const configuration = screen
      .getByRole("heading", { name: "Configuration" })
      .closest("section");
    if (configuration === null)
      throw new Error("Configuration section missing");
    expect(
      within(configuration).getByText("Collapse finished turns"),
    ).toBeTruthy();
    expect(
      within(configuration).getByRole("switch", {
        name: "Allow fast service tier",
      }),
    ).toBeTruthy();
    expect(
      within(configuration).getByRole("switch", {
        name: "Collapse finished Codex turns",
      }),
    ).toBe(codexSwitch);
    expect(claudeSwitch.getAttribute("aria-checked")).toBe("false");
    expect(codexSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(claudeSwitch);
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultAppSettings,
      providerCompletedTurnDisplay: {
        codex: "flat",
        "claude-code": "collapse",
      },
    });

    fireEvent.click(codexSwitch);
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultAppSettings,
      providerCompletedTurnDisplay: {},
    });
  });

  it("keeps a provider with a disabled plugin visible and enables it without navigating away", () => {
    mocks.providers = [provider("codex", "Codex")];
    mocks.catalog = [
      {
        id: "claude-code",
        displayName: "Claude Code",
        pluginId: "provider-claude-code",
        pluginName: "Claude Code provider",
        pluginEnabled: false,
        enabled: true,
        available: false,
        logoUrl: "/claude.svg",
        info: null,
      },
    ];
    render(
      <ProvidersSettingsSection
        disabled={false}
        generalSettings={defaultAppSettings}
        onGeneralSettingsChange={vi.fn()}
      />,
    );
    const section = screen
      .getByRole("heading", { name: "Providers" })
      .closest("section")!;
    expect(
      within(section)
        .getAllByText(/^(Codex|Claude Code)$/)
        .map((row) => row.textContent),
    ).toEqual(["Codex", "Claude Code"]);
    expect(
      screen.queryByRole("button", { name: "Reorder Claude Code" }),
    ).toBeNull();
    expect(
      section.querySelector('[data-provider-logo="/claude.svg"]'),
    ).not.toBeNull();
    openActions("Claude Code");
    fireEvent.click(screen.getByRole("menuitem", { name: "Enable" }));
    expect(mocks.setEnabled).toHaveBeenCalledWith({
      providerId: "claude-code",
      enabled: true,
    });
    openActions("Codex");
    fireEvent.click(screen.getByRole("menuitem", { name: "Disable" }));
    expect(mocks.setEnabled).toHaveBeenCalledWith({
      providerId: "codex",
      enabled: false,
    });
  });

  it("builds the complete picker order after a drag", () => {
    expect(
      reorderProviderIds(["alpha", "beta", "gamma"], "gamma", "alpha"),
    ).toEqual(["gamma", "alpha", "beta"]);
    expect(
      reorderProviderIds(["alpha", "beta", "gamma"], "gamma", "gamma"),
    ).toBeNull();
  });
});
