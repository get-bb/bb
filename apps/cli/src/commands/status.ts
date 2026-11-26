import { Command } from "commander";
import { z } from "zod";
import { serverRouteSchema, type ServerRoute } from "@bb/server-contract";
import type {
  ThreadParentNotifications,
  ThreadTimelinePendingTodos,
} from "@bb/domain";
import { action } from "../action.js";
import {
  resolveContextSnapshot,
  type ContextSnapshot,
} from "../context-env.js";
import type { BbSdk } from "@bb/sdk";
import { cliFetch, createCliBbSdk } from "../client.js";
import { reportCommandResult } from "../command-result.js";
import { getErrorMessage } from "./helpers.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "./environment-helpers.js";
import { printPendingTodos } from "./thread/pending-todos.js";

const statusServerSchema = z.object({
  serverId: z.string().min(1),
  routes: z.array(serverRouteSchema),
});

interface StatusPayload {
  dataDir: string | null;
  serverId: string | null;
  routes: ServerRoute[];
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

interface StatusCommandOptions {
  json?: boolean;
}

async function fetchStatusWithEnvironment(args: {
  sdk: BbSdk;
  projectId: string | undefined;
  threadId: string | undefined;
}) {
  const status = await args.sdk.status.get({
    projectId: args.projectId,
    threadId: args.threadId,
  });
  const environmentId = status.thread?.environmentId;
  const environmentInfo = environmentId
    ? await args.sdk.environments.get({ environmentId }).then(
        (environment) => fetchEnvironmentInfo({ environment, sdk: args.sdk }),
        () => null,
      )
    : null;
  return { status, environmentInfo };
}

type ResolveServerUrl = () => string;
type ResolveStatusContext = () => ContextSnapshot;

export function registerStatusCommand(
  program: Command,
  getUrl: ResolveServerUrl,
  getContext: ResolveStatusContext = resolveContextSnapshot,
): void {
  program
    .command("status")
    .description("Show current context")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: StatusCommandOptions) => {
        const context = getContext();

        const payload: StatusPayload = {
          dataDir: null,
          serverId: null,
          routes: [],
          project: null,
          thread: null,
          childThreads: null,
          pendingTodos: null,
          pluginsNeedingAttention: [],
        };

        let serverAvailable = false;
        let serverError: string | null = null;

        const sdk = createCliBbSdk(getUrl());
        const [configResult, pluginsResult, statusResult] =
          await Promise.allSettled([
            cliFetch(`${getUrl()}/api/v1/system/config`),
            sdk.plugins.list(),
            context.projectId || context.threadId
              ? fetchStatusWithEnvironment({
                  sdk,
                  projectId: context.projectId,
                  threadId: context.threadId,
                })
              : null,
          ]);

        try {
          if (configResult.status === "rejected") {
            throw configResult.reason;
          }
          const response = configResult.value;
          if (response.ok) {
            const config = (await response.json()) as { dataDir?: unknown };
            const server = statusServerSchema.safeParse(config);
            if (server.success) {
              payload.serverId = server.data.serverId;
              payload.routes = server.data.routes;
            }
            if (typeof config.dataDir === "string") {
              payload.dataDir = config.dataDir;
              serverAvailable = true;
            }
          } else {
            serverError = `HTTP ${response.status}`;
          }
        } catch (error) {
          serverError = getErrorMessage(error);
        }

        if (serverAvailable) {
          if (pluginsResult.status === "rejected") {
            throw pluginsResult.reason;
          }
          const { plugins } = pluginsResult.value;
          payload.pluginsNeedingAttention = plugins
            .filter(
              (p) =>
                p.enabled &&
                ["incompatible", "error", "missing"].includes(p.status),
            )
            .map((p) => ({ id: p.id, status: p.status }));
        }

        if (serverError === null && statusResult.status === "rejected") {
          throw statusResult.reason;
        }
        if (
          serverError === null &&
          statusResult.status === "fulfilled" &&
          statusResult.value
        ) {
          const { status, environmentInfo } = statusResult.value;

          if (status.project) {
            payload.project = {
              id: status.project.id,
              name: status.project.name,
            };
            serverAvailable = true;
          }

          if (status.thread) {
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

        const missingContext = [
          ...(context.projectId && payload.project === null
            ? [`project ${context.projectId}`]
            : []),
          ...(context.threadId && payload.thread === null
            ? [`thread ${context.threadId}`]
            : []),
        ];

        reportCommandResult(opts, payload, {
          text: () => {
            if (serverAvailable && payload.project) {
              console.log(
                `Project: ${payload.project.name} (${payload.project.id})`,
              );
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

            if (payload.routes.length > 0) {
              console.log(`Reachable at:`);
              for (const route of payload.routes) {
                console.log(`  ${route.url}  (${route.displayName})`);
              }
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
          },
          failure:
            serverError !== null
              ? {
                  message: `The bb server at ${getUrl()} did not answer: ${serverError}`,
                  code: "server_unreachable",
                  hint: null,
                }
              : missingContext.length > 0
                ? {
                    message: `The context ${missingContext.join(" and ")} was not found on the server`,
                    code: "context_not_found",
                    hint: "Check BB_PROJECT_ID and BB_THREAD_ID.",
                  }
                : null,
        });
      }),
    );
}
