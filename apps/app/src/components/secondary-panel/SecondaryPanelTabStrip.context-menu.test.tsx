// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import {
  SecondaryPanelTabStrip,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function tabs(): SecondaryPanelTabStripProps["tabs"] {
  const base = {
    isPinned: false,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
  };
  return [
    {
      ...base,
      label: "Example Domain",
      tab: {
        id: "browser-tab",
        kind: "browser" as const,
        environmentId: null,
        title: "Example Domain",
        url: "https://example.com",
      },
    },
    { ...base, label: "New tab", tab: { id: "new-tab", kind: "new-tab" as const } },
  ];
}

function renderStrip() {
  render(
    <SecondaryPanelTabStrip
      activeTabId="browser-tab"
      tabs={tabs()}
      onReorderTab={vi.fn()}
      usesDesktopChrome={false}
      isPanelOpen
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.bbDesktop;
});

describe("SecondaryPanelTabStrip tab context menu", () => {
  it("reloads a browser tab from its context menu in the desktop app", () => {
    const browser = createNoopDesktopBrowserApi();
    const reload = vi.spyOn(browser, "reload");
    window.bbDesktop = createBbDesktopApi(desktopInfo, browser);
    renderStrip();

    fireEvent.contextMenu(screen.getByText("Example Domain"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reload tab" }));

    expect(reload).toHaveBeenCalledWith("browser-tab");
  });

  it("offers no reload for other tabs or outside the desktop app", () => {
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    renderStrip();
    fireEvent.contextMenu(screen.getByText("New tab"));
    expect(screen.queryByRole("menuitem", { name: "Reload tab" })).toBeNull();
    cleanup();

    delete window.bbDesktop;
    renderStrip();
    fireEvent.contextMenu(screen.getByText("Example Domain"));
    expect(screen.getByRole("menuitem", { name: "Close tab" })).not.toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Reload tab" })).toBeNull();
  });
});
