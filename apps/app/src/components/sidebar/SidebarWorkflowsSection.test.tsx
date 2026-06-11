// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { WorkflowRunResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installFetchRoutes,
  jsonResponse,
  type FetchRoute,
} from "@/test/http-test-utils";
import { makeWorkflowRunResponse } from "@/test/fixtures/workflow-runs";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { SidebarWorkflowsSection } from "./SidebarWorkflowsSection";

const RUNNING_RUN = makeWorkflowRunResponse({
  id: "wfr_running",
  workflowName: "deep-research",
  status: "running",
});

const COMPLETED_RUN = makeWorkflowRunResponse({
  id: "wfr_completed",
  workflowName: "code-review",
  status: "completed",
  settledAt: 2,
});

interface RenderSectionArgs {
  initialEntry?: string;
  routes?: FetchRoute[];
  runs: readonly WorkflowRunResponse[];
}

function renderSection({ initialEntry = "/", routes = [], runs }: RenderSectionArgs) {
  const fetchMock = installFetchRoutes(routes);
  const harness = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarWorkflowsSection runs={runs} />
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
  return fetchMock;
}

function openRunActionsMenu(workflowName: string) {
  // Radix triggers open on pointerdown, not click.
  fireEvent.pointerDown(
    screen.getByRole("button", {
      name: `Workflow run actions for ${workflowName}`,
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SidebarWorkflowsSection", () => {
  it("links rows to the run page and marks the active run as current", () => {
    renderSection({
      runs: [RUNNING_RUN, COMPLETED_RUN],
      initialEntry: "/workflows/runs/wfr_completed",
    });

    const activeRow = screen.getByRole("link", {
      name: "Open code-review workflow run",
    });
    const inactiveRow = screen.getByRole("link", {
      name: "Open deep-research workflow run",
    });

    expect(activeRow.getAttribute("href")).toBe("/workflows/runs/wfr_completed");
    expect(activeRow.getAttribute("aria-current")).toBe("page");
    expect(inactiveRow.getAttribute("aria-current")).toBeNull();
  });

  it("shows the live working glyph only for active runs", () => {
    renderSection({ runs: [RUNNING_RUN, COMPLETED_RUN] });

    expect(screen.getAllByLabelText("Workflow run working")).toHaveLength(1);
    // The canonical status pill renders for every run.
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("completed")).toBeTruthy();
  });

  it("disables archive and delete for active runs", () => {
    renderSection({ runs: [RUNNING_RUN] });

    openRunActionsMenu("deep-research");

    expect(
      screen
        .getByRole("menuitem", { name: "Archive" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitem", { name: "Delete" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("archives a settled run from the row menu", async () => {
    const archiveRequests: string[] = [];
    renderSection({
      runs: [COMPLETED_RUN],
      routes: [
        {
          method: "POST",
          pathname: "/api/v1/workflow-runs/wfr_completed/archive",
          handler: (request) => {
            archiveRequests.push(new URL(request.url).pathname);
            return jsonResponse({ ok: true });
          },
        },
      ],
    });

    openRunActionsMenu("code-review");
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveRequests).toEqual([
        "/api/v1/workflow-runs/wfr_completed/archive",
      ]);
    });
  });

  it("deletes a settled run only after the destructive confirm", async () => {
    const deleteRequests: string[] = [];
    renderSection({
      runs: [COMPLETED_RUN],
      routes: [
        {
          method: "DELETE",
          pathname: "/api/v1/workflow-runs/wfr_completed",
          handler: (request) => {
            deleteRequests.push(new URL(request.url).pathname);
            return jsonResponse({ ok: true });
          },
        },
      ],
    });

    openRunActionsMenu("code-review");
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    // Selecting Delete only opens the confirmation; nothing fires yet.
    expect(await screen.findByText("Delete workflow run?")).toBeTruthy();
    expect(deleteRequests).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Delete run" }));

    await waitFor(() => {
      expect(deleteRequests).toEqual(["/api/v1/workflow-runs/wfr_completed"]);
    });
    await waitFor(() => {
      expect(screen.queryByText("Delete workflow run?")).toBeNull();
    });
  });
});
