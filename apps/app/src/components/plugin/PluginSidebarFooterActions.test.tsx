// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { PluginSidebarFooterActions } from "./PluginSidebarFooterActions";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <output aria-label="Current path">
      {location.pathname}
      {location.hash}
    </output>
  );
}

function renderWithProviders(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        {ui}
        <LocationProbe />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetPluginLogoStoreForTest();
  vi.restoreAllMocks();
});

describe("PluginSidebarFooterActions", () => {
  it("prefers branding.icon over the logo and contribution icon", () => {
    setPluginLogoUrls(
      new Map([
        [
          "remote",
          {
            displayName: "Remote",
            icon: "FileText",
            compactIconUrl: null,
            logoUrl: "/api/v1/plugins/remote/assets/logo?h=abc",
            logoDarkUrl: null,
          },
        ],
      ]),
    );
    setPluginSlotRegistrations(
      "remote",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "open",
            title: "Remote",
            icon: "Smartphone",
            run: () => {},
          },
        ],
      }),
    );

    renderWithProviders(<PluginSidebarFooterActions />);

    expect(document.querySelector('[data-icon="FileText"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="Smartphone"]')).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("contains a throwing run without breaking the sidebar", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "boom",
            title: "Boom",
            icon: "Zap",
            run: () => {
              throw new Error("nope");
            },
          },
        ],
      }),
    );

    renderWithProviders(<PluginSidebarFooterActions />);

    fireEvent.click(screen.getByRole("button", { name: "Boom" }));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('sidebarFooterAction "boom" failed: nope'),
    );
  });

  it("opens plugin Settings", () => {
    setPluginSlotRegistrations(
      "remote",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "settings",
            title: "Remote settings",
            icon: "Settings",
            run: ({ openSettings }) => openSettings(),
          },
        ],
      }),
    );

    renderWithProviders(<PluginSidebarFooterActions />);
    fireEvent.click(screen.getByRole("button", { name: "Remote settings" }));

    expect(screen.getByLabelText("Current path").textContent).toBe(
      "/settings/plugins/remote",
    );
  });
});
