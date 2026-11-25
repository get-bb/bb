import { resolveEnvironmentMergeBaseBranch } from "@bb/domain";
import {
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import {
  GIT_SHOW_CHANGES_SETTING,
  GIT_SHOW_COMMIT_BUTTON_SETTING,
  GIT_SNAPSHOT_MAX_FILE_LISTS,
  gitFilesTag,
  gitRefsTag,
  gitStatusTag,
  gitViewedTag,
  parseGitPatchKey,
  type GitFilesResult,
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
import {
  createGitReads,
  filesQueryKey,
  type GitFilesQuery,
} from "./server/reads.js";
import { createReadGenerations } from "./server/generations.js";
import { createGitViewed } from "./server/viewed.js";

const DEFAULT_BRANCH_LIMIT = 50;
const THREAD_ENVIRONMENT_CACHE_LIMIT = 1024;

function patchGroupKey(key: GitPatchKey): string {
  return JSON.stringify([key.environmentId, key.target, key.ignoreWhitespace]);
}

function filesFingerprint(result: GitFilesResult): string {
  if (result.outcome !== "available") return JSON.stringify(result);
  return JSON.stringify([
    result.repos,
    result.files,
    result.truncated,
    result.shortstat,
    result.mergeBaseRef,
  ]);
}

function servedOnly(served: ReadonlySet<string> | undefined, value: string) {
  return served !== undefined && served.size === 1 && served.has(value);
}

type WatchedMethod = "status" | "files" | "patches" | "branches" | "viewed";

export default function gitPlugin(bb: BbPluginApi): void {
  bb.settings.define({
    [GIT_SHOW_CHANGES_SETTING]: {
      type: "boolean",
      label: "Show Git changes above the composer",
      description: "Show changed files and the merge base above the composer.",
      default: true,
    },
    [GIT_SHOW_COMMIT_BUTTON_SETTING]: {
      type: "boolean",
      label: "Show Commit button",
      description: "Show Commit in the thread header and actions menu.",
      default: false,
    },
  });
  const watchedEnvironments = new Map<string, number>();
  const watchedStatus = new Map<string, number>();
  const watchedFiles = new Map<
    string,
    Map<string, { query: GitFilesQuery; count: number }>
  >();
  const servedStatus = new Map<string, Set<string>>();
  const servedFiles = new Map<string, Map<string, Set<string>>>();
  const probes = new Map<string, { pending: Set<string> }>();
  const generations = createReadGenerations((environmentId) =>
    watchedEnvironments.has(environmentId),
  );
  const reads = createGitReads(bb, generations.freshness);
  const invalidator = createCoalescedInvalidator(publish);
  const viewed = createGitViewed(bb, (environmentId) => {
    if (watchedEnvironments.has(environmentId))
      invalidator.invalidate(environmentId, [gitViewedTag(environmentId)]);
  });

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
    const watched = watchedEnvironments.has(environmentId);
    if (clearCaches) {
      generations.changed(environmentId, refsChanged);
      if (watched) {
        reads.clearUnwatchedFiles(
          environmentId,
          watchedFiles.get(environmentId),
        );
      } else {
        reads.clearCaches(environmentId);
      }
    }
    if (watched) invalidator.invalidate(environmentId, tags);
  }

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

  function publish(environmentId: string, tags: readonly string[]): void {
    const probed = new Set(
      tags.filter(
        (tag) =>
          tag === gitStatusTag(environmentId) ||
          tag === gitFilesTag(environmentId),
      ),
    );
    const direct = tags.filter((tag) => !probed.has(tag));
    if (direct.length > 0) bb.rpc.experimental_invalidate(direct);
    if (probed.size > 0) runProbe(environmentId, probed);
  }

  function runProbe(environmentId: string, tags: ReadonlySet<string>): void {
    const running = probes.get(environmentId);
    if (running !== undefined) {
      for (const tag of tags) running.pending.add(tag);
      return;
    }
    const state = { pending: new Set<string>() };
    probes.set(environmentId, state);
    void changedTags(environmentId, tags)
      .catch(() => {
        reads.clearCaches(environmentId);
        return [...tags];
      })
      .then((changed) => {
        if (probes.get(environmentId) !== state) return;
        probes.delete(environmentId);
        if (changed.length > 0) {
          if (changed.includes(gitStatusTag(environmentId))) {
            servedStatus.delete(environmentId);
          }
          if (changed.includes(gitFilesTag(environmentId))) {
            servedFiles.delete(environmentId);
          }
          bb.rpc.experimental_invalidate(changed);
        }
        if (state.pending.size > 0) {
          invalidator.invalidate(environmentId, [...state.pending]);
        }
      });
  }

  async function changedTags(
    environmentId: string,
    tags: ReadonlySet<string>,
  ): Promise<string[]> {
    const statusTag = gitStatusTag(environmentId);
    const filesTag = gitFilesTag(environmentId);
    const changed: string[] = [];
    const probeStatus =
      tags.has(statusTag) && (watchedStatus.get(environmentId) ?? 0) > 0;
    if (tags.has(statusTag) && !probeStatus) changed.push(statusTag);
    const queries = [...(watchedFiles.get(environmentId)?.values() ?? [])].map(
      (entry) => entry.query,
    );
    const probeFiles =
      tags.has(filesTag) &&
      queries.length > 0 &&
      queries.length <= GIT_SNAPSHOT_MAX_FILE_LISTS;
    if (tags.has(filesTag) && !probeFiles) changed.push(filesTag);
    if (changed.length > 0) reads.clearCaches(environmentId);
    if (!probeStatus && !probeFiles) return changed;
    const snapshot = await reads.snapshot(
      environmentId,
      probeFiles ? queries : [],
    );
    if (
      probeStatus &&
      !servedOnly(
        servedStatus.get(environmentId),
        JSON.stringify(snapshot.status),
      )
    ) {
      changed.push(statusTag);
    }
    if (probeFiles) {
      const served = servedFiles.get(environmentId);
      const filesChanged = queries.some((query, index) => {
        const result = snapshot.files[index];
        return (
          result === undefined ||
          !servedOnly(
            served?.get(filesQueryKey(query)),
            filesFingerprint(result),
          )
        );
      });
      if (filesChanged) changed.push(filesTag);
    }
    return changed;
  }

  function rememberStatus(environmentId: string, row: GitStatusRow): void {
    if ((watchedStatus.get(environmentId) ?? 0) === 0) return;
    const served = servedStatus.get(environmentId) ?? new Set<string>();
    served.add(JSON.stringify(row));
    servedStatus.set(environmentId, served);
  }

  function rememberFiles(
    environmentId: string,
    query: GitFilesQuery,
    result: GitFilesResult,
  ): void {
    const key = filesQueryKey(query);
    if (watchedFiles.get(environmentId)?.has(key) !== true) return;
    const byQuery = servedFiles.get(environmentId) ?? new Map();
    const served = byQuery.get(key) ?? new Set<string>();
    served.add(filesFingerprint(result));
    byQuery.set(key, served);
    servedFiles.set(environmentId, byQuery);
  }

  function turnEnded(environmentId: string | null): void {
    if (environmentId === null || !watchedEnvironments.has(environmentId)) {
      return;
    }
    generations.changed(environmentId, false);
    reads.clearCaches(environmentId);
    runProbe(
      environmentId,
      new Set([gitStatusTag(environmentId), gitFilesTag(environmentId)]),
    );
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

  function watchFilesQuery(
    environmentId: string,
    query: GitFilesQuery,
    signal: AbortSignal,
  ): void {
    const key = filesQueryKey(query);
    const byQuery = watchedFiles.get(environmentId) ?? new Map();
    const entry = byQuery.get(key) ?? { query, count: 0 };
    entry.count += 1;
    byQuery.set(key, entry);
    watchedFiles.set(environmentId, byQuery);
    signal.addEventListener(
      "abort",
      () => {
        entry.count -= 1;
        if (entry.count > 0 || byQuery.get(key) !== entry) return;
        byQuery.delete(key);
        reads.clearUnwatchedFiles(environmentId, byQuery);
        servedFiles.get(environmentId)?.delete(key);
        if (byQuery.size > 0) return;
        if (watchedFiles.get(environmentId) === byQuery) {
          watchedFiles.delete(environmentId);
        }
      },
      { once: true },
    );
  }

  function watchEnvironment(
    environmentId: string,
    method: WatchedMethod,
    signal: AbortSignal,
  ): void {
    watchedEnvironments.set(
      environmentId,
      (watchedEnvironments.get(environmentId) ?? 0) + 1,
    );
    if (method === "status") {
      watchedStatus.set(
        environmentId,
        (watchedStatus.get(environmentId) ?? 0) + 1,
      );
    }
    stopEnvironmentEvents ??= subscribeToChanges();
    signal.addEventListener(
      "abort",
      () => {
        if (method === "status") {
          const statusCount = (watchedStatus.get(environmentId) ?? 1) - 1;
          if (statusCount > 0) watchedStatus.set(environmentId, statusCount);
          else {
            watchedStatus.delete(environmentId);
            servedStatus.delete(environmentId);
          }
        }
        const count = (watchedEnvironments.get(environmentId) ?? 1) - 1;
        if (count > 0) {
          watchedEnvironments.set(environmentId, count);
          return;
        }
        watchedEnvironments.delete(environmentId);
        invalidator.forget(environmentId);
        generations.forget(environmentId);
        reads.clearCaches(environmentId);
        probes.delete(environmentId);
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
              rememberStatus(environmentId, row);
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
            ...(mergeBaseBranch === undefined
              ? {}
              : { branch: mergeBaseBranch }),
          },
          "bypass",
        ),
      diff: ({ environmentId, target, maxDiffBytes, maxFileListBytes }) =>
        reads.diff(environmentId, target, {
          ...(maxDiffBytes === undefined ? {} : { maxDiffBytes }),
          ...(maxFileListBytes === undefined ? {} : { maxFileListBytes }),
        }),
      async files({ environmentId, target, ignoreWhitespace }) {
        const result = await reads.files(
          environmentId,
          target,
          ignoreWhitespace,
          "shared",
        );
        rememberFiles(environmentId, { target, ignoreWhitespace }, result);
        return result;
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
      repos: ({ environmentId }) => reads.repos(environmentId),
      branches: ({ environmentId, query, limit, selectedBranch }) =>
        reads.branches({
          environmentId,
          limit: limit ?? DEFAULT_BRANCH_LIMIT,
          ...(query === undefined ? {} : { query }),
          ...(selectedBranch === undefined ? {} : { selectedBranch }),
        }),
      fetchRemoteBranches: ({ environmentId }) =>
        reads.fetchRemoteBranches(environmentId),
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
        if (environmentId !== undefined) {
          watchEnvironment(environmentId, method, signal);
        }
        return;
      }
      if (method === "files") {
        const parsed = gitRpcContract.files.input.safeParse(read.input);
        if (!parsed.success) return;
        const { environmentId, target, ignoreWhitespace } = parsed.data;
        watchEnvironment(environmentId, method, signal);
        watchFilesQuery(environmentId, { target, ignoreWhitespace }, signal);
        return;
      }
      const input = read.input;
      if (
        typeof input === "object" &&
        input !== null &&
        !Array.isArray(input) &&
        typeof input.environmentId === "string"
      ) {
        watchEnvironment(input.environmentId, method, signal);
      }
    });
  }

  bb.cli.register(createGitCli(reads, viewed));
  bb.onDispose(() => {
    stopEnvironmentEvents?.();
    stopEnvironmentEvents = null;
    watchedEnvironments.clear();
    watchedStatus.clear();
    watchedFiles.clear();
    servedStatus.clear();
    servedFiles.clear();
    probes.clear();
    invalidator.dispose();
  });
}
