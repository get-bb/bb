// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "../../.ladle/story-fixtures";
import {
  DashboardView,
  getDashboardThreadColumn,
  groupDashboardThreads,
} from "./DashboardView";

const navigationData = {
  personalProject: {
    id: "personal",
    name: "Personal",
    threads: [],
  },
  projects: [
    {
      id: "proj_bb",
      name: "bb",
      threads: [
        makeThreadListEntry({
          id: "thr_idle",
          title: "Idle thread",
        }),
        makeThreadListEntry({
          id: "thr_active",
          title: "Active thread",
          dashboardStatus: "in-progress",
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
        makeThreadListEntry({
          id: "thr_waiting",
          title: "Waiting thread",
          dashboardStatus: "in-review",
          status: "active",
          hasPendingInteraction: true,
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
        makeThreadListEntry({
          id: "thr_error",
          title: "Error thread",
          dashboardStatus: "canceled",
          status: "error",
          runtime: {
            displayStatus: "error",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      ],
    },
  ],
};

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: navigationData,
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useUpdateThread: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
});

describe("dashboard thread grouping", () => {
  it("groups threads by their dashboard workflow state", () => {
    const threads = navigationData.projects[0].threads;
    const grouped = groupDashboardThreads(threads);

    expect(grouped.backlog.map((thread) => thread.id)).toEqual(["thr_idle"]);
    expect(grouped["in-progress"].map((thread) => thread.id)).toEqual([
      "thr_active",
    ]);
    expect(grouped["in-review"].map((thread) => thread.id)).toEqual([
      "thr_waiting",
    ]);
    expect(grouped.canceled.map((thread) => thread.id)).toEqual(["thr_error"]);
  });

  it("places failed threads in the canceled column", () => {
    const thread = makeThreadListEntry({
      dashboardStatus: "canceled",
      status: "error",
      runtime: {
        displayStatus: "error",
        hostReconnectGraceExpiresAt: null,
      },
    });

    expect(getDashboardThreadColumn(thread)).toBe("canceled");
  });
});

describe("DashboardView", () => {
  it("switches between the Kanban and Grid tabs through the URL", () => {
    render(
      <MemoryRouter initialEntries={["/dashboard"]}>
        <DashboardView />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("dashboard-kanban")).toBeTruthy();
    for (const label of [
      "Backlog",
      "In progress",
      "In review",
      "Done",
      "Canceled",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeTruthy();
    }
    expect(
      screen.getByRole("tab", { name: "Kanban" }).getAttribute("aria-selected"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "Grid" }));

    expect(screen.queryByTestId("dashboard-kanban")).toBeNull();
    expect(screen.getByText("Grid view is next")).toBeTruthy();
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe(
      "Grid view",
    );
  });
});
