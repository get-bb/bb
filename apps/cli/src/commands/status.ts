import { Command } from "commander";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import { action } from "../action.js";
import {
  resolveContextSnapshot,
  type ContextSnapshot,
} from "../context-env.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";
import {
  type ThreadEnvironmentInfo,
  fetchEnvironmentInfo,
  printEnvironmentInfo,
} from "./environment-helpers.js";
import { printPendingTodos } from "./thread/pending-todos.js";

interface StatusPayload {
  project: { id: string; name: string } | null;
  thread: {
    id: string;
    type: string;
    status: string;
    title: string | null;
    pinnedAt: number | null;
    parentThreadId: string | null;
    environment: ThreadEnvironmentInfo | null;
  } | null;
  managedThreads: Array<{
    id: string;
    status: string;
    title: string | null;
  }> | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
}

interface StatusCommandOptions {
  json?: boolean;
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
          project: null,
          thread: null,
          managedThreads: null,
          pendingTodos: null,
        };

        let serverAvailable = false;

        // Try to fetch enriched data from the server
        if (context.projectId || context.threadId) {
          const sdk = createCliBbSdk(getUrl());
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
              type: status.thread.type,
              status: status.thread.status,
              title: status.thread.title ?? null,
              pinnedAt: status.thread.pinnedAt,
              parentThreadId: status.thread.parentThreadId ?? null,
              environment: environmentInfo,
            };
            serverAvailable = true;

            if (status.managedThreads) {
              payload.managedThreads = status.managedThreads.map((thread) => ({
                id: thread.id,
                status: thread.status,
                title: thread.title ?? null,
              }));
            }
          }
        }

        // JSON output
        if (outputJson(opts, payload)) return;

        // Human-readable output
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
          console.log(`  Type: ${payload.thread.type}`);
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
          }
          if (payload.thread.environment) {
            printEnvironmentInfo(payload.thread.environment);
          }

          if (payload.managedThreads && payload.managedThreads.length > 0) {
            console.log("");
            console.log(`Managed threads: ${payload.managedThreads.length}`);
            for (const mt of payload.managedThreads) {
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

        if (!context.projectId && !context.threadId) {
          console.log("");
          console.log("Tip: run bb guide for help getting started.");
        }
      }),
    );
}
