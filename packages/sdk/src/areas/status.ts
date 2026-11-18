import type {
  ThreadParentNotifications,
  ThreadStatus,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import type {
  ProjectResponse,
  ThreadListResponse,
  ThreadResponse,
  ThreadTimelineResponse,
  ThreadWithIncludesResponse,
} from "@bb/server-contract";
import { BbHttpError } from "../response.js";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

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

async function fetchUnlessMissing<TValue>(
  fn: () => Promise<TValue>,
): Promise<TValue | null> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BbHttpError && error.status === 404) return null;
    throw error;
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
  const { transport } = args;
  return {
    async get(input = {}) {
      const projectId = input.projectId;
      const signal = input.signal;
      const threadId = input.threadId;
      const [project, thread] = await Promise.all([
        projectId
          ? fetchUnlessMissing(() =>
              transport.readJson(
                transport.api.v1.projects[":id"].$get(
                  {
                    param: { id: projectId },
                  },
                  ...signalRequestArgs(signal),
                ),
              ),
            )
          : Promise.resolve(null),
        threadId
          ? fetchUnlessMissing(() =>
              transport.readJson(
                transport.api.v1.threads[":id"].$get(
                  {
                    param: { id: threadId },
                  },
                  ...signalRequestArgs(signal),
                ),
              ),
            )
          : Promise.resolve(null),
      ]);
      const pendingTodos =
        thread === null
          ? null
          : await fetchUnlessMissing(async () => {
              const headState = await transport.readJson(
                transport.api.v1.threads[":id"]["head-state"].$get(
                  { param: { id: thread.id } },
                  ...signalRequestArgs(signal),
                ),
              );
              return headState.pendingTodos;
            });
      const childThreads =
        thread === null
          ? null
          : await fetchUnlessMissing(() =>
              transport.readJson(
                transport.api.v1.threads.$get(
                  {
                    query: { parentThreadId: thread.id },
                  },
                  ...signalRequestArgs(signal),
                ),
              ),
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
