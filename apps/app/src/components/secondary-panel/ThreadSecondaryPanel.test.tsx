// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { type ReactNode } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type {
  BbDesktopApi,
  BbDesktopInfo,
  BbDesktopInfoChangeHandler,
} from "@bb/server-contract";
import { createNoopDesktopBrowserApi } from "@/test/bb-desktop-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  type SecondaryPanelFileTab,
  ThreadSecondaryPanel,
} from "./ThreadSecondaryPanel";
import {
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";

interface RenderPanelArgs {
  fileTabContent?: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  browserDeck?: ReactNode;
  isBrowserTabActive?: boolean;
  renderAsDrawer?: boolean;
  isOpen?: boolean;
  isConversationCollapsed?: boolean;
  onToggleConversationCollapse?: () => void;
  reserveLeftForDesktopTrafficLights?: boolean;
}

interface ResizeDragEndScenario {
  name: string;
  finishDrag: () => void;
}

interface SecondaryPanelChromeDragScenario {
  name: string;
  activeTab: SecondaryPanelFileTab;
  iframeTitle: string;
  closeButtonLabel: string | null;
}

interface BuildActiveFileTabArgs {
  filename: string;
  id: string;
  isPinned: boolean;
}

const noop = () => {};
const IFRAME_POINTER_EVENTS_NONE_CLASS = "[&_iframe]:pointer-events-none";
const MACOS_DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

function createBbDesktopApi(info: BbDesktopInfo): BbDesktopApi {
  return {
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
    onChange(_listener: BbDesktopInfoChangeHandler) {
      return () => undefined;
    },
    setTheme() {
      // no-op
    },
  };
}

function setBbDesktopInfo(desktopInfo: BbDesktopApi | null): void {
  if (desktopInfo === null) {
    delete window.bbDesktop;
    return;
  }
  window.bbDesktop = desktopInfo;
}

function buildActiveFileTab({
  filename,
  id,
  isPinned,
}: BuildActiveFileTabArgs): SecondaryPanelFileTab {
  return {
    id,
    filename,
    isActive: true,
    isPinned,
    statusLabel: null,
    onSelect: noop,
    onClose: noop,
  };
}

function expectNoDragRegionOnElementOrAncestor(element: HTMLElement): void {
  let current: HTMLElement | null = element;
  while (current !== null) {
    if (current.className.includes(MACOS_WINDOW_NO_DRAG_CLASS)) {
      return;
    }
    current = current.parentElement;
  }
  throw new Error("Expected element or ancestor to opt out of window drag");
}

function renderPanel({
  fileTabContent,
  fileTabs,
  browserDeck,
  isBrowserTabActive = false,
  renderAsDrawer = true,
  isOpen = true,
  isConversationCollapsed = false,
  onToggleConversationCollapse = noop,
  reserveLeftForDesktopTrafficLights = false,
}: RenderPanelArgs) {
  const { wrapper } = createQueryClientTestHarness();
  const panel = (
    <ThreadSecondaryPanel
      activePanel="thread-info"
      canUseGitUi={false}
      environmentId={undefined}
      fileTabContent={fileTabContent}
      fileTabs={fileTabs}
      browserDeck={browserDeck}
      isBrowserTabActive={isBrowserTabActive}
      isOpen={isOpen}
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onOpenNewTab={noop}
      onPanelChange={noop}
      onPanelFocus={noop}
      isConversationCollapsed={isConversationCollapsed}
      onToggleConversationCollapse={onToggleConversationCollapse}
      reserveLeftForDesktopTrafficLights={reserveLeftForDesktopTrafficLights}
      renderAsDrawer={renderAsDrawer}
      showGitDiffTab={false}
    />
  );

  return render(
    renderAsDrawer ? (
      panel
    ) : (
      <PanelGroup direction="horizontal" style={{ height: 400, width: 800 }}>
        <Panel id="test-main-panel" minSize={30}>
          Main panel
        </Panel>
        {panel}
      </PanelGroup>
    ),
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  setBbDesktopInfo(null);
});

describe("ThreadSecondaryPanel", () => {
  it.each<SecondaryPanelChromeDragScenario>([
    {
      name: "status app iframe",
      activeTab: buildActiveFileTab({
        id: "app:status",
        filename: "Status",
        isPinned: true,
      }),
      iframeTitle: "Status app",
      closeButtonLabel: null,
    },
    {
      name: "HTML preview iframe",
      activeTab: buildActiveFileTab({
        id: "workspace:index.html",
        filename: "index.html",
        isPinned: false,
      }),
      iframeTitle: "index.html preview",
      closeButtonLabel: "Close index.html",
    },
  ])(
    "makes the secondary panel top chrome draggable above the $name on macOS",
    ({ activeTab, closeButtonLabel, iframeTitle }) => {
      setBbDesktopInfo(createBbDesktopApi(MACOS_DESKTOP_INFO));

      renderPanel({
        fileTabs: [activeTab],
        fileTabContent: <iframe title={iframeTitle} />,
        renderAsDrawer: false,
      });

      const topChrome = screen.getByTestId("thread-secondary-panel-top-chrome");
      expect(topChrome.className).toContain(MACOS_WINDOW_DRAG_CLASS);
      expect(screen.getByTitle(iframeTitle)).not.toBeNull();
      expectNoDragRegionOnElementOrAncestor(
        screen.getByRole("button", { name: "Show thread info panel" }),
      );
      expectNoDragRegionOnElementOrAncestor(
        screen.getByRole("button", { name: "Open a new tab" }),
      );
      expectNoDragRegionOnElementOrAncestor(
        screen.getByRole("button", { name: "Hide secondary panel" }),
      );
      expectNoDragRegionOnElementOrAncestor(
        screen.getByRole("button", { name: activeTab.filename }),
      );

      if (closeButtonLabel !== null) {
        expectNoDragRegionOnElementOrAncestor(
          screen.getByRole("button", { name: closeButtonLabel }),
        );
      }
    },
  );

  it.each<ResizeDragEndScenario>([
    {
      name: "pointerup",
      finishDrag: () => {
        fireEvent.pointerUp(document.body, {
          buttons: 0,
          clientX: 160,
          clientY: 0,
          isPrimary: true,
        });
      },
    },
    {
      name: "pointercancel",
      finishDrag: () => {
        fireEvent.pointerCancel(document.body, {
          buttons: 0,
          clientX: 160,
          clientY: 0,
          isPrimary: true,
        });
      },
    },
    {
      name: "window blur",
      finishDrag: () => {
        fireEvent.blur(window);
      },
    },
  ])(
    "keeps iframe previews interactable after secondary panel resize ends via $name",
    async ({ finishDrag }) => {
      const activeStatusTab: SecondaryPanelFileTab = {
        id: "app:status",
        filename: "Status",
        isActive: true,
        isPinned: true,
        statusLabel: null,
        onSelect: noop,
        onClose: noop,
      };

      renderPanel({
        fileTabs: [activeStatusTab],
        fileTabContent: <iframe title="Status app" />,
        renderAsDrawer: false,
      });

      const panel = document.querySelector<HTMLElement>(
        "#thread-detail-secondary-panel",
      );
      const aside = panel?.querySelector("aside");
      const iframe = screen.getByTitle("Status app");
      const resizeHandle = screen.getByLabelText(
        "Resize thread and secondary panels",
      );

      expect(panel).not.toBeNull();
      expect(aside).not.toBeNull();

      fireEvent.pointerDown(resizeHandle, {
        buttons: 1,
        clientX: 0,
        clientY: 0,
        isPrimary: true,
      });

      await waitFor(() => {
        expect(aside?.className).toContain(IFRAME_POINTER_EVENTS_NONE_CLASS);
      });

      finishDrag();

      await waitFor(() => {
        expect(aside?.className).not.toContain(
          IFRAME_POINTER_EVENTS_NONE_CLASS,
        );
      });

      expect(panel?.style.pointerEvents).toBe("auto");
      expect(window.getComputedStyle(iframe).pointerEvents).toBe("auto");
    },
  );

  it("reserves the full traffic-light step on the top chrome when the panel is the top-left-most surface", () => {
    renderPanel({ reserveLeftForDesktopTrafficLights: true });

    const topChrome = screen.getByTestId("thread-secondary-panel-top-chrome");
    // The panel sits right of the 36px rail, so its leading tab must clear the
    // pinned sidebar-collapse trigger that floats over the header — the full
    // reserve, not the smaller page-header inset (which would re-collide).
    expect(topChrome.className).toContain(MACOS_TRAFFIC_LIGHT_RESERVE_CLASS);
    expect(topChrome.className).not.toContain(
      MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
    );
  });

  it("leaves the top chrome flush when the sidebar or conversation already absorbs the traffic-light cluster", () => {
    renderPanel({ reserveLeftForDesktopTrafficLights: false });

    const topChrome = screen.getByTestId("thread-secondary-panel-top-chrome");
    expect(topChrome.className).not.toContain(MACOS_TRAFFIC_LIGHT_RESERVE_CLASS);
  });

  it("shows the resize seam hairline while the conversation is expanded", () => {
    renderPanel({ renderAsDrawer: false, isConversationCollapsed: false });

    const resizeHandle = screen.getByLabelText(
      "Resize thread and secondary panels",
    );
    expect(resizeHandle.className).toContain("w-px");
    expect(resizeHandle.className).toContain("opacity-100");
    expect(resizeHandle.className).not.toContain("w-0");
  });

  it("renders the browser deck and suppresses the normal content slot when a browser tab is active", () => {
    renderPanel({
      isBrowserTabActive: true,
      browserDeck: <div>browser deck</div>,
      fileTabs: [
        buildActiveFileTab({ id: "browser:a", filename: "Example", isPinned: false }),
      ],
      fileTabContent: <div>file tab content</div>,
    });

    expect(screen.getByText("browser deck")).not.toBeNull();
    // The single-slot file content must not render under the deck.
    expect(screen.queryByText("file tab content")).toBeNull();
  });

  it("keeps the browser deck mounted while a non-browser tab is active", () => {
    renderPanel({
      isBrowserTabActive: false,
      browserDeck: <div>browser deck</div>,
      fileTabs: [
        buildActiveFileTab({ id: "app:status", filename: "Status", isPinned: true }),
      ],
      fileTabContent: <div>file tab content</div>,
    });

    // The deck stays in the tree (its native views survive) even though a
    // non-browser tab owns the visible content slot.
    expect(screen.getByText("browser deck")).not.toBeNull();
    expect(screen.getByText("file tab content")).not.toBeNull();
  });

  it("folds the resize seam to zero width while the conversation is collapsed so it does not double the rail's edge", () => {
    renderPanel({ renderAsDrawer: false, isConversationCollapsed: true });

    const resizeHandle = screen.getByLabelText(
      "Resize thread and secondary panels",
    );
    // Collapsed: the rail's recessed edge is the single seam, so the handle
    // hairline must be hidden (and non-interactive) rather than sitting flush
    // against it.
    expect(resizeHandle.className).toContain("w-0");
    expect(resizeHandle.className).toContain("opacity-0");
    expect(resizeHandle.className).toContain("pointer-events-none");
    expect(resizeHandle.className).not.toContain("w-px");
  });

  it("renders an expand-to-fill toggle left of the hide button while the conversation is shown", () => {
    const onToggleConversationCollapse = vi.fn();
    renderPanel({
      renderAsDrawer: false,
      isConversationCollapsed: false,
      onToggleConversationCollapse,
    });

    const toggle = screen.getByRole("button", { name: "Expand panel" });
    const hideButton = screen.getByRole("button", {
      name: "Hide secondary panel",
    });
    // Expand-to-fill glyph, an explicit aria-expanded disclosure, and the hide
    // button sits immediately after it in the trailing controls.
    expect(toggle.querySelector("[data-icon='Maximize2']")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(
      Boolean(
        toggle.compareDocumentPosition(hideButton) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);

    fireEvent.click(toggle);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("renders the inverse restore toggle while the conversation is collapsed", () => {
    const onToggleConversationCollapse = vi.fn();
    renderPanel({
      renderAsDrawer: false,
      isConversationCollapsed: true,
      onToggleConversationCollapse,
    });

    const toggle = screen.getByRole("button", { name: "Restore conversation" });
    expect(toggle.querySelector("[data-icon='Minimize2']")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(onToggleConversationCollapse).toHaveBeenCalledTimes(1);
  });

  it("omits the conversation-collapse toggle in the drawer layout", () => {
    renderPanel({ renderAsDrawer: true });

    expect(screen.queryByRole("button", { name: "Expand panel" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore conversation" }),
    ).toBeNull();
  });
});
