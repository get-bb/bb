// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/server-contract";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import type { ThreadGitActionDialogTarget } from "@/components/dialogs/ThreadGitActionDialog";
import { ThreadDetailHeader } from "./ThreadDetailHeader";

vi.mock("@/components/ui/hooks/use-compact-viewport.js", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  SidebarTrigger: () => null,
  useIsSidebarShowing: () => true,
}));

interface RenderHeaderOverrides {
  actionsMenu?: ReactNode;
  isSecondaryPanelOpen?: boolean;
  onOpenThreadGitAction?: (target: ThreadGitActionDialogTarget) => void;
  onToggleSecondaryPanel?: () => void;
  threadHeaderGitActions?: TestThreadHeaderGitAction[];
}

interface TestThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

function renderHeader(overrides: RenderHeaderOverrides = {}) {
  const noop = () => {};
  const props = {
    actionsMenu: overrides.actionsMenu ?? null,
    activeTerminalCount: 0,
    isChildThread: false,
    isSecondaryPanelOpen: overrides.isSecondaryPanelOpen ?? false,
    isTerminalPanelOpen: false,
    onOpenThreadGitAction: overrides.onOpenThreadGitAction ?? noop,
    onToggleSecondaryPanel: overrides.onToggleSecondaryPanel ?? noop,
    onToggleTerminalPanel: noop,
    threadHeaderGitActions: overrides.threadHeaderGitActions ?? [],
    threadTitle: "Test thread",
  };
  return render(<ThreadDetailHeader {...props} />);
}

function installMacosDesktopChrome(): void {
  const info: BbDesktopInfo = {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.1",
  };
  const desktop: BbDesktopApi = {
    ...info,
    browser: createNoopDesktopBrowserApi(),
    async checkForUpdates() {
      return info;
    },
    async getInfo() {
      return info;
    },
    async installUpdate() {
      return undefined;
    },
    onChange() {
      return () => undefined;
    },
    setTheme() {},
  };
  window.bbDesktop = desktop;
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

describe("ThreadDetailHeader actions menu drag region", () => {
  // The header center slot is a macOS title-bar drag region; without a no-drag
  // exemption the actions-menu trigger's clicks are swallowed as window drags.
  it("exempts the actions menu from window dragging under desktop chrome", () => {
    installMacosDesktopChrome();
    renderHeader({
      actionsMenu: <button type="button">Thread actions</button>,
    });

    const wrapper = screen.getByTestId("thread-detail-header-actions-menu");
    expect(wrapper.className).toContain(MACOS_WINDOW_NO_DRAG_CLASS);
    expect(
      screen.getByRole("button", { name: "Thread actions" }).parentElement,
    ).toBe(wrapper);
  });

  it("keeps the desktop-only no-drag classes off the web build", () => {
    renderHeader({
      actionsMenu: <button type="button">Thread actions</button>,
    });

    const wrapper = screen.getByTestId("thread-detail-header-actions-menu");
    expect(wrapper.className).not.toContain("app-region");
    expect(wrapper.className).not.toContain("z-50");
  });
});

describe("ThreadDetailHeader git actions", () => {
  it("keeps git action buttons clickable so actions can queue", () => {
    const onOpenThreadGitAction = vi.fn();
    renderHeader({
      onOpenThreadGitAction,
      threadHeaderGitActions: [
        { label: "Commit", target: { kind: "commit" } },
        { label: "Squash merge", target: { kind: "squash_merge" } },
      ],
    });

    const commitButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "Commit",
    });
    const moreActionsButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "More actions",
    });

    expect(commitButton.disabled).toBe(false);
    expect(moreActionsButton.disabled).toBe(false);

    fireEvent.click(commitButton);
    expect(onOpenThreadGitAction).toHaveBeenCalledWith({ kind: "commit" });
  });
});

describe("ThreadDetailHeader panel toggle", () => {
  it("opens the secondary panel from the closed state", () => {
    const onToggleSecondaryPanel = vi.fn();
    renderHeader({
      isSecondaryPanelOpen: false,
      onToggleSecondaryPanel,
    });

    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // Closed state renders the recognizable panel icon, not a chevron, so it
    // reads as "open the right side panel".
    expect(button.querySelector("[data-icon='PanelRight']")).not.toBeNull();

    fireEvent.click(button);
    expect(onToggleSecondaryPanel).toHaveBeenCalledTimes(1);
  });

  it("drops the panel toggle from the conversation header once the panel is open", () => {
    // Open state moves the expand/collapse-conversation toggle into the panel
    // header, so the conversation header no longer carries a panel affordance.
    renderHeader({ isSecondaryPanelOpen: true });

    expect(screen.queryByRole("button", { name: "Show panel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand panel" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore conversation" }),
    ).toBeNull();
  });
});
