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
import type { BbDesktopApi, BbDesktopInfo } from "@bb/server-contract";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  type SecondaryPanelFileTab,
  ThreadSecondaryPanel,
} from "./ThreadSecondaryPanel";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import {
  MACOS_COLLAPSED_HEADER_RESERVE_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";
import type { SecondaryFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { createThreadInfoFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { Icon } from "@/components/ui/icon";

interface RenderPanelArgs {
  activeTab?: SecondaryFixedPanelTab | null;
  canUseGitUi?: boolean;
  fileTabContent?: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  browserDeck?: ReactNode;
  isBrowserTabActive?: boolean;
  renderAsDrawer?: boolean;
  isOpen?: boolean;
  isConversationCollapsed?: boolean;
  onToggleConversationCollapse?: () => void;
  reserveLeftForDesktopTrafficLights?: boolean;
  onOpenNewTab?: () => void;
  showGitDiffTab?: boolean;
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
const IFRAME_DRAG_GUARD_OVERLAY_TESTID = "iframe-drag-guard-overlay";
// The class that used to disable iframe pointer-events during resize — asserted
// absent so the regression that broke wheel-scroll can't be reintroduced.
const IFRAME_POINTER_EVENTS_TOGGLE_CLASS = "[&_iframe]:pointer-events-none";
const MACOS_DESKTOP_INFO: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.1",
};

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
    leadingVisual: <Icon name="Code" className="size-3.5" aria-hidden />,
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
  activeTab = createThreadInfoFixedPanelTab(),
  canUseGitUi = false,
  fileTabContent,
  fileTabs,
  browserDeck,
  isBrowserTabActive = false,
  renderAsDrawer = true,
  isOpen = true,
  isConversationCollapsed = false,
  onToggleConversationCollapse = noop,
  reserveLeftForDesktopTrafficLights = false,
  onOpenNewTab = noop,
  showGitDiffTab = false,
}: RenderPanelArgs = {}) {
  const { wrapper } = createQueryClientTestHarness();
  const panel = (
    <ThreadSecondaryPanel
      activeTab={activeTab}
      canUseGitUi={canUseGitUi}
      environmentId={undefined}
      fileTabContent={fileTabContent}
      fileTabs={fileTabs}
      browserDeck={browserDeck}
      isBrowserTabActive={isBrowserTabActive}
      isOpen={isOpen}
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onFileTabReorder={noop}
      onOpenNewTab={onOpenNewTab}
      onPanelChange={noop}
      onPanelFocus={noop}
      isConversationCollapsed={isConversationCollapsed}
      onToggleConversationCollapse={onToggleConversationCollapse}
      reserveLeftForDesktopTrafficLights={reserveLeftForDesktopTrafficLights}
      renderAsDrawer={renderAsDrawer}
      showGitDiffTab={showGitDiffTab}
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
      name: "app iframe",
      activeTab: buildActiveFileTab({
        id: "app:review-board",
        filename: "Review Board",
        isPinned: true,
      }),
      iframeTitle: "Review Board app",
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
        screen.getByRole("button", { name: "Open new tab" }),
      );
      expectNoDragRegionOnElementOrAncestor(
        screen.getByRole("button", { name: "Hide right panel" }),
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

  it("keeps the New Tab button immediately after the tab strip's last tab", () => {
    renderPanel({
      fileTabs: [
        buildActiveFileTab({
          id: "workspace:a.ts",
          filename: "a.ts",
          isPinned: false,
        }),
      ],
      renderAsDrawer: false,
    });

    const strip = screen.getByTestId("secondary-panel-tab-strip");
    const newTab = screen.getByRole("button", { name: "Open new tab" });

    // Browser-style: the + sits right after the last tab. It is the strip's
    // immediate next sibling, and the strip is sized to its tabs (no flex-grow),
    // so leftover panel width cannot push the + to the far edge.
    expect(strip.nextElementSibling).toBe(newTab);
    expect(strip.className).not.toContain("flex-1");
  });

  it("exposes the panel view controls as a toolbar, not an unbacked tablist", () => {
    renderPanel({ renderAsDrawer: false });

    // The Info/Diff/file controls are toggle buttons (`aria-pressed`), not
    // tabs backed by tabpanels, so the control row must carry toolbar
    // semantics rather than pretending to be a tablist.
    expect(
      screen.getByRole("toolbar", { name: "Right panel views" }),
    ).not.toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("does not show the Diff control when git UI is unavailable", () => {
    renderPanel({
      canUseGitUi: false,
      showGitDiffTab: true,
      renderAsDrawer: false,
    });

    expect(
      screen.queryByRole("button", { name: "Show diff panel" }),
    ).toBeNull();
    expect(screen.getByText("Thread details")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show thread info panel" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("marks Info active when the panel falls back to thread details", () => {
    renderPanel({ activeTab: null });

    expect(screen.getByText("Thread details")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show thread info panel" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("opens the new-tab page from the plus button", () => {
    const onOpenNewTab = vi.fn();
    renderPanel({ onOpenNewTab });

    const infoButton = screen.getByRole("button", {
      name: "Show thread info panel",
    });
    const newTabButton = screen.getByRole("button", { name: "Open new tab" });
    expect(infoButton.className).toContain(
      CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
    );
    expect(newTabButton.className).toContain(
      CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
    );
    expect(newTabButton.className).toContain("h-7");
    expect(newTabButton.className).toContain("w-7");
    expect(infoButton.className).toContain("[&_svg]:size-3.5");
    expect(newTabButton.className).toContain("[&_svg]:size-3.5");
    expect(infoButton.className).toContain("max-md:pointer-coarse:h-9");
    expect(infoButton.className).toContain("max-md:pointer-coarse:w-9");
    expect(infoButton.className).toContain(
      "max-md:pointer-coarse:[&_svg]:size-5",
    );
    expect(newTabButton.className).toContain("max-md:pointer-coarse:h-9");
    expect(newTabButton.className).toContain("max-md:pointer-coarse:w-9");
    expect(newTabButton.className).toContain(
      "max-md:pointer-coarse:[&_svg]:size-5",
    );
    expect(infoButton.className).not.toContain("[&_svg]:size-4");
    expect(newTabButton.className).not.toContain("[&_svg]:size-4");

    fireEvent.click(newTabButton);

    expect(onOpenNewTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the vertical seam token for the panel resize-handle hairline", () => {
    renderPanel({ renderAsDrawer: false });

    const handle = screen.getByRole("separator", {
      name: "Resize thread and right panel",
    });
    const hairline = handle.querySelector("span");

    // The resting hairline uses the dedicated vertical seam token rather than
    // the stronger content `bg-border`.
    expect(hairline?.className).toContain("bg-border-seam-vertical");
  });

  it("uses the shared top chrome background on the panel top nav", () => {
    renderPanel({ renderAsDrawer: false });

    const topChrome = screen.getByTestId("thread-secondary-panel-top-chrome");

    expect(topChrome.parentElement?.className).toContain(
      SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
    );
  });

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
      const activeAppTab: SecondaryPanelFileTab = {
        id: "app:review-board",
        filename: "Review Board",
        isActive: true,
        isPinned: true,
        leadingVisual: (
          <Icon name="AppWindow" className="size-3.5" aria-hidden />
        ),
        statusLabel: null,
        onSelect: noop,
        onClose: noop,
      };

      renderPanel({
        fileTabs: [activeAppTab],
        fileTabContent: <iframe title="Review Board app" />,
        renderAsDrawer: false,
      });

      const panel = document.querySelector<HTMLElement>(
        "#thread-detail-secondary-panel",
      );
      const aside = panel?.querySelector("aside");
      const resizeHandle = screen.getByLabelText(
        "Resize thread and right panel",
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
        expect(
          screen.queryByTestId(IFRAME_DRAG_GUARD_OVERLAY_TESTID),
        ).not.toBeNull();
      });
      // Regression guard: the drag must be intercepted by the overlay, never by
      // disabling the iframe's pointer-events — that detaches the iframe's
      // compositor scroll node in Chromium and kills wheel-scroll after resize.
      expect(aside?.className).not.toContain(
        IFRAME_POINTER_EVENTS_TOGGLE_CLASS,
      );

      finishDrag();

      // Every drag-end path must tear the overlay down — a stuck overlay would
      // leave the whole panel shielded from clicks and scrolling.
      await waitFor(() => {
        expect(
          screen.queryByTestId(IFRAME_DRAG_GUARD_OVERLAY_TESTID),
        ).toBeNull();
      });
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
    expect(topChrome.className).not.toContain(
      MACOS_TRAFFIC_LIGHT_RESERVE_CLASS,
    );
  });

  it("shows the resize seam hairline while the conversation is expanded", () => {
    renderPanel({ renderAsDrawer: false, isConversationCollapsed: false });

    const resizeHandle = screen.getByLabelText("Resize thread and right panel");
    expect(resizeHandle.className).toContain("w-px");
    expect(resizeHandle.className).toContain("opacity-100");
    expect(resizeHandle.className).not.toContain("w-0");
  });

  it("renders the browser deck and suppresses the normal content slot when a browser tab is active", () => {
    renderPanel({
      isBrowserTabActive: true,
      browserDeck: <div>browser deck</div>,
      fileTabs: [
        buildActiveFileTab({
          id: "browser:a",
          filename: "Example",
          isPinned: false,
        }),
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
        buildActiveFileTab({
          id: "app:status",
          filename: "Status",
          isPinned: true,
        }),
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

    const resizeHandle = screen.getByLabelText("Resize thread and right panel");
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

    const toggle = screen.getByRole("button", { name: "Expand right panel" });
    const hideButton = screen.getByRole("button", {
      name: "Hide right panel",
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

    expect(
      screen.queryByRole("button", { name: "Expand right panel" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Restore conversation" }),
    ).toBeNull();
  });
});
