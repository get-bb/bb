// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  MACOS_DRAWER_HEADER_RESERVE_CLASS,
  SidebarTopReserveRow,
} from "./SidebarChrome";

const navigationState = vi.hoisted((): { placement: "rail" | "list" } => ({
  placement: "rail",
}));

vi.mock("./sidebarNavigationProvider", () => ({
  useSidebarNavigationPlacement: () => navigationState.placement,
}));

const macosDesktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

async function renderReservesTrafficLights({
  isCompactViewport,
}: {
  isCompactViewport: boolean;
}): Promise<boolean> {
  await act(async () => {
    render(
      <MemoryRouter>
        <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
          <SidebarProvider framed>
            <SidebarTopReserveRow
              testId="reserve-row"
              headerSlot={<button type="button">New thread</button>}
            />
          </SidebarProvider>
        </CompactViewportOverrideProvider>
      </MemoryRouter>,
    );
  });
  const classNames = screen.getByTestId("reserve-row").className.split(" ");
  return MACOS_DRAWER_HEADER_RESERVE_CLASS.split(" ").every((token) =>
    classNames.includes(token),
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
  navigationState.placement = "rail";
});

describe("SidebarTopReserveRow macOS traffic lights", () => {
  it("clears the traffic lights and sidebar toggle in the compact drawer", async () => {
    window.bbDesktop = createBbDesktopApi(macosDesktopInfo);

    expect(await renderReservesTrafficLights({ isCompactViewport: true })).toBe(
      true,
    );
  });

  it.each(["rail", "list"] as const)(
    "keeps the framed %s header beside its content without a window-control gutter",
    async (placement) => {
      navigationState.placement = placement;
      window.bbDesktop = createBbDesktopApi(macosDesktopInfo);

      expect(
        await renderReservesTrafficLights({ isCompactViewport: false }),
      ).toBe(false);
      expect(
        screen.getByRole("button", { name: "New thread" }).parentElement,
      ).toBe(screen.getByTestId("reserve-row"));
    },
  );

  it("reserves nothing in a compact browser window", async () => {
    expect(await renderReservesTrafficLights({ isCompactViewport: true })).toBe(
      false,
    );
  });
});
