import { Command } from "commander";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import type {
  PluginAttentionEntry,
  PluginRuntimeStatus,
} from "@bb/server-contract";
import { action } from "../action.js";
import {
  resolveContextSnapshot,
  type ContextSnapshot,
} from "../context-env.js";
import { cliFetch, createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";
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
    environment: ThreadEnvironmentInfo | null;
  } | null;
  childThreads: Array<{
    id: string;
    status: string;
    title: string | null;
  }> | null;
  pendingTodos: ThreadTimelinePendingTodos | null;
  /**
   * Enabled plugins the server did not load (incompatible, error, missing).
   * Null while the server is unreachable. An `engines.bb` mismatch after a bb
   * upgrade otherwise unloads a plugin with no visible trace (#1915).
   */
  pluginsNeedingAttention: PluginAttentionEntry[] | null;
}

/**
 * One line, grouped by status in a stable order, e.g.
 * `2 plugins need attention (incompatible: notify; error: foo). Run bb plugin list.`
 */
export function formatPluginAttentionLine(
  entries: readonly PluginAttentionEntry[],
): string {
  const byStatus = new Map<PluginRuntimeStatus, string[]>();
  for (const entry of entries) {
    const ids = byStatus.get(entry.status) ?? [];
    ids.push(entry.id);
    byStatus.set(entry.status, ids);
  }
  const groups = [...byStatus.entries()]
    .map(([status, ids]) => `${status}: ${ids.join(", ")}`)
    .join("; ");
  const noun = entries.length === 1 ? "plugin needs" : "plugins need";
  return `${entries.length} ${noun} attention (${groups}). Run bb plugin list.`;
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
          dataDir: null,
          project: null,
          thread: null,
          childThreads: null,
          pendingTodos: null,
          pluginsNeedingAttention: null,
        };

        let serverAvailable = false;
        const sdk = createCliBbSdk(getUrl());

        // Best-effort: the data dir comes from system config (where theme/,
        // plugins, and the DB live). Works without any project/thread context.
        const dataDirRequest = cliFetch(`${getUrl()}/api/v1/system/config`)
          .then(async (response) => {
            if (!response.ok) return null;
            const config = (await response.json()) as { dataDir?: unknown };
            return typeof config.dataDir === "string" ? config.dataDir : null;
          })
          .catch(() => null); // Server unreachable — leave dataDir null.

        // Best-effort too: a plugin that silently stopped loading should show
        // up here without the user having to know to run bb plugin list.
        const attentionRequest = sdk.plugins
          .listAttention()
          .then((result) => result.plugins)
          .catch(() => null); // Older server or unreachable — leave null.

        // The context lookup is independent of the two above; start all three
        // together so `bb status` costs one round trip, not three.
        const statusRequest =
          context.projectId || context.threadId
            ? sdk.status.get({
                projectId: context.projectId,
                threadId: context.threadId,
              })
            : null;
        // Mark the rejection handled while the other requests settle; the
        // `await` below still rethrows it so the user sees the error.
        statusRequest?.catch(() => {});

        payload.dataDir = await dataDirRequest;
        if (payload.dataDir !== null) serverAvailable = true;
        payload.pluginsNeedingAttention = await attentionRequest;

        // Try to fetch enriched data from the server
        if (statusRequest !== null) {
          const status = await statusRequest;

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

        if (
          payload.pluginsNeedingAttention !== null &&
          payload.pluginsNeedingAttention.length > 0
        ) {
          console.log("");
          console.log(
            formatPluginAttentionLine(payload.pluginsNeedingAttention),
          );
        }

        if (!context.projectId && !context.threadId) {
          console.log("");
          console.log("Tip: run bb guide for help getting started.");
        }
      }),
    );
}
