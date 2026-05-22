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
  renderAsDrawer = true,
}: RenderPanelArgs) {
  const { wrapper } = createQueryClientTestHarness();
  const panel = (
    <ThreadSecondaryPanel
      activePanel="thread-info"
      canUseGitUi={false}
      environmentId={undefined}
      fileTabContent={fileTabContent}
      fileTabs={fileTabs}
      isOpen
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onOpenNewTab={noop}
      onPanelChange={noop}
      onPanelFocus={noop}
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
      name: "STATUS iframe",
      activeTab: buildActiveFileTab({
        id: "storage:STATUS",
        filename: "STATUS",
        isPinned: true,
      }),
      iframeTitle: "Manager status",
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
        id: "storage:STATUS",
        filename: "STATUS",
        isActive: true,
        isPinned: true,
        statusLabel: null,
        onSelect: noop,
        onClose: noop,
      };

      renderPanel({
        fileTabs: [activeStatusTab],
        fileTabContent: <iframe title="Manager status" />,
        renderAsDrawer: false,
      });

      const panel = document.querySelector<HTMLElement>(
        "#thread-detail-secondary-panel",
      );
      const aside = panel?.querySelector("aside");
      const iframe = screen.getByTitle("Manager status");
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
