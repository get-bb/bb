import { z } from "zod";
import { tasksRpcContract, type Task } from "./shared/contract.js";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    number: 1,
    key: "TSK-1",
    title: "Test task",
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

export function rpcInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(
      `expected an RPC input object, got ${JSON.stringify(input)}`,
    );
  }
  return Object.fromEntries(Object.entries(input));
}

export function createMemoryStorage(
  initialEntries: Record<string, string> = {},
): Storage {
  const entries = new Map(Object.entries(initialEntries));
  return {
    get length() {
      return entries.size;
    },
    clear: () => {
      entries.clear();
    },
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
}

export function liveTaskRpcFixtures(
  handlers: Record<string, ((input: never) => unknown) | undefined>,
) {
  const rows = new Map<string, Task>();
  const rowInputs = new Map<string, unknown>();
  const fixtureTask = tasksRpcContract.getTask.output.shape.task
    .unwrap()
    .extend({
      id: z.string(),
      projectId: z.string(),
      parentTaskId: z.string().nullable(),
      labelIds: z.array(z.string()),
    });
  const invoke = async (method: string, input: unknown) =>
    handlers[method]?.(input as never);
  const keysOf = (input: unknown) =>
    z.object({ keys: z.array(z.string()) }).parse(input).keys;
  const keyed =
    (method: string, inputKey: string, outputKey: string) =>
    async (input: unknown) =>
      Object.fromEntries(
        await Promise.all(
          keysOf(input).map(async (key) => {
            const value = await invoke(method, { [inputKey]: key });
            const parsed = z.record(z.string(), z.unknown()).parse(value ?? {});
            return [key, parsed[outputKey] ?? []];
          }),
        ),
      );
  const result = {
    ...handlers,
    taskMembership:
      handlers.taskMembership ??
      (async (input: unknown) => {
        const result = z
          .object({ tasks: z.array(fixtureTask) })
          .parse((await invoke("listTasks", input)) ?? { tasks: [] });
        for (const task of result.tasks) {
          rows.set(task.id, task);
          rowInputs.set(task.id, input);
        }
        const open = result.tasks.filter(
          (task) => task.status !== "done" && task.status !== "canceled",
        );
        const closed = result.tasks.filter(
          (task) => task.status === "done" || task.status === "canceled",
        );
        return {
          keys: [...open, ...closed].map((task) => task.id),
          openCount: open.length,
        };
      }),
    getTasksKeyed:
      handlers.getTasksKeyed ??
      (async (input: unknown) =>
        Object.fromEntries(
          await Promise.all(
            keysOf(input).map(async (key) => {
              if (!handlers.getTask && handlers.listTasks) {
                const latest = z
                  .object({ tasks: z.array(fixtureTask) })
                  .parse(await invoke("listTasks", rowInputs.get(key) ?? {}));
                return [
                  key,
                  latest.tasks.find((task) => task.id === key) ?? null,
                ];
              }
              const value = await invoke("getTask", { taskId: key });
              return [
                key,
                value === undefined
                  ? (rows.get(key) ?? null)
                  : z.object({ task: fixtureTask.nullable() }).parse(value)
                      .task,
              ];
            }),
          ),
        )),
    getLabelsKeyed:
      handlers.getLabelsKeyed ?? keyed("listLabels", "projectId", "labels"),
    getTaskThreadsKeyed:
      handlers.getTaskThreadsKeyed ??
      keyed("listTaskThreads", "taskId", "taskThreads"),
    getTaskAttachmentsKeyed:
      handlers.getTaskAttachmentsKeyed ??
      keyed("listAttachments", "taskId", "attachments"),
    listComments: async (input: unknown) => {
      const { taskId } = tasksRpcContract.listComments.input.parse(input);
      const comments = z
        .object({
          comments: z.array(z.unknown()),
          attachments: z.array(z.unknown()).optional(),
        })
        .parse((await invoke("listComments", input)) ?? { comments: [] });
      if (comments.attachments) return comments;
      const attachments = z.object({ attachments: z.array(z.unknown()) }).parse(
        (await invoke("listAttachments", { commentsOfTaskId: taskId })) ?? {
          attachments: [],
        },
      );
      return { ...comments, ...attachments };
    },
  };
  return Object.fromEntries(
    Object.entries(result).map(([method, handler]) => [
      method,
      (input: unknown) => handler?.(input as never),
    ]),
  );
}
