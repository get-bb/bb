import { experimental_PluginRpcRefusal } from "@get-bb/plugin-sdk";
import { liveTaskRpcFixtures } from "../../test-fixtures.js";
// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type {
  Project,
  Task,
  TaskMutationResult,
} from "../../shared/contract.js";
import { makeTask, rpcInput } from "../../test-fixtures.js";

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

const label = {
  id: "01HZZZZZZZZZZZZZZZZZZZZLBL",
  projectId: PROJECT_ID,
  name: "Bug",
  color: "#e5484d",
};

function task(overrides: Partial<Task> & Pick<Task, "id" | "number">): Task {
  return makeTask({
    projectId: PROJECT_ID,
    key: `TSK-${overrides.number}`,
    title: `Task ${overrides.number}`,
    position: overrides.number,
    ...overrides,
  });
}

interface Options {
  projects?: Project[];
  moveTaskToProject?: (
    input: Record<string, unknown>,
  ) => TaskMutationResult | Promise<TaskMutationResult>;
  updateTask?: (
    input: Record<string, unknown>,
  ) => TaskMutationResult | Promise<TaskMutationResult>;
}

function renderList(tasks: Task[], options: Options = {}) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      rpc: liveTaskRpcFixtures({
        listProjects: () => ({ projects: options.projects ?? [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [label] }),
        listTasks: () => ({ tasks }),
        listTaskThreads: () => ({ taskThreads: [] }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
        moveTaskToProject: (raw) => {
          if (!options.moveTaskToProject) throw new Error("Unexpected move");
          return options.moveTaskToProject(rpcInput(raw));
        },
        updateTask: (raw) => {
          const input = rpcInput(raw);
          if (options.updateTask) return options.updateTask(input);
          const index = tasks.findIndex((entry) => entry.id === input.taskId);
          const current = tasks[index]!;
          const { taskId: _taskId, authorName: _authorName, ...patch } = input;
          const updated = { ...current, ...patch };
          tasks[index] = updated;
          return { ok: true, task: updated };
        },
      }),
    },
  );
}

async function rowFor(slot: ReturnType<typeof renderList>, key: string) {
  await slot.findByText(key);
  const row = slot.container.querySelector(`[data-task-key="${key}"]`);
  if (row === null) throw new Error(`row ${key} not found`);
  return row as HTMLElement;
}

describe("inline row editing", () => {
  it("opens a windowed row using its task key", async () => {
    const slot = renderList([task({ id: "01HZT1", number: 1 })]);
    const row = await rowFor(slot, "TSK-1");
    fireEvent.click(
      within(row).getByRole("button", { name: "Open TSK-1: Task 1" }),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/TSK-1" },
    });
  });

  it("moves a windowed row through its project context menu", async () => {
    const current = task({ id: "01HZT1", number: 1 });
    const target = {
      ...project,
      id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
      name: "Personal",
      prefix: "HOME",
    };
    const slot = renderList([current], {
      projects: [project, target],
      moveTaskToProject: () => ({
        ok: true,
        task: { ...current, projectId: target.id, key: "HOME-5", number: 5 },
      }),
    });
    const row = await rowFor(slot, "TSK-1");
    fireEvent.contextMenu(row);
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Move to project" }),
    );
    fireEvent.click(await slot.findByRole("menuitem", { name: /Personal/ }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "moveTaskToProject",
        input: { taskId: current.id, projectId: target.id },
      }),
    );
  });

  it("predicts list status, rolls back a failed write, and keeps other rows unchanged", async () => {
    let reject!: (error: Error) => void;
    const write = new Promise<TaskMutationResult>((_resolve, fail) => {
      reject = fail;
    });
    const slot = renderList(
      [
        task({ id: "01HZZZZZZZZZZZZZZZZZZZT1", number: 1 }),
        task({ id: "01HZZZZZZZZZZZZZZZZZZZT2", number: 2 }),
      ],
      { updateTask: () => write },
    );
    const row = await rowFor(slot, "TSK-1");
    fireEvent.click(
      within(row).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    );
    const drawer = await slot.findByRole("dialog", { name: "Change status" });
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: /Done/ }),
    );
    const editedRow = () =>
      slot.container.querySelector<HTMLElement>('[data-task-key="TSK-1"]')!;
    await waitFor(() =>
      expect(
        within(editedRow()).getByRole("button", {
          name: /Change status, currently Done/,
        }),
      ).toBeTruthy(),
    );
    expect(
      slot.getByRole("region", { name: "Tasks" }).getAttribute("aria-busy"),
    ).toBe("true");
    expect(editedRow().getAttribute("aria-busy")).toBe("true");
    expect(editedRow().classList.contains("opacity-70")).toBe(true);
    const otherRow = await rowFor(slot, "TSK-2");
    expect(otherRow.hasAttribute("aria-busy")).toBe(false);
    expect(otherRow.classList.contains("opacity-70")).toBe(false);
    expect(
      within(await rowFor(slot, "TSK-2")).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    ).toBeTruthy();
    await act(async () =>
      reject(
        new experimental_PluginRpcRefusal({
          code: "invalid",
          message: "Write rejected",
        }),
      ),
    );
    await slot.findByText("Write rejected");
    expect(editedRow().hasAttribute("aria-busy")).toBe(false);
    expect(editedRow().classList.contains("opacity-70")).toBe(false);
    expect(
      slot.getByRole("region", { name: "Tasks" }).hasAttribute("aria-busy"),
    ).toBe(false);
    expect(
      within(editedRow()).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    ).toBeTruthy();
  });

  it("optimistically applies a priority change", async () => {
    const slot = renderList([task({ id: "01HZT1", number: 1 })]);
    const row = await rowFor(slot, "TSK-1");

    fireEvent.click(
      within(row).getByRole("button", {
        name: /Set priority, currently No priority/,
      }),
    );
    const drawer = await slot.findByRole("dialog", { name: "Set priority" });
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: /Urgent/ }),
    );

    await waitFor(() =>
      expect(
        slot.rpcCalls.some(
          (call) =>
            call.method === "updateTask" &&
            (call.input as { priority?: string }).priority === "urgent",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(
          slot.container.querySelector<HTMLElement>('[data-task-key="TSK-1"]')!,
        ).getByRole("button", { name: /currently Urgent/ }),
      ).toBeTruthy(),
    );
  });

  it("rolls back and surfaces an error when the mutation fails", async () => {
    const slot = renderList([task({ id: "01HZT1", number: 1 })], {
      updateTask: () => {
        throw Object.assign(new Error("Server rejected it"), {
          code: "invalid",
        });
      },
    });
    const row = await rowFor(slot, "TSK-1");

    fireEvent.click(
      within(row).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    );
    const drawer = await slot.findByRole("dialog", { name: "Change status" });
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: /Done/ }),
    );

    await slot.findByText("Server rejected it");
    await waitFor(() =>
      expect(
        within(
          slot.container.querySelector<HTMLElement>('[data-task-key="TSK-1"]')!,
        ).getByRole("button", { name: /Change status, currently Todo/ }),
      ).toBeTruthy(),
    );
  });

  it("only issues a mutation when the value actually changes", async () => {
    const slot = renderList([
      task({ id: "01HZT1", number: 1, status: "todo" }),
    ]);
    const row = await rowFor(slot, "TSK-1");

    fireEvent.click(
      within(row).getByRole("button", {
        name: /Change status, currently Todo/,
      }),
    );
    const drawer = await slot.findByRole("dialog", { name: "Change status" });
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: /Todo/ }),
    );

    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
    expect(slot.rpcCalls.some((call) => call.method === "updateTask")).toBe(
      false,
    );
  });
});
