import type { Thread, ThreadTimelinePendingTodos } from "@bb/domain";
import type {
  ProjectResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export interface StatusGetArgs {
  projectId?: string;
  threadId?: string;
}

export interface StatusThreadResponse {
  environmentId: string | null;
  id: string;
  parentThreadId: string | null;
  pinnedAt: number | null;
  projectId: string;
  status: string;
  title: string | null;
  type: string;
}

export interface StatusGetResponse {
  managedThreads: Thread[] | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  project: ProjectResponse | null;
  thread: StatusThreadResponse | null;
}

export interface StatusArea {
  get(args?: StatusGetArgs): Promise<StatusGetResponse>;
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

function summarizeThread(thread: Thread): StatusThreadResponse {
  return {
    environmentId: thread.environmentId ?? null,
    id: thread.id,
    parentThreadId: thread.parentThreadId ?? null,
    pinnedAt: thread.pinnedAt,
    projectId: thread.projectId,
    status: thread.status,
    title: thread.title ?? null,
    type: thread.type,
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
              const timeline: ThreadTimelineResponse = await transport.readJson(
                transport.api.v1.threads[":id"].timeline.$get({
                  param: { id: thread.id },
                  query: { summaryOnly: "true" },
                }),
              );
              return timeline.pendingTodos;
            });
      const managedThreads =
        thread?.type === "manager"
          ? await fetchSilent(() =>
              transport.readJson(
                transport.api.v1.threads.$get({
                  query: {
                    projectId: thread.projectId,
                    parentThreadId: thread.id,
                  },
                }),
              ),
            )
          : null;

      return {
        managedThreads,
        pendingTodos,
        project,
        thread: thread === null ? null : summarizeThread(thread),
      };
    },
  };
}
