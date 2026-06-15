import type { ThreadStatus, ThreadTimelinePendingTodos } from "@bb/domain";
import type { CreateSdkAreaArgs, PublicApiOutput } from "./common.js";

export interface StatusGetArgs {
  projectId?: string;
  threadId?: string;
}

export interface StatusThreadSummary {
  environmentId: string | null;
  id: string;
  parentThreadId: string | null;
  pinnedAt: number | null;
  projectId: string;
  status: ThreadStatus;
  title: string | null;
}

export type StatusProject = PublicApiOutput<"/projects/:id", "$get">;
export type StatusSourceThread = PublicApiOutput<"/threads/:id", "$get">;
export type StatusChildThreads = PublicApiOutput<"/threads", "$get">;
export type StatusTimeline = PublicApiOutput<"/threads/:id/timeline", "$get">;

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
      const threadId = input.threadId;
      const [project, thread] = await Promise.all([
        projectId
          ? fetchSilent(() =>
              transport.readJson(
                transport.api.v1.projects[":id"].$get({
                  param: { id: projectId },
                }),
              ),
            )
          : Promise.resolve(null),
        threadId
          ? fetchSilent(() =>
              transport.readJson(
                transport.api.v1.threads[":id"].$get({
                  param: { id: threadId },
                }),
              ),
            )
          : Promise.resolve(null),
      ]);
      const pendingTodos =
        thread === null
          ? null
          : await fetchSilent(async () => {
              const timeline: StatusTimeline = await transport.readJson(
                transport.api.v1.threads[":id"].timeline.$get({
                  param: { id: thread.id },
                  query: { summaryOnly: "true" },
                }),
              );
              return timeline.pendingTodos;
            });
      const childThreads =
        thread === null
          ? null
          : await fetchSilent(() =>
              transport.readJson(
                transport.api.v1.threads.$get({
                  query: {
                    projectId: thread.projectId,
                    parentThreadId: thread.id,
                  },
                }),
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
