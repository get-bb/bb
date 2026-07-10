// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PluginSidebarFooterActions } from "./PluginSidebarFooterActions";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    settingsSections: [],
    navPanels: [],
    threadPanelActions: [],
    composerAccessories: [],
    sidebarFooterActions: [],
    fileOpeners: [],
    messageDirectives: [],
    ...overrides,
  };
}

function renderWithProviders(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <SidebarProvider>{ui}</SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("PluginSidebarFooterActions", () => {
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
});
