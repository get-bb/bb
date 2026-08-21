// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";

const SIDEBAR_WIDTH_STORAGE_KEY = "bb.sidebar.width";

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: () => {},
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/components/sidebar/AppSidebar", async () => {
  const { Sidebar } = await vi.importActual<
    typeof import("@/components/ui/sidebar")
  >("@/components/ui/sidebar");
  return {
    AppSidebar: ({
      onResizeMouseDown,
    }: {
      onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
    }) => (
      <Sidebar>
        <div data-testid="sidebar-body">App sidebar</div>
        <div data-testid="resize-handle" onMouseDown={onResizeMouseDown} />
      </Sidebar>
    ),
  };
});

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      experiments: {
        editMessages: false,
        providerSessionReaping: false,
      },
    },
  }),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/dialogs/ProjectPathDialog", () => ({
  ProjectPathDialog: () => null,
}));

vi.mock("./AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  AppPageHeader: () => <header />,
}));

vi.mock("@/lib/bb-desktop", () => ({
  BROWSER_SIDEBAR_TRIGGER_INSET_CLASS: "",
  CHROME_ROW_CLASS: "",
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  MACOS_CHROME_CONTROL_AXIS_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS: "",
  MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  MACOS_WINDOW_NO_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/lib/favicon-color-preference", () => ({
  useFaviconBadge: vi.fn(),
}));

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    hostId: null,
    hostName: null,
    isCreating: false,
    platform: "darwin",
    projectPathDialog: { onOpenChange: vi.fn(), target: null },
    submitProjectPath: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      sections: [],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        sources: [],
        threads: [],
        defaultExecutionOptions: null,
        createdAt: 1,
        updatedAt: 1,
      },
      projects: [],
    },
    isError: false,
    isSuccess: true,
  }),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  didThreadDetailBootstrapRefreshAfterMount: () => true,
  useThread: () => ({ data: undefined }),
  useThreadDetailBootstrap: () => ({ isError: false, isSuccess: false }),
  useThreadPendingInteractions: () => ({ data: undefined }),
  getLatestPendingInteraction: () => null,
}));

function widthVar(element: Element | null): string {
  if (!(element instanceof HTMLElement)) throw new Error("missing element");
  return element.style.getPropertyValue("--sidebar-width");
}

function getRoot(): HTMLElement {
  const root = document.querySelector('[data-testid="app-layout-root"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing app root");
  return root;
}

// A resize drag must touch only the two elements that read the width. Writing
// the live width on the app root (an inherited custom property), or setting
// `cursor`/`user-select` on body, restyles every element in the document on
// every frame — in a long thread that was ~50-400 ms per mouse move.
describe("AppLayout sidebar resize drag", () => {
  let frameCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    window.localStorage.clear();
    frameCallbacks = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frameCallbacks.push(cb);
      return frameCallbacks.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  function flushFrames() {
    const callbacks = frameCallbacks;
    frameCallbacks = [];
    act(() => {
      for (const callback of callbacks) callback(0);
    });
  }

  function renderLayout() {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppLayout>
          <div data-testid="route-content">Route</div>
        </AppLayout>
      </MemoryRouter>,
    );
  }

  it("writes the live width on the sidebar gap and panel only, never on the app root or body", () => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "320");
    renderLayout();

    const root = getRoot();
    const gap = document.querySelector('[data-sidebar="gap"]');
    const panel = document.querySelector('[data-sidebar="panel"]');
    expect(widthVar(gap)).toBe("320px");
    expect(widthVar(panel)).toBe("320px");
    expect(widthVar(root)).toBe("");
    const rootStyleBefore = root.getAttribute("style");

    const handle = document.querySelector('[data-testid="resize-handle"]');
    if (!handle) throw new Error("missing handle");
    act(() => {
      fireEvent.mouseDown(handle, { clientX: 320 });
    });
    act(() => {
      fireEvent.mouseMove(window, { clientX: 360 });
    });
    flushFrames();

    expect(widthVar(gap)).toBe("360px");
    expect(widthVar(panel)).toBe("360px");
    expect(widthVar(root)).toBe("");
    expect(root.getAttribute("style")).toBe(rootStyleBefore);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    // Not committed until mouseup.
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("320");

    act(() => {
      fireEvent.mouseUp(window);
    });

    expect(widthVar(gap)).toBe("360px");
    expect(widthVar(panel)).toBe("360px");
    expect(widthVar(root)).toBe("");
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("360");
    expect(document.body.classList.contains("sidebar-resizing")).toBe(false);
  });

  it("mounts the drag-guard overlay after the app root and gives it the resize cursor", () => {
    renderLayout();
    const root = getRoot();
    expect(
      document.querySelector('[data-testid="iframe-drag-guard-overlay"]'),
    ).toBeNull();

    const handle = document.querySelector('[data-testid="resize-handle"]');
    if (!handle) throw new Error("missing handle");
    act(() => {
      fireEvent.mouseDown(handle, { clientX: 320 });
    });

    const overlay = document.querySelector(
      '[data-testid="iframe-drag-guard-overlay"]',
    );
    if (!overlay) throw new Error("overlay did not mount");
    expect(overlay.className).toContain("cursor-col-resize");
    // Inserting a node before a sibling invalidates that sibling's whole
    // subtree; after it, nothing.
    expect(
      root.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(root.contains(overlay)).toBe(false);

    act(() => {
      fireEvent.mouseUp(window);
    });
    expect(
      document.querySelector('[data-testid="iframe-drag-guard-overlay"]'),
    ).toBeNull();
  });
});
