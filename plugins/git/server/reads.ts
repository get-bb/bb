import {
  experimental_BbHttpError,
  experimental_PluginRpcRefusal,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import {
  GIT_DIFF_MAX_DIFF_BYTES,
  GIT_DIFF_MAX_FILE_LIST_BYTES,
  gitHostContract,
  type DiffPatchEntry,
  type GitDiffResult,
  type GitFileSideResult,
  type GitFileSideQuery,
  type GitDiffRepo,
  type GitFilesResult,
  type GitHostFiles,
  type GitReadFreshness,
  type GitRepoFilesResult,
  type GitStatusResult,
  type WorkspaceDiffTarget,
  gitDiffRepoPath,
  locateGitDiffRepoPath,
} from "../contract.js";
import {
  joinHostPath,
  resolveEnvironmentMergeBaseBranch,
  type GitBranchOptions,
} from "@bb/domain";
import { createAsyncTtlMemo } from "@bb/async-cache";
import { ByteBudgetCache } from "../host/byte-budget-cache.js";

const READ_CACHE_TTL_MS = 3_000;
const READ_CACHE_MAX_ENTRIES = 1_024;
const HOST_CALL_TIMEOUT_MS = 30_000;
const LAST_READS_MAX_BYTES = 32 * 1024 * 1024;

type Environment = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["get"]>
>;

type EnvironmentRepo = Awaited<
  ReturnType<BbPluginApi["sdk"]["environments"]["experimental_repos"]>
>["repos"][number];

interface GitEnvironmentRepos {
  hostId: string;
  repos: EnvironmentRepo[];
}

interface ReadyGitEnvironment {
  environment: Environment;
  hostId: string;
  path: string;
}

const NOT_APPLICABLE_MESSAGES = {
  status: "Workspace status is not available for non-git environments",
  diff: "Workspace diff is not available for non-git environments",
} as const;

function notApplicable(kind: keyof typeof NOT_APPLICABLE_MESSAGES) {
  return {
    outcome: "not_applicable" as const,
    reason: "non_git_environment" as const,
    message: NOT_APPLICABLE_MESSAGES[kind],
  };
}

function workspaceUnavailableMessage(environment: Environment): string {
  switch (environment.status) {
    case "creating":
    case "provisioning":
      return "Workspace is still starting.";
    case "error":
      return "Workspace setup failed.";
    case "destroyed":
      return "Workspace no longer exists.";
    case "ready":
      return "Workspace is unavailable.";
  }
}

function requireWorkspacePath(environment: Environment): string {
  if (environment.status !== "ready" || environment.path === null) {
    throw new experimental_PluginRpcRefusal({
      code: "conflict",
      message: workspaceUnavailableMessage(environment),
    });
  }
  return environment.path;
}

const FILE_READ_FAILURE_CODES = [
  "ENOENT",
  "invalid_path",
  "file_too_large",
] as const;

function fileReadFailure(error: unknown): {
  code: (typeof FILE_READ_FAILURE_CODES)[number];
  message: string;
} | null {
  if (!(error instanceof experimental_BbHttpError)) return null;
  const code = FILE_READ_FAILURE_CODES.find((known) => known === error.code);
  if (code === undefined) return null;
  const body = error.body;
  const message =
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
      ? body.message
      : error.message;
  return { code, message };
}

export async function requireGitEnvironment(
  bb: BbPluginApi,
  environmentId: string,
): Promise<Environment> {
  try {
    return await bb.sdk.environments.get({ environmentId });
  } catch (error) {
    if (error instanceof experimental_BbHttpError && error.status === 404) {
      throw new experimental_PluginRpcRefusal({
        code: "not_found",
        message: `Environment not found: ${environmentId}`,
      });
    }
    throw error;
  }
}

const KEY_SEPARATOR = "\u0000";

function readKey(
  environmentId: string,
  hostId: string,
  path: string,
  queryKey: string,
): string {
  return [environmentId, hostId, path, queryKey].join(KEY_SEPARATOR);
}

type WatchedQueryKeys = Pick<ReadonlySet<string>, "has">;

function createReadMemo<T extends { outcome: string }>() {
  const memo = createAsyncTtlMemo<string, T>({
    ttlMs: (value) => (value.outcome === "available" ? READ_CACHE_TTL_MS : 0),
    maxEntries: READ_CACHE_MAX_ENTRIES,
  });
  return {
    read(
      key: string,
      cache: ReadCacheUse | "replace",
      load: () => Promise<T>,
    ): Promise<T> {
      if (cache === "bypass") return load();
      if (cache === "replace") memo.invalidateWhere((known) => known === key);
      return memo.run(key, load);
    },
    clear(environmentId: string, keep?: WatchedQueryKeys): void {
      memo.invalidateWhere(
        (key) =>
          key.startsWith(`${environmentId}${KEY_SEPARATOR}`) &&
          !keep?.has(key.slice(key.lastIndexOf(KEY_SEPARATOR) + 1)),
      );
    },
    clearHost(hostId: string): void {
      memo.invalidateWhere((key) => key.split(KEY_SEPARATOR)[1] === hostId);
    },
  };
}

export type ReadCacheUse = "shared" | "bypass";

type AvailableRepoFiles = Extract<GitRepoFilesResult, { outcome: "available" }>;
type AvailableStatus = Extract<GitStatusResult, { outcome: "available" }>;

interface LastRead<T> {
  fingerprint: string;
  result: T;
}

const STATUS_APPROXIMATE_BYTES = 64 * 1024;
const FILE_ENTRY_APPROXIMATE_BYTES = 256;

function approximateBytes(
  result: AvailableRepoFiles | AvailableStatus,
): number {
  if (!("initialPatches" in result)) return STATUS_APPROXIMATE_BYTES;
  return result.initialPatches.reduce(
    (total, patch) => total + patch.patch.length,
    result.files.length * FILE_ENTRY_APPROXIMATE_BYTES,
  );
}

export interface GitFilesQuery {
  target: WorkspaceDiffTarget;
  ignoreWhitespace: boolean;
}

export function filesQueryKey(query: GitFilesQuery): string {
  return JSON.stringify([query.target, query.ignoreWhitespace]);
}

export interface GitSnapshot {
  status: GitStatusResult;
  files: GitFilesResult[];
}

interface RepoFilesRead {
  repo: EnvironmentRepo;
  result: GitRepoFilesResult | null;
}

function mergeRepoFiles(perRepo: readonly RepoFilesRead[]): GitFilesResult {
  const [only] = perRepo;
  if (
    perRepo.length === 1 &&
    only !== undefined &&
    only.result !== null &&
    only.result.outcome !== "available"
  ) {
    return only.result;
  }
  const repos: GitDiffRepo[] = perRepo.map(({ repo, result }) => ({
    label: repo.label,
    rootPath: repo.rootPath,
    source: repo.source,
    error:
      result === null || result.outcome === "available"
        ? null
        : result.outcome === "unavailable"
          ? result.failure.message
          : result.message,
  }));
  const available = perRepo.flatMap(({ repo, result }) =>
    result !== null && result.outcome === "available"
      ? [{ repo, files: result }]
      : [],
  );
  return {
    outcome: "available",
    repos,
    files: available.flatMap(({ repo, files }) =>
      files.files.map((entry) => ({
        ...entry,
        path: gitDiffRepoPath(repo, entry.path),
        previousPath:
          entry.previousPath === null
            ? null
            : gitDiffRepoPath(repo, entry.previousPath),
      })),
    ),
    truncated: available.some(({ files }) => files.truncated),
    shortstat:
      available.length === 1 && available[0]?.repo.label === ""
        ? available[0].files.shortstat
        : available
            .filter(({ files }) => files.shortstat.trim().length > 0)
            .map(({ repo, files }) =>
              repo.label.length === 0
                ? files.shortstat.trim()
                : `${repo.label}: ${files.shortstat.trim()}`,
            )
            .join("; "),
    mergeBaseRef:
      available.find(({ repo }) => repo.source === "main")?.files
        .mergeBaseRef ?? null,
    initialPatches: available.flatMap(({ repo, files }) =>
      files.initialPatches.map((patch) => ({
        ...patch,
        path: gitDiffRepoPath(repo, patch.path),
      })),
    ),
  };
}

export interface GitReads {
  status(
    environmentId: string,
    mergeBase: { kind: "environment" } | { kind: "explicit"; branch?: string },
    cache: ReadCacheUse,
  ): Promise<GitStatusResult>;
  diff(
    environmentId: string,
    target: WorkspaceDiffTarget,
    limits?: { maxDiffBytes?: number; maxFileListBytes?: number },
  ): Promise<GitDiffResult>;
  files(
    environmentId: string,
    target: WorkspaceDiffTarget,
    ignoreWhitespace: boolean,
    cache: ReadCacheUse,
  ): Promise<GitFilesResult>;
  patches(
    environmentId: string,
    target: WorkspaceDiffTarget,
    ignoreWhitespace: boolean,
    paths: string[],
    cache: ReadCacheUse,
  ): Promise<
    | { outcome: "available"; patches: DiffPatchEntry[] }
    | Exclude<GitFilesResult, { outcome: "available" }>
  >;
  snapshot(
    environmentId: string,
    files: readonly GitFilesQuery[],
  ): Promise<GitSnapshot>;
  fileSide(
    environmentId: string,
    query: GitFileSideQuery,
  ): Promise<GitFileSideResult>;
  repos(
    environmentId: string,
  ): Promise<{ repos: Omit<GitDiffRepo, "error">[] }>;
  branches(args: {
    environmentId: string;
    query?: string;
    limit: number;
    selectedBranch?: string;
  }): Promise<GitBranchOptions>;
  fetchRemoteBranches(environmentId: string): Promise<{ ok: true }>;
  clearUnwatchedFiles(
    environmentId: string,
    watched: WatchedQueryKeys | undefined,
  ): void;
  clearCaches(environmentId: string): void;
  clearHostCaches(hostId: string): void;
}

function createHostClient(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: gitHostContract });
  return {
    call<Method extends keyof typeof gitHostContract & string>(
      method: Method,
      input: Parameters<typeof host.call<Method>>[1],
      hostId: string,
    ) {
      return host.call(method, input, {
        hostId,
        timeoutMs: HOST_CALL_TIMEOUT_MS,
      });
    },
  };
}

function resolveFileSideRef(query: GitFileSideQuery): string | null {
  switch (query.target) {
    case "uncommitted":
      return query.side === "old" ? "HEAD" : null;
    case "branch_committed":
      return query.side === "old" ? query.mergeBaseRef : "HEAD";
    case "all":
      return query.side === "old" ? query.mergeBaseRef : null;
    case "commit":
      return query.side === "old" ? `${query.sha}^` : query.sha;
  }
}

export function createGitReads(
  bb: BbPluginApi,
  freshness: (environmentId: string, shared: boolean) => GitReadFreshness,
): GitReads {
  const host = createHostClient(bb);
  const statusCache = createReadMemo<GitStatusResult>();
  const filesCache = createReadMemo<GitRepoFilesResult>();
  const lastFiles = new ByteBudgetCache<LastRead<AvailableRepoFiles>>(
    LAST_READS_MAX_BYTES,
  );
  const lastStatus = new ByteBudgetCache<LastRead<AvailableStatus>>(
    LAST_READS_MAX_BYTES,
  );

  function filesRequest(key: string, query: GitFilesQuery) {
    const last = lastFiles.get(key);
    const revisionByPath = new Map(
      (last?.result.files ?? []).map((file) => [file.path, file.revision]),
    );
    const knownPatches = new Map(
      (last?.result.initialPatches ?? []).flatMap((patch) => {
        const revision = revisionByPath.get(patch.path);
        return revision === undefined
          ? []
          : [[patch.path, { revision, patch }] as const];
      }),
    );
    return {
      input: {
        target: query.target,
        ignoreWhitespace: query.ignoreWhitespace,
        knownPatches: [...knownPatches].map(([path, { revision }]) => ({
          path,
          revision,
        })),
      },
      unless: last?.fingerprint,
      complete(
        result:
          | { outcome: "available"; value: GitHostFiles; fingerprint: string }
          | { outcome: "unchanged" }
          | Extract<GitRepoFilesResult, { outcome: "unavailable" }>,
      ): GitRepoFilesResult {
        if (result.outcome === "unchanged") {
          if (last === undefined) {
            throw new Error(
              "The host reported an unrequested unchanged file list.",
            );
          }
          lastFiles.set(key, last, approximateBytes(last.result));
          return last.result;
        }
        if (result.outcome !== "available") return result;
        const { reusedPatchPaths, ...value } = result.value;
        const available: AvailableRepoFiles = {
          outcome: "available",
          ...value,
          initialPatches: [
            ...value.initialPatches,
            ...reusedPatchPaths.flatMap((path) => {
              const patch = knownPatches.get(path)?.patch;
              return patch === undefined ? [] : [patch];
            }),
          ],
        };
        lastFiles.set(
          key,
          { fingerprint: result.fingerprint, result: available },
          approximateBytes(available),
        );
        return available;
      },
    };
  }

  function statusKey(
    environmentId: string,
    hostId: string,
    path: string,
    mergeBaseBranch: string | undefined,
  ): string {
    return readKey(
      environmentId,
      hostId,
      path,
      JSON.stringify(mergeBaseBranch ?? null),
    );
  }

  function repoFilesKey(
    environmentId: string,
    hostId: string,
    repo: EnvironmentRepo,
    query: GitFilesQuery,
  ): string {
    return readKey(environmentId, hostId, repo.rootPath, filesQueryKey(query));
  }

  async function requireReady(
    environmentId: string,
  ): Promise<ReadyGitEnvironment | null> {
    const environment = await requireGitEnvironment(bb, environmentId);
    const path = requireWorkspacePath(environment);
    if (!environment.isGitRepo) return null;
    return { environment, hostId: environment.hostId, path };
  }

  async function requireRepos(
    environmentId: string,
  ): Promise<GitEnvironmentRepos | null> {
    const environment = await requireGitEnvironment(bb, environmentId);
    requireWorkspacePath(environment);
    const { repos } = await bb.sdk.environments.experimental_repos({
      environmentId,
    });
    return repos.length === 0 ? null : { hostId: environment.hostId, repos };
  }

  function repoStatus(
    environmentId: string,
    hostId: string,
    repo: EnvironmentRepo,
    cache: ReadCacheUse,
  ): Promise<GitStatusResult> {
    return statusCache.read(
      statusKey(environmentId, hostId, repo.rootPath, undefined),
      cache,
      async () => {
        const result = await host.call(
          "status",
          {
            path: repo.rootPath,
            freshness: freshness(environmentId, cache === "shared"),
          },
          hostId,
        );
        return result.outcome === "available"
          ? { outcome: "available", workspace: result.value }
          : result;
      },
    );
  }

  async function targetForRepo(
    environmentId: string,
    hostId: string,
    repo: EnvironmentRepo,
    target: WorkspaceDiffTarget,
    cache: ReadCacheUse,
  ): Promise<WorkspaceDiffTarget | null> {
    if (repo.source === "main") return target;
    switch (target.type) {
      case "uncommitted":
        return target;
      case "commit":
        return null;
      case "branch_committed":
      case "all": {
        const status = await repoStatus(environmentId, hostId, repo, cache);
        return status.outcome === "available"
          ? {
              type: target.type,
              mergeBaseBranch: status.workspace.branch.defaultBranch,
            }
          : { type: "uncommitted" };
      }
    }
  }

  function repoFiles(
    environmentId: string,
    hostId: string,
    repo: EnvironmentRepo,
    target: WorkspaceDiffTarget,
    ignoreWhitespace: boolean,
    cache: ReadCacheUse,
  ): Promise<GitRepoFilesResult> {
    const key = repoFilesKey(environmentId, hostId, repo, {
      target,
      ignoreWhitespace,
    });
    return filesCache.read(key, cache, async () => {
      const request = filesRequest(key, { target, ignoreWhitespace });
      return request.complete(
        await host.call(
          "files",
          {
            path: repo.rootPath,
            freshness: freshness(environmentId, cache === "shared"),
            ...request.input,
          },
          hostId,
        ),
      );
    });
  }

  async function repoMergeBaseRef(
    environmentId: string,
    ready: GitEnvironmentRepos,
    repo: EnvironmentRepo,
    target: WorkspaceDiffTarget,
  ): Promise<string | null> {
    const repoTarget = await targetForRepo(
      environmentId,
      ready.hostId,
      repo,
      target,
      "shared",
    );
    if (repoTarget === null) return null;
    const files = await repoFiles(
      environmentId,
      ready.hostId,
      repo,
      repoTarget,
      false,
      "shared",
    );
    return files.outcome === "available" ? files.mergeBaseRef : null;
  }

  async function fileSideRef(
    environmentId: string,
    ready: GitEnvironmentRepos,
    repo: EnvironmentRepo,
    query: GitFileSideQuery,
  ): Promise<string | null | undefined> {
    if (repo.source === "main") return resolveFileSideRef(query);
    switch (query.target) {
      case "uncommitted":
        return resolveFileSideRef(query);
      case "commit":
        return undefined;
      case "branch_committed":
      case "all": {
        const mergeBaseRef = await repoMergeBaseRef(
          environmentId,
          ready,
          repo,
          {
            type: query.target,
            mergeBaseBranch: "HEAD",
          },
        );
        if (mergeBaseRef === null) return undefined;
        return resolveFileSideRef({ ...query, mergeBaseRef });
      }
    }
  }

  return {
    async status(environmentId, mergeBase, cache) {
      const ready = await requireReady(environmentId);
      if (ready === null) return notApplicable("status");
      const mergeBaseBranch =
        mergeBase.kind === "environment"
          ? resolveEnvironmentMergeBaseBranch(ready.environment)
          : mergeBase.branch;
      return statusCache.read(
        statusKey(environmentId, ready.hostId, ready.path, mergeBaseBranch),
        cache,
        async () => {
          const result = await host.call(
            "status",
            {
              path: ready.path,
              freshness: freshness(environmentId, cache === "shared"),
              ...(mergeBaseBranch === undefined ? {} : { mergeBaseBranch }),
            },
            ready.hostId,
          );
          return result.outcome === "available"
            ? { outcome: "available", workspace: result.value }
            : result;
        },
      );
    },
    async diff(environmentId, target, limits = {}) {
      const ready = await requireReady(environmentId);
      if (ready === null) return notApplicable("diff");
      const result = await host.call(
        "diff",
        {
          path: ready.path,
          freshness: freshness(environmentId, false),
          target,
          maxDiffBytes: limits.maxDiffBytes ?? GIT_DIFF_MAX_DIFF_BYTES,
          maxFileListBytes:
            limits.maxFileListBytes ?? GIT_DIFF_MAX_FILE_LIST_BYTES,
        },
        ready.hostId,
      );
      return result.outcome === "available"
        ? { outcome: "available", diff: result.value }
        : result;
    },
    async files(environmentId, target, ignoreWhitespace, cache) {
      const ready = await requireRepos(environmentId);
      if (ready === null) return notApplicable("diff");
      const perRepo = await Promise.all(
        ready.repos.map(async (repo) => {
          const repoTarget = await targetForRepo(
            environmentId,
            ready.hostId,
            repo,
            target,
            cache,
          );
          const result =
            repoTarget === null
              ? null
              : await repoFiles(
                  environmentId,
                  ready.hostId,
                  repo,
                  repoTarget,
                  ignoreWhitespace,
                  cache,
                );
          return { repo, result };
        }),
      );
      return mergeRepoFiles(perRepo);
    },
    async snapshot(environmentId, files) {
      const ready = await requireReady(environmentId);
      const repos =
        files.length === 0 ? null : await requireRepos(environmentId);
      const hostId = ready?.hostId ?? repos?.hostId;
      if (hostId === undefined) {
        return {
          status: notApplicable("status"),
          files: files.map(() => notApplicable("diff")),
        };
      }
      const groups = new Map<
        string,
        {
          mergeBaseBranch: string | undefined;
          files: Map<string, ReturnType<typeof filesRequest>>;
        }
      >();
      function group(path: string, mergeBaseBranch: string | undefined) {
        const known = groups.get(path);
        if (known !== undefined) return known;
        const created = { mergeBaseBranch, files: new Map() };
        groups.set(path, created);
        return created;
      }
      if (ready !== null) {
        group(ready.path, resolveEnvironmentMergeBaseBranch(ready.environment));
      }
      const reposByQuery = await Promise.all(
        files.map((query) =>
          Promise.all(
            (repos?.repos ?? []).map(async (repo) => {
              const target = await targetForRepo(
                environmentId,
                hostId,
                repo,
                query.target,
                "shared",
              );
              if (target === null) return { repo, key: null };
              const repoQuery = {
                target,
                ignoreWhitespace: query.ignoreWhitespace,
              };
              const key = repoFilesKey(environmentId, hostId, repo, repoQuery);
              const entries = group(repo.rootPath, undefined).files;
              if (!entries.has(key)) {
                entries.set(key, filesRequest(key, repoQuery));
              }
              return { repo, key };
            }),
          ),
        ),
      );
      const statuses: Promise<GitStatusResult>[] = [];
      let mainStatus: Promise<GitStatusResult> = Promise.resolve(
        notApplicable("status"),
      );
      const fileLists = new Map<string, Promise<GitRepoFilesResult>>();
      for (const [path, { mergeBaseBranch, files: entries }] of groups) {
        const key = statusKey(environmentId, hostId, path, mergeBaseBranch);
        const knownStatus = lastStatus.get(key);
        const requests = [...entries.values()];
        const call = host.call(
          "snapshot",
          {
            path,
            freshness: freshness(environmentId, true),
            ...(mergeBaseBranch === undefined ? {} : { mergeBaseBranch }),
            ...(knownStatus === undefined
              ? {}
              : { statusUnless: knownStatus.fingerprint }),
            files: requests.map((request) => ({
              ...request.input,
              ...(request.unless === undefined
                ? {}
                : { unless: request.unless }),
            })),
          },
          hostId,
        );
        const statusRead = statusCache.read(
          key,
          "replace",
          async (): Promise<GitStatusResult> => {
            const result = await call;
            if (result.outcome !== "available") return result;
            const part = result.value.status;
            switch (part.outcome) {
              case "unavailable":
                return part;
              case "unchanged":
                if (knownStatus === undefined) {
                  throw new Error(
                    "The host reported an unrequested unchanged status.",
                  );
                }
                lastStatus.set(
                  key,
                  knownStatus,
                  approximateBytes(knownStatus.result),
                );
                return knownStatus.result;
              case "available": {
                const available: AvailableStatus = {
                  outcome: "available",
                  workspace: part.value,
                };
                lastStatus.set(
                  key,
                  { fingerprint: part.fingerprint, result: available },
                  approximateBytes(available),
                );
                return available;
              }
            }
          },
        );
        statuses.push(statusRead);
        if (path === ready?.path) mainStatus = statusRead;
        [...entries.keys()].forEach((filesKey, index) => {
          fileLists.set(
            filesKey,
            filesCache.read(filesKey, "replace", async () => {
              const result = await call;
              if (result.outcome !== "available") return result;
              const read = result.value.files[index];
              const request = requests[index];
              if (read === undefined || request === undefined) {
                throw new Error("Snapshot is missing a file list.");
              }
              return request.complete(read);
            }),
          );
        });
      }
      function fileList(key: string): Promise<GitRepoFilesResult> {
        const read = fileLists.get(key);
        if (read === undefined)
          throw new Error("Snapshot is missing a file list.");
        return read;
      }
      const merged = Promise.all(
        reposByQuery.map(async (perRepo) => {
          if (repos === null) return notApplicable("diff");
          return mergeRepoFiles(
            await Promise.all(
              perRepo.map(async ({ repo, key }) => ({
                repo,
                result: key === null ? null : await fileList(key),
              })),
            ),
          );
        }),
      );
      const [statusResult, fileResults] = await Promise.all([
        mainStatus,
        merged,
        Promise.all(statuses),
      ]);
      return { status: statusResult, files: fileResults };
    },
    async patches(environmentId, target, ignoreWhitespace, paths, cache) {
      const ready = await requireRepos(environmentId);
      if (ready === null) return notApplicable("diff");
      const readFreshness = freshness(environmentId, cache === "shared");
      const pathsByRepo = new Map<EnvironmentRepo, string[]>();
      for (const path of paths) {
        const located = locateGitDiffRepoPath(ready.repos, path);
        if (located === null) continue;
        pathsByRepo.set(located.repo, [
          ...(pathsByRepo.get(located.repo) ?? []),
          located.relativePath,
        ]);
      }
      const patches: DiffPatchEntry[] = [];
      for (const [repo, repoPaths] of pathsByRepo) {
        const repoTarget = await targetForRepo(
          environmentId,
          ready.hostId,
          repo,
          target,
          cache,
        );
        if (repoTarget === null) continue;
        let pending = repoPaths;
        while (pending.length > 0) {
          const result = await host.call(
            "patches",
            {
              path: repo.rootPath,
              freshness: readFreshness,
              target: repoTarget,
              ignoreWhitespace,
              paths: pending,
            },
            ready.hostId,
          );
          if (result.outcome !== "available") {
            if (pathsByRepo.size === 1) return result;
            break;
          }
          if (result.value.patches.length === 0) break;
          patches.push(
            ...result.value.patches.map((patch) => ({
              ...patch,
              path: gitDiffRepoPath(repo, patch.path),
            })),
          );
          pending = result.value.deferred;
        }
      }
      return { outcome: "available", patches };
    },
    async repos(environmentId) {
      const environment = await requireGitEnvironment(bb, environmentId);
      if (environment.status !== "ready" || environment.path === null) {
        return { repos: [] };
      }
      const { repos } = await bb.sdk.environments.experimental_repos({
        environmentId,
      });
      return {
        repos: repos.map(({ label, rootPath, source }) => ({
          label,
          rootPath,
          source,
        })),
      };
    },
    async fileSide(environmentId, query) {
      const environment = await requireGitEnvironment(bb, environmentId);
      requireWorkspacePath(environment);
      const ready = await requireRepos(environmentId);
      const located =
        ready === null
          ? null
          : locateGitDiffRepoPath(ready.repos, query.path.replace(/^\/+/u, ""));
      const relativePath = located?.relativePath ?? "";
      if (
        ready === null ||
        located === null ||
        relativePath.length === 0 ||
        relativePath.split("/").includes("..")
      ) {
        return {
          outcome: "unavailable",
          code: "invalid_path",
          message: "Invalid path",
        };
      }
      const rootPath = located.repo.rootPath;
      const path = joinHostPath({ rootPath, relativePath });
      if (path === null) {
        return {
          outcome: "unavailable",
          code: "invalid_path",
          message: "Invalid path",
        };
      }
      const ref = await fileSideRef(environmentId, ready, located.repo, query);
      if (ref === undefined) {
        return {
          outcome: "unavailable",
          code: "ENOENT",
          message: "This side of the file is not available",
        };
      }
      try {
        const file = await bb.sdk.files.read({
          hostId: environment.hostId,
          path,
          rootPath,
          ...(ref === null ? {} : { ref }),
        });
        return {
          outcome: "available",
          file: {
            path: file.path,
            content: file.content,
            contentEncoding: file.contentEncoding,
            ...(file.mimeType ? { mimeType: file.mimeType } : {}),
            sizeBytes: file.sizeBytes,
          },
        };
      } catch (error) {
        const failure = fileReadFailure(error);
        if (failure === null) throw error;
        return { outcome: "unavailable", ...failure };
      }
    },
    async branches({ environmentId, query, limit, selectedBranch }) {
      const environment = await requireGitEnvironment(bb, environmentId);
      const path = requireWorkspacePath(environment);
      return host.call(
        "branches",
        {
          path,
          limit,
          ...(query === undefined ? {} : { query }),
          ...(selectedBranch === undefined ? {} : { selectedBranch }),
        },
        environment.hostId,
      );
    },
    async fetchRemoteBranches(environmentId) {
      const environment = await requireGitEnvironment(bb, environmentId);
      return host.call(
        "fetchRemoteBranches",
        { path: requireWorkspacePath(environment) },
        environment.hostId,
      );
    },
    clearUnwatchedFiles(environmentId, watched) {
      filesCache.clear(environmentId, watched);
    },
    clearCaches(environmentId) {
      statusCache.clear(environmentId);
      filesCache.clear(environmentId);
    },
    clearHostCaches(hostId) {
      statusCache.clearHost(hostId);
      filesCache.clearHost(hostId);
    },
  };
}
