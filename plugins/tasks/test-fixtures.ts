import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Label, Task, TaskThread } from "./shared/contract.js";

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

export function makeTaskThread(
  threadId: string,
  taskId: string,
  overrides: Partial<TaskThread> = {},
): TaskThread {
  return {
    id: "01HZT1ZZZZZZZZZZZZZZZZZZAT",
    taskId,
    threadId,
    presetName: "Worker",
    title: `Thread ${threadId}`,
    liveStatus: "working",
    attachedAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

export function makeSidebarThread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    title: id,
    titleFallback: null,
    displayTitle: id,
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "test-provider",
    status: "active",
    runtimeStatus: "active",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/threads/${id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 1000,
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

export function matchingTasks(tasks: readonly Task[], raw: unknown): Task[] {
  const input = rpcInput(raw);
  const statuses = Array.isArray(input.statuses) ? input.statuses : null;
  return tasks.filter(
    (task) =>
      (statuses === null || statuses.includes(task.status)) &&
      (typeof input.projectId !== "string" ||
        task.projectId === input.projectId) &&
      (input.parentTaskId === undefined ||
        task.parentTaskId === input.parentTaskId),
  );
}

export function labelsByProject(
  labels: readonly Label[],
): (raw: unknown) => Record<string, Label[]> {
  return (raw) => {
    const keys = rpcInput(raw).keys;
    if (!Array.isArray(keys)) throw new Error("labelsByProject needs keys");
    return Object.fromEntries(
      keys.map((projectId) => [
        String(projectId),
        labels.filter((label) => label.projectId === projectId),
      ]),
    );
  };
}
