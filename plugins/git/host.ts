import { stat } from "node:fs/promises";
import { workspaceResolutionFailureCodeSchema } from "bb-git-contract";
import type { z } from "zod";
import { unavailableSchema } from "./host-contract.js";
import { GitWorkspaceReads } from "./workspace-reads.js";
import path from "node:path";
import { realpath } from "node:fs/promises";
import {
  experimental_defineHostEntry,
  type ExperimentalHostWatchSubscription,
} from "@get-bb/plugin-sdk/host";
import { getGitCommonDir, runGit } from "bb-git-host/git";
import { listWorkspaceBranchOptions } from "bb-git-host/branch-options";
import { gitHostContract, gitHostSignals } from "./host-contract.js";

async function readWorkspace<T>(
  workspacePath: string,
  signal: AbortSignal,
  read: () => Promise<T>,
): Promise<T | z.infer<typeof unavailableSchema>> {
  try {
    await stat(workspacePath);
    return await read();
  } catch (error) {
    if (signal.aborted) throw error;
    const rawCode =
      error instanceof Error && "code" in error ? error.code : undefined;
    const code = workspaceResolutionFailureCodeSchema.safeParse(
      rawCode === "ENOENT"
        ? "path_not_found"
        : rawCode === "EACCES" || rawCode === "EPERM"
          ? "permission_denied"
          : rawCode,
    );
    return {
      outcome: "unavailable",
      failure: {
        code: code.success ? code.data : "unknown",
        workspacePath,
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Unknown workspace resolution failure",
      },
    };
  }
}

export function createGitHostEntry() {
  const backgroundWork = new Set<Promise<void>>();
  const watches = new Map<
    string,
    { subscriptions: ExperimentalHostWatchSubscription[]; cancelled: boolean }
  >();
  async function unwatch(id: string) {
    const watch = watches.get(id);
    watches.delete(id);
    if (!watch) return;
    watch.cancelled = true;
    await Promise.all(
      watch.subscriptions.map((subscription) => subscription.dispose()),
    );
  }
  return experimental_defineHostEntry({
    contract: gitHostContract,
    experimental_signals: gitHostSignals,
    handlers: {
      branches({ selectedBranch, ...input }, context) {
        return listWorkspaceBranchOptions(
          {
            ...input,
            ...(selectedBranch === null ? {} : { selectedBranch }),
            remoteRefresh: "background",
            signal: context.signal,
          },
          {
            signal: context.lifecycle.signal,
            onStart(work) {
              const lease = context.experimental_retainWorker();
              const retained = work.finally(() => lease.dispose());
              backgroundWork.add(retained);
              void retained.then(
                () => backgroundWork.delete(retained),
                () => backgroundWork.delete(retained),
              );
            },
          },
        );
      },
      async status({ path, mergeBaseBranch, ...budgets }, context) {
        const workspace = new GitWorkspaceReads(path, {
          signal: context.signal,
          priority: "status",
        });
        return readWorkspace(path, context.signal, () =>
          workspace.getStatus({
            ...budgets,
            ...(mergeBaseBranch === null ? {} : { mergeBaseBranch }),
          }),
        );
      },
      async files({ path, ...options }, context) {
        return readWorkspace(path, context.signal, () =>
          new GitWorkspaceReads(path, { signal: context.signal }).diffFiles(
            options,
          ),
        );
      },
      async diff({ path, ...options }, context) {
        return readWorkspace(path, context.signal, () =>
          new GitWorkspaceReads(path, { signal: context.signal }).getDiff(
            options,
          ),
        );
      },
      async patches({ path, ...options }, context) {
        return new GitWorkspaceReads(path, {
          signal: context.signal,
        }).diffPatch(options);
      },
      async watch(input, context) {
        await unwatch(input.id);
        const watch = {
          subscriptions: new Array<ExperimentalHostWatchSubscription>(),
          cancelled: false,
        };
        watches.set(input.id, watch);
        try {
          const workspaceRoot = await realpath(input.path);
          const gitDir = await runGit(["rev-parse", "--absolute-git-dir"], {
            cwd: input.path,
            signal: context.signal,
          });
          const roots = new Set(
            await Promise.all(
              [
                workspaceRoot,
                path.resolve(input.path, gitDir.stdout.trim()),
                await getGitCommonDir(input.path, { signal: context.signal }),
              ].map((root) => realpath(root)),
            ),
          );
          for (const rootPath of roots) {
            if (watch.cancelled || context.signal.aborted) break;
            const subscription = await context.experimental_watch(
              { rootPath },
              async (event) => {
                if (watch.cancelled) return;
                const relativePaths =
                  event.kind === "changed"
                    ? [
                        ...new Set(
                          event.changes.map((change) =>
                            path
                              .relative(workspaceRoot, change.path)
                              .split(path.sep)
                              .join("/"),
                          ),
                        ),
                      ]
                    : null;
                const paths =
                  rootPath === workspaceRoot &&
                  relativePaths !== null &&
                  relativePaths.length <= 200 &&
                  relativePaths.every(
                    (path) =>
                      path !== "" &&
                      path !== ".git" &&
                      !path.startsWith(".git/") &&
                      !path.startsWith("../"),
                  )
                    ? relativePaths
                    : null;
                await context.experimental_emitSignal("changed", {
                  id: input.id,
                  paths,
                });
              },
            );
            if (watch.cancelled || context.signal.aborted)
              await subscription.dispose();
            else watch.subscriptions.push(subscription);
          }
          if (context.signal.aborted && watches.get(input.id) === watch)
            await unwatch(input.id);
        } catch (error) {
          watch.cancelled = true;
          if (watches.get(input.id) === watch) watches.delete(input.id);
          await Promise.all(
            watch.subscriptions.map((subscription) => subscription.dispose()),
          );
          throw error;
        }
        return null;
      },
      async unwatch({ id }) {
        await unwatch(id);
        return null;
      },
    },
    async dispose() {
      await Promise.all([...watches.keys()].map(unwatch));
      await Promise.allSettled([...backgroundWork]);
    },
  });
}
export default createGitHostEntry();
