// @vitest-environment jsdom

import { useEffect } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import type { SidebarThreadSearchPanelController } from "./sidebarThreadSearch";
import { AppSidebar } from "./AppSidebar";

interface FakeProjectListProps {
  threadSearch?: SidebarThreadSearchPanelController;
}

vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: false,
    isCreating: false,
    openCreateDialog: () => undefined,
  }),
}));

vi.mock("./ProjectList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectList")>();

  function FakeProjectList({ threadSearch }: FakeProjectListProps) {
    useEffect(() => {
      if (!threadSearch?.isActive) {
        return;
      }
      threadSearch.onNavigationItemsChange([
        {
          id: "fake-result",
          projectId: "project-1",
          threadId: "thread-1",
        },
      ]);
    }, [threadSearch]);

    return (
      <div data-testid="fake-project-list">
        {threadSearch?.isActive ? "search mode" : "normal mode"}
      </div>
    );
  }

  return {
    ...actual,
    ProjectList: FakeProjectList,
  };
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-pathname">{location.pathname}</span>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppSidebar thread search controller", () => {
  it("opens from the global shortcut, navigates the active result, and closes with Escape", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      window.setTimeout(() => callback(0), 0);
      return 1;
    });

    render(
      <SidebarProvider>
        <MemoryRouter>
          <AppSidebar
            isResizing={false}
            onResizeMouseDown={vi.fn()}
            showTopReserve={false}
          />
          <LocationProbe />
        </MemoryRouter>
      </SidebarProvider>,
    );

    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox", {
      name: "Search threads",
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
    expect(screen.getByTestId("fake-project-list").textContent).toBe(
      "search mode",
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("location-pathname").textContent).toBe(
      getThreadRoutePath({ projectId: "project-1", threadId: "thread-1" }),
    );

    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("combobox", { name: "Search threads" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
  });
});
