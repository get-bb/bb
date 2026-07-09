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
  it("renders nothing when no plugins contribute footer actions", () => {
    const { container } = renderWithProviders(
      <PluginSidebarFooterActions />,
    );
    // SidebarProvider still mounts layout chrome; assert no footer action.
    expect(
      container.querySelector(
        "[data-testid^='plugin-sidebar-footer-action-']",
      ),
    ).toBeNull();
  });

  it("renders host chrome and runs openSettings on click", () => {
    const run = vi.fn(
      (context: { openSettings: () => void }) => {
        context.openSettings();
      },
    );
    setPluginSlotRegistrations(
      "connect",
      registrationSet({
        sidebarFooterActions: [
          {
            id: "remote-access",
            title: "Remote access",
            icon: "Smartphone",
            run,
          },
        ],
      }),
    );

    renderWithProviders(<PluginSidebarFooterActions />);

    const button = screen.getByRole("button", { name: "Remote access" });
    expect(button.getAttribute("data-testid")).toBe(
      "plugin-sidebar-footer-action-connect-remote-access",
    );
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
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
});
