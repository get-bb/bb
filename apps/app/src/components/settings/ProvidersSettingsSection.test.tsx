// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo } from "@bb/domain";
import { defaultAppSettings } from "@bb/domain";
import * as systemQueries from "@/hooks/queries/system-queries";
import {
  ProvidersSettingsSection,
  reorderProviderIds,
} from "./ProvidersSettingsSection";

interface ProviderTestState {
  providers: ProviderInfo[];
}

const mocks: ProviderTestState = { providers: [] };
const useSystemProvidersMock = vi.spyOn(systemQueries, "useSystemProviders");

function provider(id: string, displayName: string): ProviderInfo {
  return {
    id,
    pluginId: `provider-${id}`,
    displayName,
    logoUrl: null,
    available: true,
    maintenance: { health: false, usage: false, installation: false },
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
    composerActions: [],
  };
}

beforeEach(() => {
  useSystemProvidersMock.mockImplementation(
    () =>
      /* SAFETY: This test fixture supplies the query fields that the component reads. */ ({
        data: mocks.providers,
        isPending: false,
      }) as ReturnType<typeof systemQueries.useSystemProviders>,
  );
});

afterEach(() => {
  cleanup();
});

describe("ProvidersSettingsSection", () => {
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

    const rows = screen.getAllByText(/Alpha|Beta|Gamma/);
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

    fireEvent.click(
      screen.getAllByRole("button", { name: "Make default" })[1]!,
    );
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
    expect(
      /* SAFETY: The test controls this fixture and verifies its behavior. */ (
        screen.getByRole("button", {
          name: "Make default",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
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
