import type {
  ThreadParentNotifications,
  ThreadStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import {
  isThreadTimelineDelta,
  type ProjectResponse,
  type ThreadListResponse,
  type ThreadResponse,
  type ThreadTimelineResponse,
  type ThreadWithIncludesResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface StatusGetArgs {
  projectId?: string;
  signal?: AbortSignal;
  threadId?: string;
}

export interface StatusThreadSummary {
  environmentId: string | null;
  id: string;
  parentNotifications: ThreadParentNotifications;
  parentThreadId: string | null;
  pinnedAt: number | null;
  projectId: string;
  status: ThreadStatus;
  title: string | null;
}

export type StatusProject = ProjectResponse;
export type StatusSourceThread = ThreadResponse | ThreadWithIncludesResponse;
export type StatusChildThreads = ThreadListResponse;
export type StatusTimeline = ThreadTimelineResponse;

export interface StatusResult {
  childThreads: StatusChildThreads | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  project: StatusProject | null;
  thread: StatusThreadSummary | null;
}

export interface StatusArea {
  get(args?: StatusGetArgs): Promise<StatusResult>;
}

async function fetchSilent<TValue>(
  fn: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function summarizeThread(thread: StatusSourceThread): StatusThreadSummary {
  return {
    environmentId: thread.environmentId ?? null,
    id: thread.id,
    parentNotifications: thread.parentNotifications,
    parentThreadId: thread.parentThreadId ?? null,
    pinnedAt: thread.pinnedAt,
    projectId: thread.projectId,
    status: thread.status,
    title: thread.title ?? null,
  };
}

export function createStatusArea(args: CreateSdkAreaArgs): StatusArea {
  const { call } = args.operations;
  return {
    async get(input = {}) {
      const projectId = input.projectId;
      const signal = input.signal;
      const threadId = input.threadId;
      const [project, thread] = await Promise.all([
        projectId
          ? fetchSilent(() => call("projects.get", { id: projectId }, signal))
          : Promise.resolve(null),
        threadId
          ? fetchSilent(() => call("threads.get", { id: threadId }, signal))
          : Promise.resolve(null),
      ]);
      const pendingTodos =
        thread === null
          ? null
          : await fetchSilent(async () => {
              const timeline = await call(
                "threads.timeline",
                { id: thread.id, summaryOnly: "true" },
                signal,
              );
              if (isThreadTimelineDelta(timeline)) {
                throw new Error("Expected a full thread timeline window.");
              }
              return timeline.pendingTodos;
            });
      const childThreads =
        thread === null
          ? null
          : await fetchSilent(() =>
              call("threads.list", { parentThreadId: thread.id }, signal),
            );

      return {
        childThreads,
        pendingTodos,
        project,
        thread: thread === null ? null : summarizeThread(thread),
      };
    },
  };
}
