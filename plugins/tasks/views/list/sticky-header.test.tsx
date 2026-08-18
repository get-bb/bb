// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { Task } from "../../shared/contract.js";

// jsdom lacks matchMedia/ResizeObserver; mirror other list render tests so
// the compact filter chrome stays out of the way of the assertions.
window.matchMedia = (query: string) => ({
  matches: query === COMPACT_VIEWPORT_QUERY,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
window.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

const app = await loadPluginApp(() => import("../../app"));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const project = {
  id: PROJECT_ID,
  name: "Tasks Plugin",
  prefix: "TSK",
  nextTaskNumber: 5,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  createdAt: "2026-07-15T00:00:00.000Z",
};

function task(number: number, status: Task["status"]): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status,
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: number,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
  };
}

// Two status groups so stacked sticky headers are present in the DOM.
const tasks = [
  task(1, "todo"),
  task(2, "todo"),
  task(3, "done"),
  task(4, "done"),
];

function renderList() {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      rpc: {
        listProjects: () => ({ projects: [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [] }),
        listTasks: () => ({ tasks }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
      },
    },
  );
}

describe("status-group sticky headers", () => {
  it("pins each group with an opaque theme canvas fill above row chrome", async () => {
    const slot = renderList();
    await slot.findByText("TSK-1");

    const headers = Array.from(
      slot.container.querySelectorAll<HTMLElement>(
        "[data-status-group-header]",
      ),
    );
    expect(headers.map((header) => header.dataset.statusGroupHeader)).toEqual([
      "todo",
      "done",
    ]);

    for (const header of headers) {
      // Sticky positioning and an opaque host-theme canvas token so rows that
      // scroll under the bar never paint through. z-20 isolates the bar above
      // the row's z-10 status/priority editors (see TaskRow / property-menus).
      expect(header.className).toMatch(/\bsticky\b/);
      expect(header.className).toMatch(/\btop-0\b/);
      expect(header.className).toMatch(/\bbg-background\b/);
      expect(header.className).toMatch(/\bz-20\b/);
      expect(header.className).toMatch(/\bisolate\b/);
      // Edge separates the pin band from scrolling rows (theme hairline).
      expect(header.className).toMatch(/\bborder-b\b/);
      expect(header.className).toMatch(/\bborder-border-hairline\b/);
      // Guard against reintroducing translucent chrome tokens.
      expect(header.className).not.toMatch(/bg-surface-scrim|bg-background\//);
    }

    // Count + label remain visible for each group.
    expect(slot.getByText("Todo")).toBeTruthy();
    expect(slot.getByText("Done")).toBeTruthy();
    expect(
      headers.map(
        (header) => header.querySelector(".tabular-nums")?.textContent,
      ),
    ).toEqual(["2", "2"]);

    // Row interactive chrome stays at z-10 so the sticky bar's z-20 wins.
    const priorityOrStatus = slot.container.querySelector(
      '[data-task-key="TSK-1"] [class*="z-10"]',
    );
    expect(priorityOrStatus?.className).toMatch(/\bz-10\b/);
  });
});
