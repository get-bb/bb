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
const { describePresetEnvironment, savePresetDraft } = await import(
  "./preset-dialog.js"
);

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

const MACHINES = [{ id: "mach_1", name: "Sawyer Air" }];

function presetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZE1",
    name: "FB3 BE live worktree",
    providerId: "claude-code",
    modelId: "claude-sonnet-5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    environmentKind: "new-worktree",
    baseBranch: "main",
    machineId: "mach_1",
    instructions: "",
    builtin: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("describePresetEnvironment", () => {
  it("summarizes worktree presets and falls back to defaults and raw ids", () => {
    expect(describePresetEnvironment(presetRow() as never, MACHINES)).toBe(
      "Worktree · main · Sawyer Air",
    );
    expect(
      describePresetEnvironment(
        presetRow({ baseBranch: null, machineId: null }) as never,
        MACHINES,
      ),
    ).toBe("Worktree · default · default");
    // A machine deleted after the preset was created still identifies itself.
    expect(
      describePresetEnvironment(
        presetRow({ machineId: "mach_gone" }) as never,
        MACHINES,
      ),
    ).toBe("Worktree · main · mach_gone");
    expect(
      describePresetEnvironment(
        presetRow({ environmentKind: "project-default" }) as never,
        MACHINES,
      ),
    ).toBe("Project default");
  });
});

describe("savePresetDraft", () => {
  const draft = {
    name: "FB3",
    providerId: "claude-code",
    modelId: "claude-sonnet-5",
    reasoningLevel: "medium",
    permissionMode: "workspace-write",
    environmentKind: "new-worktree",
    baseBranch: " main ",
    machineId: "mach_1",
    instructions: "",
  } as const;

  function captureRpc() {
    const calls: Array<{ method: string; input: unknown }> = [];
    const rpc = {
      call: (method: string, input: unknown) => {
        calls.push({ method, input });
        return Promise.resolve({});
      },
    };
    return { calls, rpc: rpc as never };
  }

  it("sends trimmed worktree targets on create", async () => {
    const { calls, rpc } = captureRpc();
    await savePresetDraft(rpc, null, draft);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("createPreset");
    expect(calls[0]!.input).toMatchObject({
      environmentKind: "new-worktree",
      baseBranch: "main",
      machineId: "mach_1",
    });
  });

  it("nulls stale targets when the kind is project-default", async () => {
    const { calls, rpc } = captureRpc();
    // Stale branch/machine left in the draft must never reach the contract,
    // which rejects them for project-default presets.
    await savePresetDraft(rpc, presetRow() as never, {
      ...draft,
      environmentKind: "project-default",
    });
    expect(calls[0]!.method).toBe("updatePreset");
    expect(calls[0]!.input).toMatchObject({
      presetId: presetRow().id,
      environmentKind: "project-default",
      baseBranch: null,
      machineId: null,
    });
  });

  it("maps empty worktree targets to nulls (defaults)", async () => {
    const { calls, rpc } = captureRpc();
    await savePresetDraft(rpc, null, { ...draft, baseBranch: "", machineId: "" });
    expect(calls[0]!.input).toMatchObject({
      environmentKind: "new-worktree",
      baseBranch: null,
      machineId: null,
    });
  });
});

describe("PresetDialog environment section", () => {
  function renderManagePresets(presets: unknown[]) {
    return renderSlot(
      app.navPanels[0]!,
      { subPath: "manage" },
      {
        rpc: {
          listProjects: () => ({ projects: [project] }),
          listFolders: () => ({ folders: [] }),
          listPresets: () => ({ presets }),
          sidebarSummary: () => ({ projects: [] }),
          listTasks: () => ({ tasks: [] }),
          listLabels: () => ({ labels: [] }),
          listProviders: () => ({
            providers: [{ id: "claude-code", name: "Claude Code" }],
          }),
          listProviderModels: () => ({
            models: [
              { id: "claude-sonnet-5", name: "Sonnet", isDefault: true },
            ],
            reasoningLevels: ["low", "medium", "high"],
          }),
          listMachines: () => ({ machines: MACHINES }),
        },
      },
    );
  }

  it("shows the environment column and hydrates a worktree preset", async () => {
    const slot = renderManagePresets([presetRow()]);
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Presets" }));
    // Manage table resolves the machine name via listMachines.
    await slot.findByText("Worktree · main · Sawyer Air");
    fireEvent.click(
      slot.getByRole("button", { name: "Edit preset FB3 BE live worktree" }),
    );
    const branch = (await slot.findByLabelText(
      "Base branch",
    )) as HTMLInputElement;
    expect(branch.value).toBe("main");
    expect(branch.placeholder).toBe("project default base — leave empty");
    expect(slot.getByLabelText("Machine")).toBeDefined();
  });

  it("hides worktree fields for project-default presets", async () => {
    const slot = renderManagePresets([
      presetRow({
        name: "Default env",
        environmentKind: "project-default",
        baseBranch: null,
        machineId: null,
      }),
    ]);
    fireEvent.mouseDown(await slot.findByRole("tab", { name: "Presets" }));
    await slot.findByText("Project default");
    fireEvent.click(
      slot.getByRole("button", { name: "Edit preset Default env" }),
    );
    await slot.findByLabelText("Execution environment");
    expect(slot.queryByLabelText("Base branch")).toBeNull();
    expect(slot.queryByLabelText("Machine")).toBeNull();
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
