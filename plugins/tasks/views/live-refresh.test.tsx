// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { experimental_PluginRpcRefusal } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import { createStore, registerHandlers, registerTasksApi } from "../api";
import { tasksRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));
const disposals: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

function setup() {
  const { bb, harness } = createFakePluginHost({ pluginId: "tasks" });
  disposals.push(() => harness.dispose());
  const store = createStore(bb);
  registerTasksApi(bb, store);
  const handlers = registerHandlers(bb, store);
  const project = store.tasks.createProject({
    name: "Parity",
    prefix: "PAR",
    color: "blue",
  });
  const failures = new Map<string, string>();
  const rpc = Object.fromEntries(
    Object.entries(handlers).map(([method, handler]) => [
      method,
      async (input: unknown, context: Parameters<typeof handler>[1]) => {
        const failure = failures.get(method);
        if (failure) throw new Error(failure);
        return handler(input as never, context);
      },
    ]),
  );
  const options: RenderSlotOptions = {
    pluginId: "tasks",
    experimental_rpcContract: tasksRpcContract,
    rpc,
  };
  let pending = Promise.resolve();
  function connect(slot: ReturnType<typeof renderSlot>) {
    disposals.push(
      harness.experimental_onRpcInvalidation(() => {
        const tags = harness.experimental_rpcInvalidations.at(-1) ?? null;
        pending = pending.then(() => slot.experimental_invalidateRpc(tags));
      }),
    );
    return slot;
  }
  async function create(title: string, status: "todo" | "done" = "todo") {
    const result = tasksRpcContract.createTask.output.parse(
      await harness.callRpc("createTask", {
        projectId: project.id,
        title,
        status,
      }),
    );

    return result.task;
  }
  async function write(method: string, input: unknown) {
    const result = await harness.callRpc(method, input);
    await pending;
    return result;
  }
  return { store, harness, project, failures, options, connect, create, write };
}

it.each([
  "getTasksKeyed",
  "listLabels",
  "getTaskThreadsKeyed",
  "getTaskAttachmentsKeyed",
])("keeps partial cards and retries a failed %s read", async (method) => {
  const server = setup();
  for (let index = 0; index < 26; index++) await server.create(`Card ${index}`);
  server.failures.set(method, "Read unavailable");
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `${server.project.id}?view=board` },
      server.options,
    ),
  );
  await slot.findByText("Card 0");
  const alert = await slot.findByRole("alert");
  expect(alert.textContent).toContain("Read unavailable");
  expect(
    slot.container.querySelectorAll("[data-task-key]").length,
  ).toBeGreaterThanOrEqual(25);
  server.failures.delete(method);
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => {
    expect(slot.container.querySelectorAll("[data-task-key]")).toHaveLength(26);
    expect(slot.queryByRole("alert")).toBeNull();
  });
});

it("shows a changed card after another client writes and recovers missing rows on invalidation", async () => {
  const server = setup();
  const first = await server.create("First card");
  for (let index = 0; index < 25; index++)
    await server.create(`Other ${index}`);
  server.failures.set("getTasksKeyed", "Rows unavailable");
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `${server.project.id}?view=board` },
      server.options,
    ),
  );
  await slot.findByRole("alert");
  server.failures.delete("getTasksKeyed");
  await act(async () => {
    await server.write("updateTask", {
      taskId: first.id,
      title: "Changed by another client",
    });
  });
  await slot.findByText("Changed by another client");
  await waitFor(() =>
    expect(slot.container.querySelectorAll("[data-task-key]")).toHaveLength(26),
  );
  expect(slot.queryByRole("alert")).toBeNull();
});

it("keeps an embed and offers Retry after a failed refresh", async () => {
  const server = setup();
  const task = await server.create("Embedded");
  const slot = server.connect(
    renderSlot(
      app.messageDirectives[0]!,
      {
        attributes: { key: task.key },
        source: `::task{key="${task.key}"}`,
        message: {
          id: "msg_1",
          threadId: "thr_1",
          turnId: "turn_1",
          projectId: null,
        },
        openWorkspaceFile: null,
      },
      server.options,
    ),
  );
  await slot.findByText("Embedded");
  server.failures.set("getTaskByKey", "Lookup unavailable");
  await act(async () => {
    await server.write("updateTask", {
      taskId: task.id,
      title: "New embedded title",
    });
  });
  const retry = await slot.findByRole("button", { name: /Retry/ });
  expect(slot.getByText("Embedded")).toBeTruthy();
  server.failures.clear();
  fireEvent.click(retry);
  await slot.findByText("New embedded title");
});

it("keeps the detail title draft when its project prefix changes", async () => {
  const server = setup();
  const task = await server.create("Draft survives");
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `task/${task.key}` },
      server.options,
    ),
  );
  const title = await slot.findByRole("textbox", { name: "Task title" });
  title.textContent = "Unsaved local title";
  await act(async () => {
    await server.write("renameProjectPrefix", {
      projectId: server.project.id,
      prefix: "NEW",
    });
  });
  await act(async () => {
    await server.write("updateTask", { taskId: task.id, priority: "urgent" });
  });
  await slot.findAllByText("Urgent");
  expect(slot.getByRole("textbox", { name: "Task title" })).toBe(title);
  expect(title.textContent).toBe("Unsaved local title");
});

it("refreshes the activity after title and description edits from another client", async () => {
  const server = setup();
  const task = await server.create("Activity");
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `task/${task.key}` },
      server.options,
    ),
  );
  await slot.findByRole("textbox", { name: "Task title" });
  for (const input of [
    { title: "Renamed activity" },
    { description: "New context" },
  ]) {
    const body = JSON.stringify(input);
    server.store.tasks.createComment({
      taskId: task.id,
      kind: "system",
      authorName: "System",
      presetName: null,
      threadId: null,
      body,
    });
    await act(async () => {
      await server.write("updateTask", { taskId: task.id, ...input });
    });
    await slot.findByText(body);
  }
});

it("keeps the activity snapshot with Retry when its refresh fails", async () => {
  const server = setup();
  const task = await server.create("Activity failure");
  await server.write("createComment", {
    taskId: task.id,
    body: "First comment",
    notify: false,
  });
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `task/${task.key}` },
      server.options,
    ),
  );
  await slot.findByText("First comment");
  server.failures.set("listComments", "Activity unavailable");
  await act(async () => {
    await server.write("createComment", {
      taskId: task.id,
      body: "Second comment",
      notify: false,
    });
  });
  const alert = await slot.findByRole("alert");
  expect(alert.textContent).toContain("Activity unavailable");
  expect(slot.getByText("First comment")).toBeTruthy();
  expect(slot.queryByText("Second comment")).toBeNull();
  server.failures.clear();
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await slot.findByText("Second comment");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

it("predicts detail status immediately and rolls back a refused write", async () => {
  const server = setup();
  const task = await server.create("Status draft");
  const write = deferred<never>();
  server.options.rpc = {
    ...server.options.rpc,
    updateTask: () => write.promise,
  };
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `task/${task.key}` },
      server.options,
    ),
  );
  const triggers = await slot.findAllByRole("button", { name: "Todo" });
  fireEvent.pointerDown(triggers[0]!, { button: 0, ctrlKey: false });
  fireEvent.click(await slot.findByRole("menuitem", { name: /Done/ }));
  await slot.findAllByRole("button", { name: "Done" });
  expect(slot.queryAllByRole("button", { name: "Todo" })).toHaveLength(0);
  await act(async () =>
    write.reject(
      new experimental_PluginRpcRefusal({
        code: "conflict",
        message: "Task changed",
      }),
    ),
  );
  await slot.findAllByRole("button", { name: "Todo" });
  await slot.findByText("Task changed");
  expect(slot.queryAllByRole("button", { name: "Done" })).toHaveLength(0);
});

it("keeps a saved title draft while the accepted write rereads", async () => {
  const server = setup();
  const task = await server.create("Old title");
  const write = deferred<void>();
  const reread = deferred<void>();
  const readStarted = deferred<void>();
  const originalWrite = server.options.rpc?.updateTask;
  const originalRead = server.options.rpc?.getTaskByKey;
  if (!originalWrite || !originalRead)
    throw new Error("Missing tasks handlers");
  let waitForRead = false;
  server.options.rpc = {
    ...server.options.rpc,
    updateTask: async (input, context) => {
      await write.promise;
      const result = await originalWrite(input, context);
      waitForRead = true;
      return result;
    },
    getTaskByKey: async (input, context) => {
      if (waitForRead) {
        readStarted.resolve();
        await reread.promise;
      }
      return originalRead(input, context);
    },
  };
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: `task/${task.key}` },
      server.options,
    ),
  );
  const title = await slot.findByRole("textbox", { name: "Task title" });
  title.textContent = "Saved title";
  fireEvent.blur(title);
  await waitFor(() =>
    expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
      "Saved title",
    ),
  );
  await act(async () => {
    write.resolve();
    await readStarted.promise;
  });
  expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
    "Saved title",
  );
  await act(async () => reread.resolve());
  await waitFor(() =>
    expect(slot.getByRole("textbox", { name: "Task title" }).textContent).toBe(
      "Saved title",
    ),
  );
  expect(server.store.tasks.getTask(task.id)?.title).toBe("Saved title");
});

it("shows the server's destination order after accepting a list status edit", async () => {
  const server = setup();
  const first = await server.create("Moving task");
  const second = await server.create("Already done", "done");
  const slot = server.connect(
    renderSlot(
      app.navPanels[0]!,
      { subPath: server.project.id },
      server.options,
    ),
  );
  await slot.findByText("Moving task");
  await slot.findByText("Already done");
  const row = slot.container.querySelector(`[data-task-key="${first.key}"]`);
  if (!(row instanceof HTMLElement)) throw new Error("Missing task row");
  fireEvent.keyDown(
    within(row).getByRole("button", { name: `Open ${first.key}: Moving task` }),
    { key: "s" },
  );
  fireEvent.click(await slot.findByRole("menuitem", { name: /Done/ }));
  await waitFor(() =>
    expect(
      Array.from(
        slot.container.querySelectorAll("[data-task-key]"),
        (element) => element.getAttribute("data-task-key"),
      ),
    ).toEqual([second.key, first.key]),
  );
  await waitFor(() =>
    expect(
      slot.getByRole("region", { name: "Tasks" }).hasAttribute("aria-busy"),
    ).toBe(false),
  );
  const savedRow = slot.container.querySelector(
    `[data-task-key="${first.key}"]`,
  );
  expect(savedRow?.hasAttribute("aria-busy")).toBe(false);
  expect(savedRow?.classList.contains("opacity-70")).toBe(false);
  await act(async () => {
    await server.write("deleteTask", { taskId: first.id });
  });
  await waitFor(() => expect(slot.queryByText("Moving task")).toBeNull());
  expect(slot.getByText("Already done")).toBeTruthy();
});
