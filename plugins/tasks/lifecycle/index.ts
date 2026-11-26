import {
  experimental_BbHttpError,
  type BbPluginApi,
  type PluginThreadSettledEvent,
} from "@get-bb/plugin-sdk";
import {
  invalidateComments,
  invalidateThreads,
  type TasksApiStore,
} from "../api";
import type { TaskThread, TaskThreadLiveStatus } from "../db";
import { createSystemComment } from "../delegate";
import { errorMessage } from "../shared/errors";

const TERMINAL_LIVE_STATUSES = new Set<TaskThreadLiveStatus>(["completed"]);

type SdkThread = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

function liveStatusFromThread(thread: SdkThread): TaskThreadLiveStatus {
  if (thread.status === "error") return "failed";
  if (thread.deletedAt !== null) return "completed";

  switch (thread.status) {
    case "pending":
    case "starting":
      return "starting";
    case "active":
    case "stopping":
      return "working";
    case "idle":
      return "idle";
  }
}

async function liveStatusFromSettled(
  bb: BbPluginApi,
  store: TasksApiStore,
  event: PluginThreadSettledEvent,
): Promise<TaskThreadLiveStatus | null> {
  switch (event.outcome) {
    case "completed":
      return "idle";
    case "failed":
      return "failed";
    case "cancelled":
      return liveStatusAfterCancelledMessage(bb, store, event.thread);
    case "archived":
      return "idle";
    case "deleted":
      return "completed";
  }
}

async function liveStatusAfterCancelledMessage(
  bb: BbPluginApi,
  store: TasksApiStore,
  thread: SdkThread,
): Promise<TaskThreadLiveStatus | null> {
  if (thread.status !== "pending") return liveStatusFromThread(thread);
  if (store.tasks.listTaskThreadsByThreadId(thread.id).length === 0) {
    return null;
  }
  try {
    const queued = await bb.sdk.threads.queuedMessages.list({
      threadId: thread.id,
    });
    return queued.length === 0 ? "idle" : null;
  } catch (error) {
    bb.log.warn(
      `Could not list queued messages of task thread ${thread.id}: ${errorMessage(
        error,
      )}`,
    );
    return null;
  }
}

function trackedThreads(store: TasksApiStore): TaskThread[] {
  const tracked: TaskThread[] = [];
  for (const task of store.tasks.listTasks()) {
    for (const thread of store.tasks.listTaskThreads(task.id)) {
      tracked.push(thread);
    }
  }
  return tracked;
}

function statusCommentBody(
  thread: TaskThread,
  liveStatus: Extract<TaskThreadLiveStatus, "completed" | "failed">,
): string {
  const outcome =
    liveStatus === "completed" ? "completed — final message posted" : "failed";
  return `Thread "${thread.title}" ${outcome} · ${thread.threadId}`;
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
        body: statusCommentBody(thread, liveStatus),
      });
    }
  });

  invalidateThreads(bb, thread.taskId);
  invalidateComments(bb, thread.taskId);
}

function transitionTrackedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  threadId: string,
  liveStatus: TaskThreadLiveStatus,
): void {
  for (const thread of store.tasks.listTaskThreadsByThreadId(threadId)) {
    transitionThread(bb, store, thread, liveStatus);
  }
}

async function reconcileTrackedThread(
  bb: BbPluginApi,
  store: TasksApiStore,
  trackedThread: TaskThread,
): Promise<void> {
  try {
    const thread = await bb.sdk.threads.get({
      threadId: trackedThread.threadId,
    });
    transitionThread(bb, store, trackedThread, liveStatusFromThread(thread));
  } catch (error) {
    if (
      error instanceof experimental_BbHttpError &&
      error.code === "thread_not_found"
    ) {
      transitionThread(bb, store, trackedThread, "completed");
      return;
    }
    bb.log.warn(
      `Could not reconcile task thread ${trackedThread.threadId}: ${errorMessage(
        error,
      )}`,
    );
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
    await reconcileTrackedThread(bb, store, trackedThread);
  }
}

export async function registerLifecycle(
  bb: BbPluginApi,
  store: TasksApiStore,
): Promise<void> {
  bb.events.on("thread.created", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, liveStatusFromThread(thread));
  });
  bb.events.on("thread.active", ({ thread }) => {
    transitionTrackedThread(bb, store, thread.id, "working");
  });
  bb.events.on("experimental_thread.settled", async (event) => {
    const liveStatus = await liveStatusFromSettled(bb, store, event);
    if (liveStatus === null) return;
    transitionTrackedThread(bb, store, event.thread.id, liveStatus);
  });

  await reconcileTrackedThreads(bb, store);
}
