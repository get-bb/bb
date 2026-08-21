// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderInfo } from "@bb/domain";
import { defaultAppSettings } from "@bb/domain";
import { ProvidersSettingsSection } from "./ProvidersSettingsSection";

const mocks = vi.hoisted(() => ({
  providers: [] as ProviderInfo[],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviders: () => ({ data: mocks.providers, isPending: false }),
}));

function provider(id: string, displayName: string): ProviderInfo {
  return {
    id,
    displayName,
    logoUrl: null,
    available: true,
    experimental_providerHealth: false,
    experimental_providerUsage: false,
    experimental_providerInstallation: false,
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      supportsFork: false,
      supportsSessionRewind: false,
      permissionModes: ["full"],
    },
    composerActions: [],
  };
}

afterEach(cleanup);

describe("ProvidersSettingsSection", () => {
  it("writes the full picker order and the default as user settings", () => {
    // The server lists providers in effective order; the section must write
    // the COMPLETE order back (not just the moved id), so the server's
    // pinned-then-install-order overlay cannot reshuffle the unmoved rows.
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

    // No explicit default: the first row reads as the default.
    const rows = screen.getAllByText(/Alpha|Beta|Gamma/);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(screen.getAllByText("Default")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultAppSettings,
      providerOrder: ["alpha", "gamma", "beta"],
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Make default" })[1]!);
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultAppSettings,
      defaultProviderId: "gamma",
    });
  });

  it("disables the edges and marks an unavailable provider", () => {
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
    expect(
      (screen.getByRole("button", { name: "Move Alpha up" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Move Beta down" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("Unavailable")).toBeTruthy();
    // An unavailable provider cannot become the default.
    expect(
      (screen.getByRole("button", { name: "Make default" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
