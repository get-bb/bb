// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/ui/sidebar";
import {
  AppLayout,
  defaultAppLayoutDependencies,
  type AppLayoutDependencies,
} from "./AppLayout";

const SIDEBAR_WIDTH_STORAGE_KEY = "bb.sidebar.width";

/* SAFETY: The fixture replaces each production dependency with a focused test implementation. */
/* SAFETY: The fixture replaces each production dependency with focused test implementations. */
const appLayoutDependencies: AppLayoutDependencies = Object.assign(
  {},
  defaultAppLayoutDependencies,
  {
    useAppCommandHandler: () => {},
    useAppCommandShortcut: () => null,
    AppLayoutSidebar: ({
      onResizeMouseDown,
    }: {
      onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
    }) => (
      <Sidebar>
        <div data-testid="sidebar-body">App sidebar</div>
        <div data-testid="resize-handle" onMouseDown={onResizeMouseDown} />
      </Sidebar>
    ),
    ProjectActionsProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    ThreadActionsProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    ProjectPathDialog: () => null,
    AppPageHeader: () => <header />,
    headerIconButtonClass: "header-icon-button",
    IframeDragGuardOverlay: ({
      active,
      cursor,
    }: {
      active: boolean;
      cursor: string;
    }) =>
      active ? (
        <div
          data-testid="iframe-drag-guard-overlay"
          className={`cursor-${cursor}`}
        />
      ) : null,
    getBbDesktopInfo: () => null,
    shouldReserveMacosTrafficLights: () => false,
    shouldUseMacosDesktopChrome: () => false,
    useFaviconBadge: () => {},
    useQuickCreateProjectController: () => ({
      hostId: null,
      hostName: null,
      isCreating: false,
      platform: "darwin",
      projectPathDialog: { onOpenChange: vi.fn(), target: null },
      submitProjectPath: vi.fn(),
    }),
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
    didThreadDetailBootstrapRefreshAfterMount: () => true,
    useThread: () => ({ data: undefined }),
    useThreadDetailBootstrap: () => ({ isError: false, isSuccess: false }),
    useThreadPendingInteractions: () => ({ data: undefined }),
    getLatestPendingInteraction: () => null,
  },
);

function widthVar(element: Element | null): string {
  if (!(element instanceof HTMLElement)) throw new Error("missing element");
  return element.style.getPropertyValue("--sidebar-width");
}

function getRoot(): HTMLElement {
  const root = document.querySelector('[data-testid="app-layout-root"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing app root");
  return root;
}

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
        <AppLayout dependencies={appLayoutDependencies}>
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
