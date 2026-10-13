// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
} from "@/lib/bb-desktop";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { AppPageHeader } from "./AppPageHeader";

const macosDesktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const RESERVE_CLASSES = [
  BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
];

function renderHeaderReserve({
  collapsedRailWidth,
  isCompactViewport = false,
  open = false,
}: {
  collapsedRailWidth?: string;
  isCompactViewport?: boolean;
  open?: boolean;
}): string[] {
  render(
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <SidebarProvider open={open} collapsedRailWidth={collapsedRailWidth}>
        <AppPageHeader />
      </SidebarProvider>
    </CompactViewportOverrideProvider>,
  );
  const classNames = screen
    .getByTestId("app-page-header-content-row")
    .className.split(" ");
  return RESERVE_CLASSES.filter((reserve) =>
    reserve.split(" ").every((token) => classNames.includes(token)),
  );
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

describe("AppPageHeader window top-left reserve", () => {
  it("reserves the browser trigger slot when the sidebar slides fully away", () => {
    expect(renderHeaderReserve({})).toEqual([
      BROWSER_COLLAPSED_HEADER_RESERVE_CLASS,
    ]);
  });

  it("reserves nothing beside a collapsed rail, which keeps the trigger", () => {
    expect(renderHeaderReserve({ collapsedRailWidth: "52px" })).toEqual([]);
  });

  it("reserves nothing beside a collapsed rail on macOS, where the title bar hosts the lights", () => {
    window.bbDesktop = createBbDesktopApi(macosDesktopInfo);

    expect(renderHeaderReserve({ collapsedRailWidth: "52px" })).toEqual([]);
  });

  it("keeps the full macOS reserve when no rail stays behind", () => {
    window.bbDesktop = createBbDesktopApi(macosDesktopInfo);

    expect(renderHeaderReserve({})).toEqual([
      MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS,
    ]);
  });

  it("still reserves the trigger slot on compact viewports with the rail experiment on", () => {
    expect(
      renderHeaderReserve({
        collapsedRailWidth: "52px",
        isCompactViewport: true,
        open: true,
      }),
    ).toEqual([BROWSER_COLLAPSED_HEADER_RESERVE_CLASS]);
  });

  it("reserves nothing while the sidebar is showing", () => {
    expect(
      renderHeaderReserve({ collapsedRailWidth: "52px", open: true }),
    ).toEqual([]);
  });
});
