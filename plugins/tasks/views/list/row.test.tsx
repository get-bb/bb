// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type {
  Project,
  Task,
  TaskMutationResult,
  TaskThread,
} from "../../shared/contract.js";
import {
  makeSidebarThread,
  makeTask,
  makeTaskThread,
  rpcInput,
  labelsByProject,
  matchingTasks,
} from "../../test-fixtures.js";

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
  timings?: { taskId: string; start: number; working: boolean }[];
  taskThreads?: Record<string, TaskThread[]>;
  sidebarThreads?: ReturnType<typeof makeSidebarThread>[];
  moveTaskToProject?: (input: Record<string, unknown>) => TaskMutationResult;
  updateTask?: (input: Record<string, unknown>) => TaskMutationResult;
}

function renderList(tasks: Task[], options: Options = {}) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: PROJECT_ID },
    {
      rpc: {
        listProjects: () => ({ projects: options.projects ?? [project] }),
        listFolders: () => ({ folders: [] }),
        listPresets: () => ({ presets: [] }),
        sidebarSummary: () => ({ projects: [] }),
        listLabels: () => ({ labels: [label] }),
        labelsByProject: labelsByProject([label]),
        listAllTasks: (raw: unknown) => ({ tasks: matchingTasks(tasks, raw) }),
        listTaskCardMeta: () => ({ cards: [] }),
        listTaskTiming: () => ({ timings: options.timings ?? [] }),
        listTaskThreads: (raw: unknown) => ({
          taskThreads:
            options.taskThreads?.[String(rpcInput(raw).taskId)] ?? [],
        }),
        listComments: () => ({ comments: [] }),
        listAttachments: () => ({ attachments: [] }),
        moveTaskToProject: (raw) => {
          if (!options.moveTaskToProject) throw new Error("Unexpected move");
          return options.moveTaskToProject(rpcInput(raw));
        },
        updateTask: (raw) => {
          const input = rpcInput(raw);
          if (options.updateTask) return options.updateTask(input);
          const current = tasks.find((entry) => entry.id === input.taskId)!;
          return { ok: true, task: { ...current, ...input } };
        },
      },
      sidebarThreads: { threads: options.sidebarThreads ?? [] },
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
  it("shows elapsed time inside the active chip only while working", async () => {
    const item = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const slot = renderList([item], {
      timings: [{ taskId: item.id, start: Date.now() - 60_000, working: true }],
    });
    const row = await rowFor(slot, item.key);
    const elapsed = within(row).getByText(/^1m \d+s$/);
    expect(elapsed.parentElement?.textContent).toMatch(/^Active1m \d+s$/);
    expect(elapsed.parentElement?.className).toContain("rounded-md");
    expect(elapsed.parentElement?.hasAttribute("title")).toBe(false);
    cleanup();
    const idle = renderList([item], {
      timings: [
        { taskId: item.id, start: Date.now() - 60_000, working: false },
      ],
    });
    expect(
      within(await rowFor(idle, item.key)).queryByText(/^1m \d+s$/),
    ).toBeNull();
  });

  it("nests sub-tasks and remembers a collapsed parent", async () => {
    const parent = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
      status: "done",
    });
    const slot = renderList([parent, child]);
    const row = await rowFor(slot, parent.key);
    const expanded = await rowFor(slot, child.key);
    expect(expanded.closest('[aria-hidden="true"]')).toBeNull();
    expect(within(row).getByText("1/1")).toBeTruthy();
    fireEvent.click(
      within(row).getByRole("button", { name: /Collapse sub-tasks/ }),
    );
    const collapsed = slot.container.querySelector(
      `[data-task-key="${child.key}"]`,
    );
    expect(collapsed).not.toBeNull();
    expect(collapsed?.closest('[aria-hidden="true"][inert]')).toBeTruthy();
    cleanup();
    const reopened = renderList([parent, child]);
    const parentRow = await rowFor(reopened, parent.key);
    const persisted = reopened.container.querySelector(
      `[data-task-key="${child.key}"]`,
    );
    expect(persisted?.closest('[aria-hidden="true"][inert]')).toBeTruthy();
    fireEvent.click(
      within(parentRow).getByRole("button", { name: /Expand sub-tasks/ }),
    );
    const reexpanded = await rowFor(reopened, child.key);
    expect(reexpanded.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("shows matching children during search without changing saved collapse", async () => {
    const parent = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
      title: "Palette",
    });
    const slot = renderList([parent, child]);
    const row = await rowFor(slot, parent.key);
    fireEvent.click(
      within(row).getByRole("button", { name: /Collapse sub-tasks/ }),
    );
    const saved = localStorage.getItem("bb-tasks:collapsed-subtasks");
    fireEvent.change(slot.getByPlaceholderText("Search"), {
      target: { value: "palette" },
    });
    await waitFor(() =>
      expect(
        slot.container
          .querySelector(`[data-task-key="${child.key}"]`)
          ?.closest('[aria-hidden="true"]'),
      ).toBeNull(),
    );
    const forcedOpen = within(await rowFor(slot, parent.key)).getByRole(
      "button",
      { name: /Collapse sub-tasks/ },
    ) as HTMLButtonElement;
    expect(forcedOpen.disabled).toBe(true);
    fireEvent.click(forcedOpen);
    expect(localStorage.getItem("bb-tasks:collapsed-subtasks")).toBe(saved);
    fireEvent.change(slot.getByPlaceholderText("Search"), {
      target: { value: "" },
    });
    await waitFor(() =>
      expect(
        slot.container
          .querySelector(`[data-task-key="${child.key}"]`)
          ?.closest('[aria-hidden="true"][inert]'),
      ).toBeTruthy(),
    );
  });

  it("keeps status before the sub-task toggle in both states", async () => {
    const parent = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
    });
    const slot = renderList([parent, child], {
      timings: [
        { taskId: parent.id, start: Date.now() - 60_000, working: true },
      ],
    });
    const row = await rowFor(slot, parent.key);
    for (const state of ["Collapse", "Expand"]) {
      const toggle = within(row).getByRole("button", {
        name: new RegExp(`${state} sub-tasks`),
      });
      const active = within(row).getByText(/^Active/);
      expect(
        active.compareDocumentPosition(toggle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      fireEvent.click(toggle);
    }
  });

  it("opens a windowed row using its task key", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 }),
    ]);
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
    const current = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
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

  it("optimistically applies a status change and persists it", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 }),
    ]);
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

    await waitFor(() =>
      expect(
        slot.rpcCalls.some(
          (call) =>
            call.method === "updateTask" &&
            (call.input as { status?: string }).status === "done",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        within(
          slot.container.querySelector('[data-task-key="TSK-1"]')!,
        ).getByRole("button", { name: /Change status, currently Done/ }),
      ).toBeTruthy(),
    );
  });

  it("optimistically applies a priority change", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 }),
    ]);
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
          slot.container.querySelector('[data-task-key="TSK-1"]')!,
        ).getByRole("button", { name: /currently Urgent/ }),
      ).toBeTruthy(),
    );
  });

  it("rolls back and surfaces an error when the mutation fails", async () => {
    const slot = renderList(
      [task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 })],
      {
        updateTask: () => ({
          ok: false,
          error: { code: "task_parent_invalid", message: "Server rejected it" },
        }),
      },
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

    await slot.findByText("Server rejected it");
    await waitFor(() =>
      expect(
        within(
          slot.container.querySelector('[data-task-key="TSK-1"]')!,
        ).getByRole("button", { name: /Change status, currently Todo/ }),
      ).toBeTruthy(),
    );
  });

  it("only issues a mutation when the value actually changes", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1, status: "todo" }),
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

describe("needs you label", () => {
  it("shows Needs you instead of the timer while a thread waits, and restores the timer once answered", async () => {
    const item = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const render = (pending: boolean) =>
      renderList([item], {
        timings: [
          { taskId: item.id, start: Date.now() - 60_000, working: true },
        ],
        taskThreads: { [item.id]: [makeTaskThread("thr_wait", item.id)] },
        sidebarThreads: [
          makeSidebarThread("thr_wait", { hasPendingInteraction: pending }),
        ],
      });
    const slot = render(true);
    const row = await rowFor(slot, item.key);
    expect(await within(row).findByText("Needs you")).toBeTruthy();
    expect(within(row).queryByText(/^1m \d+s$/)).toBeNull();
    fireEvent.click(
      within(row).getByRole("button", {
        name: /Open the thread waiting on you/,
      }),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_wait",
    });
    cleanup();
    const answered = render(false);
    const answeredRow = await rowFor(answered, item.key);
    expect(within(answeredRow).queryByText("Needs you")).toBeNull();
    expect(within(answeredRow).getByText(/^1m \d+s$/)).toBeTruthy();
  });

  it("skips the listTaskThreads fetch when nothing is pending, and fetches it when one thread waits", async () => {
    const item = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const render = (pending: boolean) =>
      renderList([item], {
        taskThreads: { [item.id]: [makeTaskThread("thr_wait", item.id)] },
        sidebarThreads: [
          makeSidebarThread("thr_wait", { hasPendingInteraction: pending }),
        ],
      });
    const idle = render(false);
    await rowFor(idle, item.key);
    await waitFor(() =>
      expect(idle.rpcCalls.some((call) => call.method === "listAllTasks")).toBe(
        true,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      idle.rpcCalls.some((call) => call.method === "listTaskThreads"),
    ).toBe(false);
    cleanup();
    const waiting = render(true);
    const row = await rowFor(waiting, item.key);
    expect(await within(row).findByText("Needs you")).toBeTruthy();
    expect(
      waiting.rpcCalls.some((call) => call.method === "listTaskThreads"),
    ).toBe(true);
  });

  it("rolls a pending sub-task up to its collapsed parent", async () => {
    const parent = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
    });
    const slot = renderList([parent, child], {
      taskThreads: {
        [child.id]: [makeTaskThread("thr_child", child.id)],
      },
      sidebarThreads: [
        makeSidebarThread("thr_child", { hasPendingInteraction: true }),
      ],
    });
    const row = await rowFor(slot, parent.key);
    expect(within(row).queryByText("Needs you")).toBeNull();
    fireEvent.click(
      within(row).getByRole("button", { name: /Collapse sub-tasks/ }),
    );
    const needsYou = await within(row).findByText("Needs you");
    const toggle = within(row).getByRole("button", {
      name: /Expand sub-tasks/,
    });
    expect(
      needsYou.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps a pending sub-task's label on its own row while the parent is expanded", async () => {
    const parent = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
    });
    const slot = renderList([parent, child], {
      taskThreads: { [child.id]: [makeTaskThread("thr_child", child.id)] },
      sidebarThreads: [
        makeSidebarThread("thr_child", { hasPendingInteraction: true }),
      ],
    });
    const parentRow = await rowFor(slot, parent.key);
    const childRow = await rowFor(slot, child.key);
    expect(await within(childRow).findByText("Needs you")).toBeTruthy();
    expect(within(parentRow).queryByText("Needs you")).toBeNull();
  });

  it("opens the oldest waiting thread when several are pending", async () => {
    const item = task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 });
    const slot = renderList([item], {
      taskThreads: {
        [item.id]: [
          makeTaskThread("thr_newer", item.id),
          makeTaskThread("thr_older", item.id),
        ],
      },
      sidebarThreads: [
        makeSidebarThread("thr_newer", {
          hasPendingInteraction: true,
          latestAttentionAt: 3000,
        }),
        makeSidebarThread("thr_older", {
          hasPendingInteraction: true,
          latestAttentionAt: 1000,
        }),
      ],
    });
    const row = await rowFor(slot, item.key);
    fireEvent.click(
      await within(row).findByRole("button", {
        name: /Open the thread waiting on you/,
      }),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_older",
    });
  });
});

describe("list search and key column", () => {
  it("keeps the task count visible while the filter strip scrolls", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1 }),
    ]);
    const priority = await slot.findByRole("button", { name: "Priority" });
    const count = await slot.findByText("1 task");
    expect(priority.className).toContain("shrink-0");
    expect(priority.parentElement?.className).toContain("flex-1");
    expect(priority.parentElement?.className).toContain("min-w-0");
    expect(priority.parentElement?.className).toContain("overflow-x-auto");
    expect(count.className).toContain("shrink-0");
  });

  it("filters rows by key or title from the search box", async () => {
    const slot = renderList([
      task({ id: "01HZT1ZZZZZZZZZZZZZZZZZZT1", number: 1, title: "Fix login" }),
      task({ id: "01HZT2ZZZZZZZZZZZZZZZZZZT2", number: 2, title: "Ship docs" }),
    ]);
    await rowFor(slot, "TSK-1");
    const search = slot.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "LOGIN" } });
    await waitFor(() => expect(slot.queryByText("TSK-2")).toBeNull());
    expect(slot.getByText("TSK-1")).toBeTruthy();
    fireEvent.change(search, { target: { value: "tsk-2" } });
    await waitFor(() => expect(slot.queryByText("TSK-1")).toBeNull());
    fireEvent.keyDown(search, { key: "Escape" });
    await slot.findByText("TSK-1");
    expect(slot.getByText("TSK-2")).toBeTruthy();
  });

  it("dims a context parent but not its matching child", async () => {
    const parent = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT1",
      number: 1,
      title: "Parent",
    });
    const child = task({
      id: "01HZT1ZZZZZZZZZZZZZZZZZZT2",
      number: 2,
      parentTaskId: parent.id,
      title: "Needle",
    });
    const slot = renderList([parent, child]);
    await rowFor(slot, parent.key);
    fireEvent.change(slot.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "Needle" },
    });
    await waitFor(() =>
      expect(
        slot.container.querySelector(`[data-task-key="${parent.key}"]`)
          ?.className,
      ).toContain("opacity-50"),
    );
  });

  it("sizes the key column from the widest key per prefix across all loaded tasks", async () => {
    const slot = renderList([
      task({
        id: "01HZT1ZZZZZZZZZZZZZZZZZZT1",
        number: 223,
        key: "AGENTS-223",
      }),
      task({ id: "01HZT2ZZZZZZZZZZZZZZZZZZT2", number: 9, key: "AGENTS-9" }),
      task({ id: "01HZT3ZZZZZZZZZZZZZZZZZZT3", number: 1, key: "OPS-1" }),
    ]);
    const sizedKeys = () =>
      Array.from(
        slot.container.querySelectorAll<HTMLElement>("[data-key-sizer]"),
        (element) => element.dataset.keySizer,
      ).sort();
    const keyCell = await slot.findByText("AGENTS-223");
    expect(keyCell.title).toBe("AGENTS-223");
    expect(sizedKeys()).toEqual(["AGENTS-223", "OPS-1"]);

    const search = slot.getByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(search, { target: { value: "ops" } });
    await waitFor(() => expect(slot.queryByText("AGENTS-223")).toBeNull());
    expect(sizedKeys()).toEqual(["AGENTS-223", "OPS-1"]);
  });
});
