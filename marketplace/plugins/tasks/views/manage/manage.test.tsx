// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@bb/plugin-sdk/testing/app";
import type { Task } from "../../shared/contract.js";

// jsdom lacks matchMedia; the vendored Dialog's responsive root needs it.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// loadPluginApp installs the fake SDK runtime; nothing SDK-touching may be
// imported before it runs.
const app = await loadPluginApp(() => import("../../app"));
const { derivePrefix } = await import("./shared.js");

afterEach(cleanup);

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";
const TASK_ID = "01HZZZZZZZZZZZZZZZZZZZZZT1";

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

function createdTask(input: Record<string, unknown>): Task {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    number: 5,
    key: "TSK-5",
    title: String(input.title),
    description: String(input.description ?? ""),
    status: (input.status as Task["status"]) ?? "backlog",
    priority: (input.priority as Task["priority"]) ?? "none",
    dueDate: (input.dueDate as string | null) ?? null,
    parentTaskId: (input.parentTaskId as string | null) ?? null,
    position: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: (input.labelIds as string[]) ?? [],
  };
}

describe("derivePrefix", () => {
  it("suggests initials for multi-word names and letters otherwise", () => {
    expect(derivePrefix("Tasks Plugin")).toBe("TP");
    expect(derivePrefix("Connect")).toBe("CON");
    expect(derivePrefix("home-lab v2")).toBe("HLV");
    // Prefixes must start with a letter and stay within 10 chars.
    expect(derivePrefix("2fa Rollout")).toBe("R");
    expect(derivePrefix("123")).toBe("");
    expect(derivePrefix("a b c d e f g h i j k l")).toHaveLength(10);
  });
});

describe("NewTaskDialog", () => {
  it("creates a task in the route's project with column defaults and navigates to it", async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          createTask: (input: Record<string, unknown>) => {
            createCalls.push(input);
            return { ok: true, task: createdTask(input) };
          },
        },
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    const title = await slot.findByLabelText("Task title");
    fireEvent.change(title, { target: { value: "  Ship the dialog  " } });
    fireEvent.click(slot.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({
      projectId: PROJECT_ID,
      title: "Ship the dialog",
      status: "todo",
      priority: "none",
      dueDate: null,
      parentTaskId: null,
      labelIds: [],
    });
    await waitFor(() =>
      expect(slot.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "tasks",
        options: { subPath: "task/TSK-5" },
      }),
    );
  });

  it("keeps the dialog open and clears the draft when Create more is on", async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          createTask: (input: Record<string, unknown>) => {
            createCalls.push(input);
            return { ok: true, task: createdTask(input) };
          },
        },
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    fireEvent.click(await slot.findByRole("checkbox", { name: "Create more" }));
    const title = await slot.findByLabelText("Task title");
    fireEvent.change(title, { target: { value: "First" } });
    fireEvent.click(slot.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(createCalls).toHaveLength(1));
    // Still open, title cleared, no navigation away.
    expect((slot.getByLabelText("Task title") as HTMLInputElement).value).toBe(
      "",
    );
    expect(slot.navigateCalls).toEqual([]);
  });

  it("surfaces domain errors returned by createTask", async () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: PROJECT_ID },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          createTask: () => ({
            ok: false,
            error: {
              code: "subtask_depth_exceeded",
              message: "Sub-tasks cannot have their own sub-tasks",
            },
          }),
        },
      },
    );
    fireEvent.click(await slot.findByRole("button", { name: /New task/ }));
    fireEvent.change(await slot.findByLabelText("Task title"), {
      target: { value: "Nested" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Create task" }));
    await slot.findByText("Sub-tasks cannot have their own sub-tasks");
    // Dialog stays open for correction.
    expect(slot.getByLabelText("Task title")).toBeDefined();
  });
});

describe("NewProjectDialog", () => {
  function renderEmptyState(overrides: Record<string, unknown> = {}) {
    return renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listProjects: () => ({ projects: [] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets: [] }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          ...overrides,
        },
      },
    );
  }

  it("derives the prefix from the name and creates the project", async () => {
    const createCalls: Array<Record<string, unknown>> = [];
    const slot = renderEmptyState({
      createProject: (input: Record<string, unknown>) => {
        createCalls.push(input);
        return { project: { ...project, ...input, id: PROJECT_ID } };
      },
    });
    fireEvent.click(await slot.findByRole("button", { name: /New project/ }));
    fireEvent.change(await slot.findByPlaceholderText("e.g. Tasks Plugin"), {
      target: { value: "Home Lab" },
    });
    expect((slot.getByPlaceholderText("TSK") as HTMLInputElement).value).toBe(
      "HL",
    );
    fireEvent.click(slot.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(createCalls).toHaveLength(1));
    expect(createCalls[0]).toMatchObject({
      name: "Home Lab",
      prefix: "HL",
      folderId: null,
      linkedBbProjectId: null,
    });
    await waitFor(() =>
      expect(slot.navigateCalls).toContainEqual({
        method: "toPluginPanel",
        path: "tasks",
        options: { subPath: PROJECT_ID },
      }),
    );
  });

  it("flags malformed prefixes and bb project ids before submit", async () => {
    const slot = renderEmptyState();
    fireEvent.click(await slot.findByRole("button", { name: /New project/ }));
    const prefix = slot.getByPlaceholderText("TSK");
    fireEvent.change(prefix, { target: { value: "9x" } });
    // Input is uppercased; leading digit violates the prefix rule.
    expect((prefix as HTMLInputElement).value).toBe("9X");
    await slot.findByText(
      "Use 1–10 uppercase letters and digits, starting with a letter.",
    );
    fireEvent.change(slot.getByPlaceholderText("proj_…"), {
      target: { value: "thread_123" },
    });
    await slot.findByText("bb project ids start with proj_.");
    // Create stays disabled while invalid.
    expect(
      (
        slot.getByRole("button", {
          name: "Create project",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
