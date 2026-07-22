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
import { ToolsHubExperimentProvider } from "@/components/tools/tools-experiment-context";
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
  return <output aria-label="Current path">{useLocation().pathname}</output>;
}

function renderWithProviders(ui: ReactNode, toolsHubEnabled = false) {
  return render(
    <MemoryRouter>
      <ToolsHubExperimentProvider enabled={toolsHubEnabled}>
        <SidebarProvider>
          {ui}
          <LocationProbe />
        </SidebarProvider>
      </ToolsHubExperimentProvider>
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

  it.each([
    [false, "/settings/plugins/remote"],
    [true, "/tools/plugins/remote"],
  ] as const)(
    "opens the %s Tools Hub plugin settings destination",
    (toolsHubEnabled, expectedPath) => {
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

      renderWithProviders(<PluginSidebarFooterActions />, toolsHubEnabled);
      fireEvent.click(screen.getByRole("button", { name: "Remote settings" }));

      expect(screen.getByLabelText("Current path").textContent).toBe(
        expectedPath,
      );
    },
  );
});
