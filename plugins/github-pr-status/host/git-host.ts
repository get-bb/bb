import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  experimental_runVcsProcess as runVcsProcess,
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
  type ExperimentalVcsProcessPriority,
} from "@get-bb/plugin-sdk/host";
import {
  runGit,
  type GitCommandResult,
} from "bb-environment-provider-host/git";
import {
  gitHubPullRequestViewSchema,
  type GitHubPullRequestCheck,
  type GitHubPullRequestMergeStateStatus,
  type GitHubPullRequestMergeable,
  type GitHubPullRequestReviewDecision,
  type GitHubPullRequestView,
  type HostPullRequestAction,
  type HostPullRequestLookup,
} from "../contract.js";

const GH_PR_VIEW_TIMEOUT_MS = 10_000;
const GIT_UPSTREAM_LOOKUP_TIMEOUT_MS = 10_000;

const GH_PR_VIEW_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const GH_PR_ACTION_TIMEOUT_MS = 60_000;
const GH_PR_ACTION_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const GH_PR_VIEW_JSON_FIELDS = [
  "number",
  "title",
  "state",
  "url",
  "isDraft",
  "autoMergeRequest",
  "baseRefName",
  "headRefName",
  "headRefOid",
  "updatedAt",
  "statusCheckRollup",
  "reviewDecision",
  "reviewRequests",
  "mergeStateStatus",
  "mergeable",
].join(",");

interface GetPullRequestForCurrentBranchArgs {
  cwd: string;
  localBranch: string;
  refresh: boolean;
}

interface RunPullRequestActionForCurrentBranchArgs {
  cwd: string;
  localBranch: string;
  action: HostPullRequestAction;
}

type GitHubPullRequestCheckStatus = GitHubPullRequestCheck["status"];
type GitHubPullRequestCheckConclusion = NonNullable<
  GitHubPullRequestCheck["conclusion"]
>;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function getString(object: JsonObject, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

function getNumber(object: JsonObject, key: string): number | null {
  const value = object[key];
  return typeof value === "number" ? value : null;
}

function getBoolean(object: JsonObject, key: string): boolean | null {
  const value = object[key];
  return typeof value === "boolean" ? value : null;
}

function normalizeUppercase(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toUpperCase()
    : null;
}

function normalizeReviewDecision(
  value: unknown,
): GitHubPullRequestReviewDecision | null {
  switch (normalizeUppercase(value)) {
    case "APPROVED":
      return "APPROVED";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "REVIEW_REQUIRED":
      return "REVIEW_REQUIRED";
    default:
      return null;
  }
}

function normalizeMergeStateStatus(
  value: unknown,
): GitHubPullRequestMergeStateStatus | null {
  switch (normalizeUppercase(value)) {
    case "BEHIND":
      return "BEHIND";
    case "BLOCKED":
      return "BLOCKED";
    case "CLEAN":
      return "CLEAN";
    case "DIRTY":
      return "DIRTY";
    case "DRAFT":
      return "DRAFT";
    case "HAS_HOOKS":
      return "HAS_HOOKS";
    case "UNKNOWN":
      return "UNKNOWN";
    case "UNSTABLE":
      return "UNSTABLE";
    default:
      return null;
  }
}

function normalizeMergeable(value: unknown): GitHubPullRequestMergeable | null {
  switch (normalizeUppercase(value)) {
    case "CONFLICTING":
      return "CONFLICTING";
    case "MERGEABLE":
      return "MERGEABLE";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return null;
  }
}

function normalizeCheckStatus(value: unknown): GitHubPullRequestCheckStatus {
  switch (normalizeUppercase(value)) {
    case "QUEUED":
    case "REQUESTED":
    case "WAITING":
      return "queued";
    case "EXPECTED":
    case "IN_PROGRESS":
    case "PENDING":
      return "in_progress";
    case "COMPLETED":
    case "SUCCESS":
    case "FAILURE":
    case "ERROR":
    case "CANCELLED":
    case "SKIPPED":
    case "NEUTRAL":
      return "completed";
    default:
      return "unknown";
  }
}

function normalizeCheckConclusion(
  value: unknown,
): GitHubPullRequestCheckConclusion | null {
  switch (normalizeUppercase(value)) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
      return "skipped";
    case "NEUTRAL":
      return "neutral";
    case "TIMED_OUT":
      return "timed_out";
    case "ACTION_REQUIRED":
      return "action_required";
    case "STARTUP_FAILURE":
      return "startup_failure";
    case "STALE":
      return "stale";
    case "UNKNOWN":
      return "unknown";
    default:
      return null;
  }
}

function getNullableUrl(object: JsonObject, key: string): string | null {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function getNullableDateTime(object: JsonObject, key: string): string | null {
  const value = getString(object, key);
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function normalizeCheckName(object: JsonObject): string {
  const explicitName = getString(object, "name");
  if (explicitName && explicitName.trim()) return explicitName.trim();
  const context = getString(object, "context");
  if (context && context.trim()) return context.trim();
  const workflowName = getString(object, "workflowName");
  if (workflowName && workflowName.trim()) return workflowName.trim();
  return "Unnamed check";
}

function normalizeChecks(value: unknown): GitHubPullRequestCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const checks: GitHubPullRequestCheck[] = [];
  for (const item of value) {
    const object = asObject(item);
    if (!object) continue;
    const status = normalizeCheckStatus(object.status ?? object.state);
    const conclusion =
      normalizeCheckConclusion(object.conclusion) ??
      normalizeCheckConclusion(object.state);
    checks.push({
      name: normalizeCheckName(object),
      status,
      conclusion,
      url:
        getNullableUrl(object, "detailsUrl") ??
        getNullableUrl(object, "targetUrl"),
      startedAt:
        getNullableDateTime(object, "startedAt") ??
        getNullableDateTime(object, "createdAt"),
    });
  }
  return checks;
}

function normalizeGitHubPullRequestView(
  json: unknown,
): GitHubPullRequestView | null {
  const object = asObject(json);
  if (!object) {
    return null;
  }
  const candidate = {
    number: getNumber(object, "number"),
    title: getString(object, "title"),
    state: normalizeUppercase(object.state),
    url: getString(object, "url"),
    isDraft: getBoolean(object, "isDraft"),
    autoMerge: asObject(object.autoMergeRequest) !== null,
    inMergeQueue: null,
    baseRefName: getString(object, "baseRefName"),
    headRefName: getString(object, "headRefName"),
    headRefOid: getString(object, "headRefOid"),
    updatedAt: getString(object, "updatedAt"),
    checks: normalizeChecks(object.statusCheckRollup),
    reviewDecision: normalizeReviewDecision(object.reviewDecision),
    reviewRequestCount: Array.isArray(object.reviewRequests)
      ? object.reviewRequests.length
      : (getNumber(asObject(object.reviewRequests) ?? {}, "totalCount") ?? 0),
    mergeStateStatus: normalizeMergeStateStatus(object.mergeStateStatus),
    mergeable: normalizeMergeable(object.mergeable),
  };
  const parsed = gitHubPullRequestViewSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function getMergeMethodFlag(
  method: Extract<HostPullRequestAction, { operation: "merge" }>["method"],
): string {
  switch (method) {
    case "merge":
      return "--merge";
    case "squash":
      return "--squash";
    case "rebase":
      return "--rebase";
  }
}

function buildPullRequestActionArgs(
  action: HostPullRequestAction,
  selector: string | null,
): string[] {
  const target = selector ? [selector] : [];
  switch (action.operation) {
    case "ready":
      return ["pr", "ready", ...target];
    case "draft":
      return ["pr", "ready", ...target, "--undo"];
    case "merge":
      return ["pr", "merge", ...target, getMergeMethodFlag(action.method)];
  }
}

class GhCommandError extends Error {
  constructor(
    readonly reason: "missing" | "timeout" | "failed",
    readonly stdout: string,
    readonly stderr: string,
    message: string,
  ) {
    super(message);
    this.name = "GhCommandError";
  }
}

function ghFailureDetail(error: unknown): string {
  if (error instanceof GhCommandError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : "";
}

function describeGhActionFailure(args: string[], error: unknown): string {
  if (error instanceof GhCommandError && error.reason === "missing") {
    return "GitHub CLI is not available";
  }
  const detail = ghFailureDetail(error);
  return detail
    ? `gh ${args.join(" ")} failed: ${detail}`
    : `gh ${args.join(" ")} failed`;
}

function runGhAdmitted(
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;
    const child = spawnPortableOutputProcess({
      command: "gh",
      args,
      cwd: options.cwd,
      env: options.env,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
    const collect = (chunks: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBuffer) {
        overflowed = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    };
    const finish = (run: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          new GhCommandError(
            error.code === "ENOENT" ? "missing" : "failed",
            "",
            "",
            error.message,
          ),
        ),
      );
    });
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      finish(() => {
        if (timedOut) {
          reject(new GhCommandError("timeout", out, err, "timed out"));
        } else if (overflowed) {
          reject(
            new GhCommandError(
              "failed",
              "",
              "",
              `produced more than ${options.maxBuffer} bytes of output`,
            ),
          );
        } else if (code === 0) {
          resolve({ stdout: out });
        } else {
          reject(
            new GhCommandError("failed", out, err, `exited with code ${code}`),
          );
        }
      });
    });
  });
}

function runGh(
  args: string[],
  options: {
    cwd: string;
    priority: ExperimentalVcsProcessPriority;
    timeoutMs: number;
    maxBuffer: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ stdout: string }> {
  const env =
    options.env ?? sanitizeInheritedChildProcessEnv({ env: process.env });
  return runVcsProcess(
    "gh",
    args,
    () => runGhAdmitted(args, { ...options, env }),
    {
      priority: options.priority,
    },
  );
}

export function parseGitHubPullRequestView(
  stdout: string,
): GitHubPullRequestView | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return normalizeGitHubPullRequestView(json);
}

const GH_NO_PULL_REQUEST_PATTERN = /no pull requests found for branch/iu;

type PullRequestTargetLookup =
  | { outcome: "current-branch" }
  | { outcome: "upstream-branch"; selector: string }
  | Extract<HostPullRequestLookup, { outcome: "unavailable" }>;

interface GitRemoteRepository {
  host: string;
  owner: string;
  repository: string;
}

function ghCommandUnavailable(
  ghArgs: string[],
  error: unknown,
): Extract<HostPullRequestLookup, { outcome: "unavailable" }> {
  if (error instanceof GhCommandError && error.reason === "missing") {
    return { outcome: "unavailable", message: "GitHub CLI is not available" };
  }
  if (error instanceof GhCommandError && error.reason === "timeout") {
    return {
      outcome: "unavailable",
      message: `gh ${ghArgs.slice(0, 2).join(" ")} timed out after ${GH_PR_VIEW_TIMEOUT_MS}ms`,
    };
  }
  const detail = ghFailureDetail(error);
  const command = `gh ${ghArgs.slice(0, 2).join(" ")}`;
  return {
    outcome: "unavailable",
    message: detail ? `${command} failed: ${detail}` : `${command} failed`,
  };
}

function classifyPullRequestViewError(
  error: unknown,
): Extract<HostPullRequestLookup, { outcome: "none" | "unavailable" }> {
  if (
    error instanceof GhCommandError &&
    GH_NO_PULL_REQUEST_PATTERN.test(error.stderr)
  ) {
    return { outcome: "none" };
  }
  return ghCommandUnavailable(["pr", "view"], error);
}

function gitUpstreamLookupUnavailable(
  message: string,
  detail: string,
): Extract<HostPullRequestLookup, { outcome: "unavailable" }> {
  return {
    outcome: "unavailable",
    message: detail ? `${message}: ${detail}` : message,
  };
}

function escapeGitConfigRegexp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}

function parseNullTerminatedGitConfig(stdout: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const record of stdout.split("\0")) {
    const separator = record.indexOf("\n");
    if (separator <= 0) continue;
    const key = record.slice(0, separator);
    if (!values.has(key)) {
      values.set(key, record.slice(separator + 1));
    }
  }
  return values;
}

const GIT_REMOTE_OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/u;
const GIT_REMOTE_REPOSITORY_PATTERN = /^[a-zA-Z0-9._-]+$/u;

function parseGitRemoteRepository(
  remoteUrl: string,
): GitRemoteRepository | null {
  const trimmed = remoteUrl.trim();
  let host: string;
  let repositoryPath: string;

  if (trimmed.includes("://")) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (!["git:", "http:", "https:", "ssh:"].includes(url.protocol)) {
      return null;
    }
    host = url.hostname;
    repositoryPath = url.pathname;
  } else {
    const scpStyle = /^(?:[^@/:\s]+@)?([^/:\s]+):(.+)$/u.exec(trimmed);
    if (!scpStyle?.[1] || !scpStyle[2]) {
      return null;
    }
    host = scpStyle[1];
    repositoryPath = scpStyle[2];
  }

  const pathSegments = repositoryPath
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  const owner = pathSegments[0] ?? "";
  const repository = pathSegments[1] ?? "";
  if (
    !host ||
    pathSegments.length !== 2 ||
    !GIT_REMOTE_OWNER_PATTERN.test(owner) ||
    !GIT_REMOTE_REPOSITORY_PATTERN.test(repository) ||
    repository === "." ||
    repository === ".."
  ) {
    return null;
  }
  return { host: host.toLowerCase(), owner, repository };
}

async function getPullRequestTarget(
  args: Pick<GetPullRequestForCurrentBranchArgs, "cwd" | "localBranch">,
): Promise<PullRequestTargetLookup> {
  const branchConfigPrefix = `branch.${args.localBranch}`;
  const escapedBranch = escapeGitConfigRegexp(args.localBranch);
  let configResult: GitCommandResult;
  try {
    configResult = await runGit(
      [
        "config",
        "--null",
        "--get-regexp",
        `^(branch\\.${escapedBranch}\\.(remote|merge)|remote\\..*\\.url)$`,
      ],
      {
        cwd: args.cwd,
        allowFailure: true,
        timeoutMs: GIT_UPSTREAM_LOOKUP_TIMEOUT_MS,
      },
    );
  } catch (error) {
    return gitUpstreamLookupUnavailable(
      "Could not inspect the current branch's configured upstream",
      error instanceof Error ? error.message : "",
    );
  }
  if (configResult.exitCode !== 0 && configResult.exitCode !== 1) {
    return gitUpstreamLookupUnavailable(
      "Could not inspect the current branch's configured upstream",
      configResult.stderr.trim(),
    );
  }

  const config = parseNullTerminatedGitConfig(configResult.stdout);
  const remote = config.get(`${branchConfigPrefix}.remote`) ?? "";
  const remoteRef = config.get(`${branchConfigPrefix}.merge`) ?? "";
  const remoteBranchPrefix = "refs/heads/";
  if (!remote || remote === "." || !remoteRef.startsWith(remoteBranchPrefix)) {
    return { outcome: "current-branch" };
  }

  const upstreamBranch = remoteRef.slice(remoteBranchPrefix.length);
  if (!upstreamBranch || upstreamBranch === args.localBranch) {
    return { outcome: "current-branch" };
  }

  if (remote === "origin") {
    return { outcome: "current-branch" };
  }

  const originRepository = parseGitRemoteRepository(
    config.get("remote.origin.url") ?? "",
  );
  const upstreamRepository = parseGitRemoteRepository(
    config.get(`remote.${remote}.url`) ?? "",
  );
  if (!originRepository || !upstreamRepository) {
    return gitUpstreamLookupUnavailable(
      "Could not safely resolve the configured upstream repository",
      "origin and upstream must use supported GitHub remote URLs",
    );
  }
  if (originRepository.host !== upstreamRepository.host) {
    return {
      outcome: "unavailable",
      message:
        "Configured upstream remote host does not match the origin GitHub host",
    };
  }

  if (
    originRepository.owner.toLowerCase() ===
    upstreamRepository.owner.toLowerCase()
  ) {
    return { outcome: "current-branch" };
  }

  return {
    outcome: "upstream-branch",
    selector: `${upstreamRepository.owner}:${upstreamBranch}`,
  };
}

const GH_REMOTE_PRIORITY: Readonly<Record<string, number>> = {
  upstream: 3,
  github: 2,
  origin: 1,
};

function parseGhRepoOverride(value: string): GitRemoteRepository | null {
  const segments = value.trim().split("/");
  if (segments.length === 2)
    return parseGitRemoteRepository(`https://github.com/${segments.join("/")}`);
  if (segments.length === 3)
    return parseGitRemoteRepository(`https://${segments.join("/")}`);
  return null;
}

async function resolveBranchReadTarget(
  args: Pick<GetPullRequestForCurrentBranchArgs, "cwd" | "localBranch">,
  target: Exclude<PullRequestTargetLookup, { outcome: "unavailable" }>,
): Promise<Extract<ReadTarget, { kind: "branch" }> | null> {
  const branchKey = `branch.${args.localBranch}`;
  const escapedBranch = escapeGitConfigRegexp(args.localBranch);
  const configResult = await runGit(
    [
      "config",
      "--null",
      "--get-regexp",
      `^(branch\\.${escapedBranch}\\.(remote|pushremote)|remote\\.pushdefault|remote\\..*\\.(url|gh-resolved))$`,
    ],
    {
      cwd: args.cwd,
      allowFailure: true,
      timeoutMs: GIT_UPSTREAM_LOOKUP_TIMEOUT_MS,
    },
  );
  const config = parseNullTerminatedGitConfig(configResult.stdout);
  const remotes: {
    name: string;
    repository: GitRemoteRepository;
    resolved: string | null;
  }[] = [];
  for (const [key, value] of config) {
    if (!key.startsWith("remote.") || !key.endsWith(".url")) continue;
    const name = key.slice("remote.".length, -".url".length);
    const repository = parseGitRemoteRepository(value);
    if (repository === null) continue;
    remotes.push({
      name,
      repository,
      resolved: config.get(`remote.${name}.gh-resolved`) ?? null,
    });
  }
  const resolved = remotes.find((remote) => remote.resolved !== null);
  const base = process.env.GH_REPO
    ? parseGhRepoOverride(process.env.GH_REPO)
    : resolved !== undefined && resolved.resolved !== "base"
      ? parseGitRemoteRepository(
          `https://${resolved.repository.host}/${resolved.resolved}`,
        )
      : (resolved?.repository ??
        [...remotes].sort(
          (a, b) =>
            (GH_REMOTE_PRIORITY[b.name] ?? 0) -
            (GH_REMOTE_PRIORITY[a.name] ?? 0),
        )[0]?.repository ??
        null);
  if (base === null) return null;
  const sameOwner = (owner: string) =>
    owner.toLowerCase() === base.owner.toLowerCase();
  if (target.outcome === "upstream-branch") {
    const separator = target.selector.indexOf(":");
    const owner = target.selector.slice(0, separator);
    return {
      kind: "branch",
      host: base.host,
      owner: base.owner,
      repository: base.repository,
      branch: target.selector.slice(separator + 1),
      headOwner: sameOwner(owner) ? null : owner,
    };
  }
  const pushRemote =
    config.get(`${branchKey}.pushremote`) ??
    config.get("remote.pushdefault") ??
    config.get(`${branchKey}.remote`) ??
    "";
  const pushRepository =
    remotes.find((remote) => remote.name === pushRemote)?.repository ??
    parseGitRemoteRepository(pushRemote);
  return {
    kind: "branch",
    host: base.host,
    owner: base.owner,
    repository: base.repository,
    branch: args.localBranch,
    headOwner:
      pushRepository === null || sameOwner(pushRepository.owner)
        ? null
        : pushRepository.owner,
  };
}

export async function prepareCurrentBranchRead(
  args: GetPullRequestForCurrentBranchArgs,
): Promise<PreparedRead> {
  const target = await getPullRequestTarget(args);
  if (target.outcome === "unavailable") return preparedResult(target);
  const branchTarget = await resolveBranchReadTarget(args, target);
  if (branchTarget !== null)
    return prepareRead(
      branchTarget,
      args.cwd,
      sanitizeInheritedChildProcessEnv({ env: process.env }),
      args.refresh,
    );
  const ghArgs = [
    "pr",
    "view",
    ...(target.outcome === "upstream-branch" ? [target.selector] : []),
    "--json",
    GH_PR_VIEW_JSON_FIELDS,
  ];
  return {
    kind: "direct",
    async run() {
      try {
        const { stdout } = await runGh(ghArgs, {
          priority: "background",
          cwd: args.cwd,
          timeoutMs: GH_PR_VIEW_TIMEOUT_MS,
          maxBuffer: GH_PR_VIEW_MAX_BUFFER_BYTES,
        });
        const pr = parseGitHubPullRequestView(stdout);
        if (pr === null)
          return {
            outcome: "unavailable",
            message: "gh pr view returned unparseable output",
          };
        if (pr.isDraft || pr.state !== "OPEN")
          return {
            outcome: "found",
            pullRequest: { ...pr, inMergeQueue: false },
          };
        const full = await getPullRequestByUrl(pr.url, args.cwd);
        return full.outcome === "found"
          ? full
          : { outcome: "found", pullRequest: pr };
      } catch (error) {
        return classifyPullRequestViewError(error);
      }
    },
  };
}

export async function getPullRequestForCurrentBranch(
  args: GetPullRequestForCurrentBranchArgs,
): Promise<HostPullRequestLookup> {
  return startRead(await prepareCurrentBranchRead(args));
}

export async function runPullRequestActionForCurrentBranch(
  args: RunPullRequestActionForCurrentBranchArgs,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const target = await getPullRequestTarget(args);
  if (target.outcome === "unavailable") {
    return { ok: false, message: target.message };
  }
  const ghArgs = buildPullRequestActionArgs(
    args.action,
    target.outcome === "upstream-branch" ? target.selector : null,
  );
  try {
    await runGh(ghArgs, {
      priority: "interactive",
      cwd: args.cwd,
      timeoutMs: GH_PR_ACTION_TIMEOUT_MS,
      maxBuffer: GH_PR_ACTION_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    return { ok: false, message: describeGhActionFailure(ghArgs, error) };
  }
  return { ok: true };
}

type ReadTarget =
  | { kind: "url"; host: string; url: string; cursor: string | null }
  | {
      kind: "branch";
      host: string;
      owner: string;
      repository: string;
      branch: string;
      headOwner: string | null;
    };
type QueuedRead = {
  target: ReadTarget;
  cwd: string;
  env: NodeJS.ProcessEnv;
  resolve(result: HostPullRequestLookup): void;
};
export type PreparedRead =
  | {
      kind: "batched";
      target: ReadTarget;
      cwd: string;
      env: NodeJS.ProcessEnv;
      group: string;
      refresh: boolean;
    }
  | { kind: "direct"; run(): Promise<HostPullRequestLookup> };

export function preparedResult(result: HostPullRequestLookup): PreparedRead {
  return { kind: "direct", run: async () => result };
}

const MAX_DOCUMENT_READS = 25;
const MAX_DOCUMENT_NODES = 500_000;

function readNodes(target: ReadTarget): number {
  return target.kind === "branch"
    ? BRANCH_PULL_REQUESTS_PAGE * (1 + PULL_REQUEST_NODES)
    : PULL_REQUEST_NODES;
}

const batches = new Map<string, QueuedRead[]>();
const pendingReads = new Map<string, Promise<HostPullRequestLookup>>();
const discovered = new Map<
  string,
  { result: HostPullRequestLookup; fetchedAt: number }
>();
const pausedUntil = new Map<string, number>();
const mergeQueueUnsupported = new Set<string>();

async function credentialKey(
  host: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string> {
  const token =
    host === "github.com" || host.endsWith(".ghe.com")
      ? env.GH_TOKEN || env.GITHUB_TOKEN
      : env.GH_ENTERPRISE_TOKEN || env.GITHUB_ENTERPRISE_TOKEN;
  if (token)
    return createHash("sha256")
      .update(JSON.stringify([host, token]))
      .digest("hex");
  const appData = env.APPDATA ?? env.AppData;
  const directory = resolve(
    cwd,
    env.GH_CONFIG_DIR ||
      (env.XDG_CONFIG_HOME
        ? join(env.XDG_CONFIG_HOME, "gh")
        : process.platform === "win32" && appData
          ? join(appData, "GitHub CLI")
          : join(env.HOME ?? homedir(), ".config", "gh")),
  );
  const profile = await readFile(join(directory, "hosts.yml")).catch(() =>
    Buffer.alloc(0),
  );
  return createHash("sha256")
    .update(JSON.stringify([host, directory]))
    .update(profile)
    .digest("hex");
}

const REVIEW_REQUESTS_PAGE = 100;
const CHECK_CONTEXTS_PAGE = 100;
const BRANCH_PULL_REQUESTS_PAGE = 100;
const PULL_REQUEST_NODES = REVIEW_REQUESTS_PAGE + 1 + CHECK_CONTEXTS_PAGE;

function fields(cursor: string | null, mergeQueue: boolean): string {
  return `number title state url isDraft autoMergeRequest { enabledAt }${mergeQueue ? " isInMergeQueue" : ""}
    baseRefName headRefName headRefOid updatedAt reviewDecision reviewRequests(first: ${REVIEW_REQUESTS_PAGE}) { totalCount }
    mergeStateStatus mergeable isCrossRepository headRepositoryOwner { login }
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: ${CHECK_CONTEXTS_PAGE}${cursor === null ? "" : `, after: ${JSON.stringify(cursor)}`}) {
      nodes { ... on CheckRun { name status conclusion detailsUrl startedAt }
        ... on StatusContext { context state targetUrl createdAt } }
      pageInfo { hasNextPage endCursor }
    } } } } }`;
}

function selection(
  target: ReadTarget,
  alias: string,
  mergeQueue: boolean,
): string {
  if (target.kind === "url")
    return `${alias}: resource(url: ${JSON.stringify(target.url)}) { ... on PullRequest { ${fields(target.cursor, mergeQueue)} } }`;
  return `${alias}: repository(owner: ${JSON.stringify(target.owner)}, name: ${JSON.stringify(target.repository)}) {
    defaultBranchRef { name }
    pullRequests(headRefName: ${JSON.stringify(target.branch)}, first: ${BRANCH_PULL_REQUESTS_PAGE}, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { ${fields(null, mergeQueue)} }
    }
  }`;
}

function matchesBranchTarget(
  pr: JsonObject,
  target: Extract<ReadTarget, { kind: "branch" }>,
  defaultBranch: string | null,
): boolean {
  const crossRepository = getBoolean(pr, "isCrossRepository") === true;
  if (target.headOwner === null)
    return (
      !crossRepository &&
      (pr.state === "OPEN" || target.branch !== defaultBranch)
    );
  return (
    crossRepository &&
    getString(
      asObject(pr.headRepositoryOwner) ?? {},
      "login",
    )?.toLowerCase() === target.headOwner.toLowerCase()
  );
}

async function decodeRead(
  value: unknown,
  entry: QueuedRead,
): Promise<HostPullRequestLookup> {
  let raw = asObject(value);
  if (raw === null) return { outcome: "none" };
  if (entry.target.kind === "branch") {
    const target = entry.target;
    const connection = asObject(raw.pullRequests);
    const defaultBranch = getString(
      asObject(raw.defaultBranchRef) ?? {},
      "name",
    );
    const candidates = Array.isArray(connection?.nodes)
      ? connection.nodes.flatMap((node) => {
          const pr = asObject(node);
          return pr !== null && matchesBranchTarget(pr, target, defaultBranch)
            ? [pr]
            : [];
        })
      : [];
    raw = candidates.find((pr) => pr.state === "OPEN") ?? candidates[0] ?? null;
    if (raw === null) return { outcome: "none" };
  }
  const commits = asObject(raw.commits);
  const nodes = Array.isArray(commits?.nodes) ? commits.nodes : [];
  const commit = asObject(asObject(nodes[0])?.commit);
  const contexts = asObject(asObject(commit?.statusCheckRollup)?.contexts);
  const view = normalizeGitHubPullRequestView({
    ...raw,
    statusCheckRollup: contexts?.nodes ?? [],
  });
  if (view === null)
    return {
      outcome: "unavailable",
      message: "GitHub returned an invalid pull request",
    };
  view.inMergeQueue =
    view.isDraft || view.state !== "OPEN"
      ? false
      : getBoolean(raw, "isInMergeQueue");
  const pageInfo = asObject(contexts?.pageInfo);
  if (pageInfo?.hasNextPage === true) {
    const cursor = getString(pageInfo, "endCursor");
    if (
      cursor === null ||
      (entry.target.kind === "url" && cursor === entry.target.cursor)
    )
      return {
        outcome: "unavailable",
        message: "GitHub returned an invalid checks cursor",
      };
    const next = await enqueueRead(
      { kind: "url", host: entry.target.host, url: view.url, cursor },
      entry.cwd,
      entry.env,
    );
    if (next.outcome !== "found") return next;
    if (next.pullRequest.headRefOid !== view.headRefOid)
      return {
        outcome: "unavailable",
        message: "Pull request head changed while reading checks",
      };
    view.checks.push(...next.pullRequest.checks);
  }
  return { outcome: "found", pullRequest: view };
}

async function runGraphQLRead(
  query: string,
  entry: QueuedRead,
): Promise<{ stdout: string }> {
  const directory = await mkdtemp(join(tmpdir(), "bb-pr-read-"));
  try {
    const inputPath = join(directory, "query.json");
    await writeFile(inputPath, JSON.stringify({ query }), { mode: 0o600 });
    return await runGh(
      [
        "api",
        "graphql",
        "--hostname",
        entry.target.host,
        "--method",
        "POST",
        "--input",
        inputPath,
      ],
      {
        cwd: entry.cwd,
        env: entry.env,
        priority: "background",
        timeoutMs: GH_PR_VIEW_TIMEOUT_MS,
        maxBuffer: GH_PR_VIEW_MAX_BUFFER_BYTES,
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function requestBatch(
  entries: QueuedRead[],
  mergeQueue: boolean,
): Promise<{ data: JsonObject | null; errors: JsonObject[] }> {
  const query = `query { ${entries.map((entry, index) => selection(entry.target, `p${index}`, mergeQueue)).join("\n")} rateLimit { remaining resetAt } }`;
  const { stdout } = await runGraphQLRead(query, entries[0]!).catch(
    (error: unknown) => {
      if (
        error instanceof GhCommandError &&
        error.reason === "failed" &&
        error.stdout.trim().startsWith("{")
      )
        return { stdout: error.stdout };
      throw error;
    },
  );
  const response = asObject(JSON.parse(stdout));
  return {
    data: asObject(response?.data),
    errors: Array.isArray(response?.errors)
      ? response.errors.flatMap((error) => {
          const object = asObject(error);
          return object === null ? [] : [object];
        })
      : [],
  };
}

async function flushBatch(group: string): Promise<void> {
  const queued = batches.get(group);
  if (queued === undefined) return;
  batches.delete(group);
  const chunks: QueuedRead[][] = [];
  let nodes = 0;
  for (const entry of queued) {
    const entryNodes = readNodes(entry.target);
    const current = chunks.at(-1);
    if (
      current === undefined ||
      current.length === MAX_DOCUMENT_READS ||
      nodes + entryNodes > MAX_DOCUMENT_NODES
    ) {
      chunks.push([entry]);
      nodes = entryNodes;
      continue;
    }
    current.push(entry);
    nodes += entryNodes;
  }
  for (const entries of chunks) {
    const paused = pausedUntil.get(group) ?? 0;
    if (paused > Date.now()) {
      for (const entry of entries)
        entry.resolve({
          outcome: "unavailable",
          message: `GitHub rate limit: retry after ${new Date(paused).toISOString()}`,
        });
      continue;
    }
    try {
      let { data, errors } = await requestBatch(
        entries,
        !mergeQueueUnsupported.has(group),
      );
      if (
        !mergeQueueUnsupported.has(group) &&
        errors.some((error) =>
          /isInMergeQueue/u.test(getString(error, "message") ?? ""),
        )
      ) {
        mergeQueueUnsupported.add(group);
        ({ data, errors } = await requestBatch(entries, false));
      }
      if (
        errors.some((error) =>
          /rate limit|secondary rate|abuse detection/iu.test(
            getString(error, "message") ?? "",
          ),
        )
      )
        pausedUntil.set(group, Date.now() + 60_000);
      const rate = asObject(data?.rateLimit);
      if (rate?.remaining === 0) {
        const reset = Date.parse(getString(rate, "resetAt") ?? "");
        pausedUntil.set(
          group,
          Number.isFinite(reset) ? reset : Date.now() + 60_000,
        );
      }
      await Promise.all(
        entries.map(async (entry, index) => {
          const alias = `p${index}`;
          const failed = errors.some(
            (error) => !Array.isArray(error.path) || error.path[0] === alias,
          );
          if (failed || data === null || !(alias in data)) {
            entry.resolve({
              outcome: "unavailable",
              message: "GitHub returned no result for this pull request",
            });
            return;
          }
          entry.resolve(await decodeRead(data[alias], entry));
        }),
      );
    } catch (error) {
      const detail = ghFailureDetail(error);
      if (/rate limit|secondary rate|abuse detection/iu.test(detail))
        pausedUntil.set(group, Date.now() + 60_000);
      const result = ghCommandUnavailable(["api", "graphql"], error);
      for (const entry of entries) entry.resolve(result);
    }
  }
}

async function prepareRead(
  target: ReadTarget,
  cwd: string,
  inheritedEnv = sanitizeInheritedChildProcessEnv({ env: process.env }),
  refresh = false,
): Promise<PreparedRead> {
  const env = { ...inheritedEnv };
  const group = await credentialKey(target.host, env, cwd);
  return { kind: "batched", target, cwd, env, group, refresh };
}

export function startRead(
  prepared: PreparedRead,
): Promise<HostPullRequestLookup> {
  if (prepared.kind === "direct") return prepared.run();
  const { target, cwd, env, group, refresh } = prepared;
  const key = `${group}:${JSON.stringify(target)}`;
  if (refresh) discovered.delete(key);
  const cached = discovered.get(key);
  if (
    target.kind === "branch" &&
    cached !== undefined &&
    Date.now() - cached.fetchedAt < 10_000
  )
    return Promise.resolve(cached.result);
  const pending = pendingReads.get(key);
  if (pending !== undefined) return pending;
  const result = new Promise<HostPullRequestLookup>((resolve) => {
    const entries = batches.get(group);
    const entry = { target, cwd, env, resolve };
    if (entries !== undefined) entries.push(entry);
    else {
      batches.set(group, [entry]);
      setTimeout(() => void flushBatch(group), 10);
    }
  })
    .then((lookup) => {
      if (target.kind === "branch" && lookup.outcome !== "unavailable") {
        for (const [cachedKey, value] of discovered)
          if (Date.now() - value.fetchedAt >= 10_000)
            discovered.delete(cachedKey);
        discovered.set(key, { result: lookup, fetchedAt: Date.now() });
      }
      return lookup;
    })
    .finally(() => pendingReads.delete(key));
  pendingReads.set(key, result);
  return result;
}

export async function readPullRequests(
  preparations: readonly Promise<PreparedRead>[],
): Promise<HostPullRequestLookup[]> {
  const prepared = await Promise.all(preparations);
  return Promise.all(prepared.map(startRead));
}

async function enqueueRead(
  target: ReadTarget,
  cwd: string,
  inheritedEnv = sanitizeInheritedChildProcessEnv({ env: process.env }),
  refresh = false,
): Promise<HostPullRequestLookup> {
  return startRead(await prepareRead(target, cwd, inheritedEnv, refresh));
}

export function prepareUrlRead(
  url: string,
  cwd: string,
): Promise<PreparedRead> {
  return prepareRead(
    { kind: "url", host: new URL(url).hostname, url, cursor: null },
    cwd,
  );
}

export async function getPullRequestByUrl(
  url: string,
  cwd: string,
): Promise<HostPullRequestLookup> {
  return startRead(await prepareUrlRead(url, cwd));
}
