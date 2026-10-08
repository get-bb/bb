// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarFooterSectionProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { PluginSidebarFooterSections } from "./PluginSidebarFooterSections";

function Card({
  isCompactViewport,
  onNavigate,
}: ExperimentalSidebarFooterSectionProps) {
  return (
    <button
      type="button"
      data-testid="footer-card"
      data-compact={String(isCompactViewport)}
      onClick={onNavigate}
    >
      Card
    </button>
  );
}

function Crashing(): never {
  throw new Error("card exploded");
}

function renderSections({
  open = true,
  onNavigate = vi.fn(),
}: { open?: boolean; onNavigate?: () => void } = {}) {
  render(
    <MemoryRouter>
      <SidebarProvider defaultOpen={open}>
        <PluginSidebarFooterSections onNavigate={onNavigate} />
      </SidebarProvider>
    </MemoryRouter>,
  );
  return { onNavigate };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  vi.restoreAllMocks();
});

describe("PluginSidebarFooterSections", () => {
  it("renders every enabled plugin's section with the host props", () => {
    setPluginSlotRegistrations(
      "bb--whats-new",
      makePluginRegistrationSet({
        sidebarFooterSections: [{ id: "card", component: Card }],
      }),
    );
    const { onNavigate } = renderSections();

    const card = screen.getByTestId("footer-card");
    expect(card.getAttribute("data-compact")).toBe("false");
    expect(
      card.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin"),
    ).toBe("bb--whats-new");
    fireEvent.click(card);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when no enabled plugin registers a section", () => {
    renderSections();

    expect(screen.queryByTestId("plugin-sidebar-footer-sections")).toBeNull();
  });

  it("hides sections while the sidebar is collapsed", () => {
    setPluginSlotRegistrations(
      "bb--whats-new",
      makePluginRegistrationSet({
        sidebarFooterSections: [{ id: "card", component: Card }],
      }),
    );
    renderSections({ open: false });

    expect(screen.queryByTestId("footer-card")).toBeNull();
  });

  it("removes a section when its plugin is disabled", () => {
    setPluginSlotRegistrations(
      "bb--whats-new",
      makePluginRegistrationSet({
        sidebarFooterSections: [{ id: "card", component: Card }],
      }),
    );
    renderSections();
    expect(screen.getByTestId("footer-card")).toBeTruthy();

    cleanup();
    resetPluginSlotStoreForTest();
    renderSections();

    expect(screen.queryByTestId("footer-card")).toBeNull();
  });

  it("hides a crashing section without breaking its siblings", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "broken",
      makePluginRegistrationSet({
        sidebarFooterSections: [{ id: "card", component: Crashing }],
      }),
    );
    setPluginSlotRegistrations(
      "bb--whats-new",
      makePluginRegistrationSet({
        sidebarFooterSections: [{ id: "card", component: Card }],
      }),
    );
    renderSections();

    expect(screen.getByTestId("footer-card")).toBeTruthy();
    expect(screen.queryByText(/plugin broken crashed/)).toBeNull();
  });
});
