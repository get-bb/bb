import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import {
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import {
  gitFilesTag,
  gitRefsTag,
  gitStatusTag,
  parseGitPatchKey,
  type GitPatchKey,
  type GitPatchResult,
  type GitStatusRow,
} from "./contract.js";
import { gitRpcContract } from "./rpc-contract.js";
import { createGitCli } from "./server/cli.js";
import {
  createCoalescedInvalidator,
  tagsForEnvironmentChanges,
  type EnvironmentChangeKind,
} from "./server/invalidation.js";
import { createGitReads } from "./server/reads.js";
import { createReadGenerations } from "./server/generations.js";
import { createGitViewed } from "./server/viewed.js";

const DEFAULT_BRANCH_LIMIT = 50;
const THREAD_ENVIRONMENT_CACHE_LIMIT = 1024;

function patchGroupKey(key: GitPatchKey): string {
  return JSON.stringify([key.environmentId, key.target, key.ignoreWhitespace]);
}

export default function gitPlugin(bb: BbPluginApi): void {
  const watchedEnvironments = new Map<string, number>();
  const generations = createReadGenerations((environmentId) =>
    watchedEnvironments.has(environmentId),
  );
  const reads = createGitReads(bb, generations.freshness);
  const viewed = createGitViewed(bb);
  const invalidator = createCoalescedInvalidator((tags) =>
    bb.rpc.experimental_invalidate(tags),
  );

  let stopEnvironmentEvents: (() => void) | null = null;
  const threadEnvironments = new Map<string, string | null>();

  function environmentChanged(
    environmentId: string,
    changes: readonly EnvironmentChangeKind[],
  ): void {
    const { tags, clearCaches, refsChanged } = tagsForEnvironmentChanges(
      environmentId,
      changes,
    );
    if (clearCaches) {
      generations.changed(environmentId, refsChanged);
      reads.clearCaches(environmentId);
    }
    if (watchedEnvironments.has(environmentId))
      invalidator.invalidate(environmentId, tags);
  }

  const servedStatus = new Map<string, string>();

  function statusRow(environmentId: string): Promise<GitStatusRow> {
    return reads
      .status(environmentId, { kind: "environment" }, "shared")
      .catch((error: unknown) => ({
        outcome: "failed" as const,
        message:
          error instanceof experimental_PluginRpcRefusal
            ? error.message
            : "Workspace status unavailable.",
      }));
  }

  function turnEnded(environmentId: string | null): void {
    if (environmentId === null || !watchedEnvironments.has(environmentId)) {
      return;
    }
    generations.changed(environmentId, false);
    reads.clearCaches(environmentId);
    const served = servedStatus.get(environmentId);
    void statusRow(environmentId).then((row) => {
      if (JSON.stringify(row) === served) return;
      invalidator.invalidate(environmentId, [
        gitStatusTag(environmentId),
        gitFilesTag(environmentId),
      ]);
    });
  }

  function threadTurnEnded(threadId: string): void {
    const known = threadEnvironments.get(threadId);
    if (known !== undefined) {
      turnEnded(known);
      return;
    }
    void bb.sdk.threads.get({ threadId }).then(
      (thread) => {
        if (stopEnvironmentEvents === null) return;
        if (threadEnvironments.size >= THREAD_ENVIRONMENT_CACHE_LIMIT) {
          const [oldest] = threadEnvironments.keys();
          if (oldest !== undefined) threadEnvironments.delete(oldest);
        }
        threadEnvironments.set(threadId, thread.environmentId);
        turnEnded(thread.environmentId);
      },
      () => undefined,
    );
  }

  function subscribeToChanges(): () => void {
    const stopThreads = bb.sdk.subscribe({
      event: "thread:changed",
      callback: (event) => {
        const threadId = event.id;
        if (threadId === undefined) return;
        if (
          event.changes.includes("environment-changed") ||
          event.changes.includes("thread-deleted")
        ) {
          threadEnvironments.delete(threadId);
        }
        const status = event.metadata?.statusChange?.status;
        if (
          event.changes.includes("status-changed") &&
          (status === "idle" || status === "error")
        ) {
          threadTurnEnded(threadId);
        }
      },
    });
    const stopEnvironments = bb.sdk.subscribe({
      event: "environment:changed",
      callback: (event) => {
        if (event.id !== undefined) environmentChanged(event.id, event.changes);
      },
    });
    const stopHosts = bb.sdk.subscribe({
      event: "host:changed",
      callback: (event) => {
        if (
          event.id !== undefined &&
          event.changes.some(
            (change) =>
              change === "host-connected" || change === "host-disconnected",
          )
        ) {
          reads.clearHostCaches(event.id);
          generations.resetAll();
        }
        if (event.changes.includes("host-connected")) {
          for (const environmentId of watchedEnvironments.keys()) {
            invalidator.invalidate(environmentId, [
              gitStatusTag(environmentId),
              gitFilesTag(environmentId),
              gitRefsTag(environmentId),
            ]);
          }
        }
      },
    });
    return () => {
      stopThreads();
      stopEnvironments();
      stopHosts();
      threadEnvironments.clear();
    };
  }

  function watchEnvironment(environmentId: string, signal: AbortSignal): void {
    watchedEnvironments.set(
      environmentId,
      (watchedEnvironments.get(environmentId) ?? 0) + 1,
    );
    stopEnvironmentEvents ??= subscribeToChanges();
    signal.addEventListener(
      "abort",
      () => {
        const count = (watchedEnvironments.get(environmentId) ?? 1) - 1;
        if (count > 0) {
          watchedEnvironments.set(environmentId, count);
          return;
        }
        watchedEnvironments.delete(environmentId);
        invalidator.forget(environmentId);
        generations.forget(environmentId);
        reads.clearCaches(environmentId);
        servedStatus.delete(environmentId);
        if (watchedEnvironments.size > 0) return;
        stopEnvironmentEvents?.();
        stopEnvironmentEvents = null;
      },
      { once: true },
    );
  }

  async function workspaceDefaultBranch(
    environmentId: string,
  ): Promise<string | null> {
    const status = await reads
      .status(environmentId, { kind: "environment" }, "shared")
      .catch(() => null);
    return status?.outcome === "available"
      ? status.workspace.branch.defaultBranch
      : null;
  }

  bb.rpc.register(
    gitRpcContract,
    {
      async status({ keys }) {
        const results = await Promise.all(
          keys.map(
            async (environmentId): Promise<readonly [string, GitStatusRow]> => {
              const row = await statusRow(environmentId);
              servedStatus.set(environmentId, JSON.stringify(row));
              return [environmentId, row];
            },
          ),
        );
        return Object.fromEntries(results);
      },
      workspaceStatus: ({ environmentId, mergeBaseBranch }) =>
        reads.status(
          environmentId,
          {
            kind: "explicit",
            ...(mergeBaseBranch === undefined ? {} : { branch: mergeBaseBranch }),
          },
          "bypass",
        ),
      diff: ({ environmentId, target, maxDiffBytes, maxFileListBytes }) =>
        reads.diff(environmentId, target, {
          ...(maxDiffBytes === undefined ? {} : { maxDiffBytes }),
          ...(maxFileListBytes === undefined ? {} : { maxFileListBytes }),
        }),
      files: ({ environmentId, target, ignoreWhitespace }) => {
        return reads.files(environmentId, target, ignoreWhitespace, "shared");
      },
      async patches({ keys }) {
        const groups = new Map<string, { key: GitPatchKey; raw: string[] }>();
        const results: Record<string, GitPatchResult> = {};
        for (const raw of keys) {
          const key = parseGitPatchKey(raw);
          if (key === null) continue;
          const groupKey = patchGroupKey(key);
          const group = groups.get(groupKey);
          if (group === undefined) groups.set(groupKey, { key, raw: [raw] });
          else group.raw.push(raw);
        }
        await Promise.all(
          [...groups.values()].map(async ({ key, raw }) => {
            const keysByPath = new Map<string, string[]>();
            for (const entry of raw) {
              const parsed = parseGitPatchKey(entry);
              if (parsed === null) continue;
              keysByPath.set(parsed.path, [
                ...(keysByPath.get(parsed.path) ?? []),
                entry,
              ]);
            }
            const result = await reads.patches(
              key.environmentId,
              key.target,
              key.ignoreWhitespace,
              [...keysByPath.keys()],
              "shared",
            );
            if (result.outcome !== "available") {
              for (const entry of raw) results[entry] = result;
              return;
            }
            for (const patch of result.patches) {
              for (const entry of keysByPath.get(patch.path) ?? []) {
                results[entry] = { outcome: "available", patch };
              }
            }
          }),
        );
        return results;
      },
      fileSide: ({ environmentId, query }) =>
        reads.fileSide(environmentId, query),
      branches: ({ environmentId, query, limit, selectedBranch }) =>
        reads.branches({
          environmentId,
          limit: limit ?? DEFAULT_BRANCH_LIMIT,
          ...(query === undefined ? {} : { query }),
          ...(selectedBranch === undefined ? {} : { selectedBranch }),
        }),
      viewed: ({ environmentId, target, paths }) =>
        viewed.list(environmentId, target, paths),
      markViewed: ({ environmentId, target, path, revision }) =>
        viewed.mark(environmentId, target, path, revision),
      clearViewed: ({ environmentId, target, path }) =>
        viewed.clear(environmentId, target, path),
      async setMergeBase({ environmentId, mergeBaseBranch }) {
        const environment = await bb.sdk.environments.get({ environmentId });
        if (environment.status !== "ready" || environment.path === null) {
          return { ok: false as const, environmentStatus: environment.status };
        }
        const implicit = resolveEnvironmentMergeBaseBranch({
          mergeBaseBranch: null,
          baseBranch: environment.baseBranch,
          defaultBranch:
            (await workspaceDefaultBranch(environmentId)) ??
            environment.defaultBranch,
        });
        const persisted =
          mergeBaseBranch === null || mergeBaseBranch === implicit
            ? null
            : mergeBaseBranch;
        if (persisted !== environment.mergeBaseBranch) {
          await bb.sdk.environments.update({
            environmentId,
            mergeBaseBranch: persisted,
          });
          void statusRow(environmentId);
        }
        return { ok: true as const };
      },
      refresh({ environmentId }) {
        reads.clearCaches(environmentId);
        generations.reset(environmentId);
        bb.rpc.experimental_invalidate([
          gitStatusTag(environmentId),
          gitFilesTag(environmentId),
          gitRefsTag(environmentId),
        ]);
        return { ok: true as const };
      },
    },
    {
      experimental_discoverable: true,
      experimental_description:
        "Git status, changed files, diffs and Viewed marks for bb environments.",
    },
  );

  for (const method of [
    "status",
    "files",
    "patches",
    "branches",
    "viewed",
  ] as const) {
    bb.rpc.experimental_whileWatched(method, (read, signal) => {
      if ("key" in read) {
        const environmentId =
          method === "patches"
            ? parseGitPatchKey(read.key)?.environmentId
            : read.key;
        if (environmentId !== undefined) watchEnvironment(environmentId, signal);
        return;
      }
      const input = read.input;
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        typeof input.environmentId === "string"
      ) {
        watchEnvironment(input.environmentId, signal);
      }
    });
  }

  bb.cli.register(createGitCli(reads, viewed));
  bb.onDispose(() => {
    stopEnvironmentEvents?.();
    stopEnvironmentEvents = null;
    watchedEnvironments.clear();
    servedStatus.clear();
    invalidator.dispose();
  });
}
