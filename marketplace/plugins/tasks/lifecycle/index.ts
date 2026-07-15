import type { BbPluginApi } from "@bb/plugin-sdk";
import type { TasksApiStore } from "../api";
import type { TaskThread, TaskThreadLiveStatus } from "../db";
import {
  createSystemComment,
  publishCommentsChanged,
  publishThreadsChanged,
} from "../delegate";

const TERMINAL_LIVE_STATUSES = new Set<TaskThreadLiveStatus>([
  "completed",
  "failed",
]);

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function liveStatusFromThread(thread: SdkThread): TaskThreadLiveStatus {
  if (thread.status === "error") return "failed";
  if (thread.deletedAt !== null) return "completed";

  switch (thread.status) {
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
  }
}

function trackedThreads(
  store: TasksApiStore,
  threadId?: string,
): TaskThread[] {
  const tracked: TaskThread[] = [];
  for (const task of store.tasks.listTasks()) {
    for (const thread of store.tasks.listTaskThreads(task.id)) {
      if (threadId === undefined || thread.threadId === threadId) {
        tracked.push(thread);
      }
    }
  }
  return tracked;
}

function terminalCommentBody(
  thread: TaskThread,
  liveStatus: Extract<TaskThreadLiveStatus, "completed" | "failed">,
): string {
  return `Thread "${thread.title}" ${liveStatus} — final message posted · ${thread.threadId}`;
}

function sdkErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function transitionThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: TaskThread,
  liveStatus: TaskThreadLiveStatus,
): void {
  if (
    thread.liveStatus === liveStatus ||
    TERMINAL_LIVE_STATUSES.has(thread.liveStatus)
  ) {
    return;
  }

  store.transaction(() => {
    store.tasks.updateTaskThreadStatus(thread.id, liveStatus);
    if (liveStatus === "completed" || liveStatus === "failed") {
      createSystemComment(store.tasks, {
        taskId: thread.taskId,
        presetName: thread.presetName,
        threadId: thread.threadId,
        body: terminalCommentBody(thread, liveStatus),
      });
    }
  });

  publishThreadsChanged(bb, thread.taskId);
  publishCommentsChanged(bb, thread.taskId);
}

function transitionTrackedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  threadId: string,
  liveStatus: TaskThreadLiveStatus,
): void {
  for (const thread of trackedThreads(store, threadId)) {
    transitionThread(bb, store, thread, liveStatus);
  }
}

async function reconcileTrackedThreads(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  const nonTerminalThreads = trackedThreads(store).filter(
    (thread) => !TERMINAL_LIVE_STATUSES.has(thread.liveStatus),
  );

  for (const trackedThread of nonTerminalThreads) {
    try {
      const thread = await bb.sdk.threads.get({
        threadId: trackedThread.threadId,
      });
      transitionThread(bb, store, trackedThread, liveStatusFromThread(thread));
    } catch (error) {
      if (sdkErrorCode(error) === "thread_not_found") {
        transitionThread(bb, store, trackedThread, "completed");
        continue;
      }
      bb.log.warn(
        `Could not reconcile task thread ${trackedThread.threadId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export async function registerLifecycle(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  await reconcileTrackedThreads(bb, store);

  bb.events.on("thread.created", ({ thread }) => {
    transitionTrackedThread(
      bb,
      store,
      thread.id,
      liveStatusFromThread(thread),
    );
  });
  bb.events.on("thread.idle", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "idle");
  });
  bb.events.on("thread.failed", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "failed");
  });
  bb.events.on("thread.deleted", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "completed");
  });
}
