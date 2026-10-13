import type { Task } from "./shared/contract.js";

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
