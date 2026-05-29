// @vitest-environment jsdom

import {
  cleanup,
  createEvent,
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
import { afterEach, describe, expect, it } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  type SecondaryPanelFileTab,
  ThreadSecondaryPanel,
} from "./ThreadSecondaryPanel";
import {
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
} from "@/lib/bb-desktop";

interface RenderPanelArgs {
  fileTabContent?: ReactNode;
  fileTabs?: SecondaryPanelFileTab[];
  renderAsDrawer?: boolean;
  isOpen?: boolean;
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

interface StubRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// jsdom reports zero-sized rects, which would make every element "overlap" at
// the origin. Give an element a concrete box so react-resizable-panels' hit
// detection / stacking-exclusion runs against real geometry.
function stubBoundingRect(element: Element, rect: StubRect): void {
  element.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

function pressPointer(element: Element): Event {
  const event = createEvent.pointerDown(element, {
    buttons: 1,
    clientX: 400,
    clientY: 200,
    isPrimary: true,
  });
  fireEvent(element, event);
  return event;
}

function releasePointer(): void {
  // Released on body (not window): react-resizable-panels' pointerup handler
  // walks parentElement from the target, which window does not support.
  fireEvent.pointerUp(document.body, {
    buttons: 0,
    clientX: 400,
    clientY: 200,
  });
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
  renderAsDrawer = true,
  isOpen = true,
}: RenderPanelArgs) {
  const { wrapper } = createQueryClientTestHarness();
  const panel = (
    <ThreadSecondaryPanel
      activePanel="thread-info"
      canUseGitUi={false}
      environmentId={undefined}
      fileTabContent={fileTabContent}
      fileTabs={fileTabs}
      isOpen={isOpen}
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onOpenNewTab={noop}
      onPanelChange={noop}
      onPanelFocus={noop}
      isConversationCollapsed={false}
      onToggleConversationCollapse={noop}
      onToggleSecondaryPanel={noop}
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
  it("surfaces the seam arrow as a show-panel control while the panel is closed", () => {
    renderPanel({ renderAsDrawer: false, isOpen: false });

    expect(
      screen.getByRole("button", { name: "Show panel" }),
    ).not.toBeNull();
  });

  it("does not start a resize when the seam arrow is pressed", () => {
    renderPanel({ renderAsDrawer: false });

    const resizeHandle = screen.getByLabelText(
      "Resize thread and secondary panels",
    );
    const toggle = screen.getByRole("button", {
      name: "Expand panel",
    });

    // Precondition for the library's exclusion: the toggle must NOT be a DOM
    // descendant of the handle, otherwise it is treated as part of the drag.
    expect(resizeHandle.contains(toggle)).toBe(false);

    // Overlapping boxes centered on the same seam x (≈400).
    stubBoundingRect(resizeHandle, { x: 400, y: 0, width: 1, height: 400 });
    stubBoundingRect(toggle, { x: 388, y: 188, width: 24, height: 24 });

    // react-resizable-panels claims a press as a resize start by calling
    // preventDefault on the (capture-phase, body-level) pointerdown. Pressing
    // the toggle must leave the event un-defaulted (no resize), while pressing
    // the bare handle must default it (resize starts) — proving the gesture
    // really reaches the library and is intercepted only for the toggle.
    const toggleEvent = pressPointer(toggle);
    expect(toggleEvent.defaultPrevented).toBe(false);
    releasePointer();

    const handleEvent = pressPointer(resizeHandle);
    expect(handleEvent.defaultPrevented).toBe(true);
    releasePointer();
  });

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
});
