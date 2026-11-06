import type { Command } from "commander";
import type {
  ThreadParentNotifications,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import {
  resolveContextSnapshot,
  type ContextSnapshot,
} from "../context-env.js";
import { clientCommand, mountCommands } from "../operation-doors.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "./environment-helpers.js";
import { printPendingTodos } from "./thread/pending-todos.js";

interface StatusPayload {
  dataDir: string | null;
  project: { id: string; name: string } | null;
  thread: {
    id: string;
    status: string;
    title: string | null;
    pinnedAt: number | null;
    parentThreadId: string | null;
    parentNotifications: ThreadParentNotifications;
    environment: ThreadEnvironmentInfo | null;
  } | null;
  childThreads: Array<{
    id: string;
    status: string;
    title: string | null;
  }> | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  pluginsNeedingAttention: Array<{ id: string; status: string }>;
}

type ResolveServerUrl = () => string;
type ResolveStatusContext = () => ContextSnapshot;

interface StatusOutput {
  payload: StatusPayload;
  context: ContextSnapshot;
  serverAvailable: boolean;
}

export const statusCommand = clientCommand<null, StatusOutput>({
  name: "cli.status",
  kind: "read",
  description:
    "Combine the server config, plugin health and the current project and thread",
  door: {
    path: ["status"],
    summary: "Show current context",
    prepare: () => null,
    async run(_input, client) {
      const context = client.context();

      const payload: StatusPayload = {
        dataDir: null,
        project: null,
        thread: null,
        childThreads: null,
        pendingTodos: null,
        pluginsNeedingAttention: [],
      };

      let serverAvailable = false;

      try {
        const config: { dataDir?: unknown } = await client.call(
          "system.config",
          {},
        );
        if (typeof config.dataDir === "string") {
          payload.dataDir = config.dataDir;
          serverAvailable = true;
        }
      } catch {}

      if (serverAvailable) {
        const { plugins } = await client.sdk().plugins.list();
        payload.pluginsNeedingAttention = plugins
          .filter(
            (p) =>
              p.enabled &&
              ["incompatible", "error", "missing"].includes(p.status),
          )
          .map((p) => ({ id: p.id, status: p.status }));
      }

      if (context.projectId || context.threadId) {
        const sdk = client.sdk();
        const status = await sdk.status.get({
          projectId: context.projectId,
          threadId: context.threadId,
        });

        if (status.project) {
          payload.project = {
            id: status.project.id,
            name: status.project.name,
          };
          serverAvailable = true;
        }

        if (status.thread) {
          let environmentInfo: ThreadEnvironmentInfo | null = null;
          if (status.thread.environmentId) {
            environmentInfo = await fetchEnvironmentInfo({
              environmentId: status.thread.environmentId,
              sdk,
            });
          }

          payload.pendingTodos = status.pendingTodos;
          payload.thread = {
            id: status.thread.id,
            status: status.thread.status,
            title: status.thread.title ?? null,
            pinnedAt: status.thread.pinnedAt,
            parentThreadId: status.thread.parentThreadId ?? null,
            parentNotifications: status.thread.parentNotifications,
            environment: environmentInfo,
          };
          serverAvailable = true;

          if (status.childThreads) {
            payload.childThreads = status.childThreads.map((thread) => ({
              id: thread.id,
              status: thread.status,
              title: thread.title ?? null,
            }));
          }
        }
      }

      return { payload, context, serverAvailable };
    },
    json: ({ payload }) => payload,
    print({ payload, context, serverAvailable }) {
      if (serverAvailable && payload.project) {
        console.log(`Project: ${payload.project.name} (${payload.project.id})`);
      } else if (context.projectId) {
        console.log(`Project: ${context.projectId}`);
      } else {
        console.log("Project: (not set)");
      }

      console.log("");

      if (serverAvailable && payload.thread) {
        console.log(`Thread: ${payload.thread.id}`);
        console.log(`  Status: ${payload.thread.status}`);
        if (payload.thread.title) {
          console.log(`  Title: ${payload.thread.title}`);
        }
        if (payload.thread.pinnedAt !== null) {
          console.log(
            `  Pinned: ${new Date(payload.thread.pinnedAt).toLocaleString()}`,
          );
        }
        if (payload.thread.parentThreadId) {
          console.log(`  Parent: ${payload.thread.parentThreadId}`);
          console.log(
            `  Parent notifications: ${payload.thread.parentNotifications}`,
          );
        }
        if (payload.thread.environment) {
          printEnvironmentInfo(payload.thread.environment);
        }

        if (payload.childThreads && payload.childThreads.length > 0) {
          console.log("");
          console.log(`Child threads: ${payload.childThreads.length}`);
          for (const mt of payload.childThreads) {
            const title = mt.title ? `"${mt.title}"` : "";
            console.log(`  ${mt.id}  ${mt.status}  ${title}`);
          }
        }

        printPendingTodos(payload.pendingTodos);
      } else if (context.threadId) {
        console.log(`Thread: ${context.threadId}`);
      } else {
        console.log("Thread: (not set)");
      }

      if (payload.dataDir) {
        console.log("");
        console.log(`Data dir: ${payload.dataDir}`);
      }

      const attention = payload.pluginsNeedingAttention;
      if (attention.length > 0) {
        console.log("");
        console.log(
          `${attention.length} plugin${attention.length === 1 ? "" : "s"} not running (${attention.map((p) => `${p.id}: ${p.status}`).join(", ")}). Run bb plugin list.`,
        );
      }

      if (!context.projectId && !context.threadId) {
        console.log("");
        console.log("Tip: run bb guide for help getting started.");
      }

      return null;
    },
  },
});

export function registerStatusCommand(
  program: Command,
  getUrl: ResolveServerUrl,
  getContext: ResolveStatusContext = resolveContextSnapshot,
): void {
  mountCommands(program, [statusCommand], { getUrl, getContext });
}
