import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import {
  type GitHostPullRequest,
  type GitHostPullRequestCheck,
  type GitHostPullRequestCheckConclusion,
  type GitHostPullRequestCheckStatus,
  type GitHostPullRequestMergeStateStatus,
  type GitHostPullRequestMergeable,
  type GitHostPullRequestReviewDecision,
  gitHostPullRequestSchema,
} from "@bb/domain";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { runGit, type GitCommandResult, WorkspaceError } from "./git.js";

const execFileAsync = promisify(execFile);

/** `gh` is a network round-trip; cap it so it never blocks a status poll. */
const GH_PR_VIEW_TIMEOUT_MS = 10_000;
const GIT_UPSTREAM_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Explicit stdout cap rather than Node's 1 MB execFile default. The selected
 * field set is tiny (a few hundred bytes) so this is never reached today, but
 * stating the bound keeps it intentional and matches the package's git buffer
 * if the field list ever grows.
 */
const GH_PR_VIEW_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const GH_PR_ACTION_TIMEOUT_MS = 60_000;
const GH_PR_ACTION_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

const GH_PR_VIEW_JSON_FIELDS = [
  "number",
  "title",
  "state",
  "url",
  "isDraft",
  "baseRefName",
  "headRefName",
  "updatedAt",
  "statusCheckRollup",
  "reviewDecision",
  "reviewRequests",
  "mergeStateStatus",
  "mergeable",
].join(",");

export interface GitHostCliOptions {
  /**
   * Resolved user login-shell PATH. When omitted, `gh` inherits the parent
   * process PATH, which is useful for direct library consumers but may be the
   * minimal service PATH inside the host daemon.
   */
  shellPath?: string;
}

interface GetPullRequestForCurrentBranchArgs extends GitHostCliOptions {
  cwd: string;
  localBranch: string;
}

type GitHostPullRequestMergeMethod = "merge" | "squash" | "rebase";

export type GitHostPullRequestAction =
  | { operation: "ready" }
  | { operation: "draft" }
  | { operation: "merge"; method: GitHostPullRequestMergeMethod };

interface RunPullRequestActionForCurrentBranchArgs extends GitHostCliOptions {
  cwd: string;
  localBranch: string;
  action: GitHostPullRequestAction;
}

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
): GitHostPullRequestReviewDecision | null {
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
): GitHostPullRequestMergeStateStatus | null {
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

function normalizeMergeable(
  value: unknown,
): GitHostPullRequestMergeable | null {
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

function normalizeCheckStatus(value: unknown): GitHostPullRequestCheckStatus {
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
): GitHostPullRequestCheckConclusion | null {
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

function normalizeChecks(value: unknown): GitHostPullRequestCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const checks: GitHostPullRequestCheck[] = [];
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
      // CheckRun exposes startedAt; StatusContext exposes the equivalent
      // creation time. Preserve one comparable value so the server can apply
      // latest-run rollup policy without depending on GitHub's array order.
      startedAt:
        getNullableDateTime(object, "startedAt") ??
        getNullableDateTime(object, "createdAt"),
    });
  }
  return checks;
}

function getArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function normalizeGitHubPullRequestView(
  json: unknown,
): GitHostPullRequest | null {
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
    baseRefName: getString(object, "baseRefName"),
    headRefName: getString(object, "headRefName"),
    updatedAt: getString(object, "updatedAt"),
    checks: normalizeChecks(object.statusCheckRollup),
    reviewDecision: normalizeReviewDecision(object.reviewDecision),
    reviewRequestCount: getArrayLength(object.reviewRequests),
    mergeStateStatus: normalizeMergeStateStatus(object.mergeStateStatus),
    mergeable: normalizeMergeable(object.mergeable),
  };
  const parsed = gitHostPullRequestSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function getMergeMethodFlag(method: GitHostPullRequestMergeMethod): string {
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
  action: GitHostPullRequestAction,
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

function getExecFileException(error: unknown): ExecFileException | undefined {
  return error instanceof Error ? (error as ExecFileException) : undefined;
}

function trimGhOutput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createGitHostCommandFailedError(
  args: string[],
  error: unknown,
): WorkspaceError {
  const execError = getExecFileException(error);
  if (execError?.code === "ENOENT") {
    return new WorkspaceError(
      "git_host_cli_unavailable",
      "GitHub CLI is not available",
      { cause: error },
    );
  }
  const stderr = trimGhOutput(execError?.stderr);
  const stdout = trimGhOutput(execError?.stdout);
  const detail =
    stderr || stdout || (error instanceof Error ? error.message : "");
  return new WorkspaceError(
    "git_host_command_failed",
    detail
      ? `gh ${args.join(" ")} failed: ${detail}`
      : `gh ${args.join(" ")} failed`,
    { cause: error },
  );
}

/**
 * Parse the stdout of `gh pr view --json <fields>` into a validated
 * {@link GitHostPullRequest}. Returns `null` for any output that is not a
 * well-formed PR object (empty, non-JSON, missing/extra fields, unexpected
 * state) so callers never have to special-case malformed `gh` output.
 */
export function parseGitHostPullRequest(
  stdout: string,
): GitHostPullRequest | null {
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

/**
 * Structured result of a pull-request detection attempt. "none" is a real
 * answer (`gh` ran and reported no PR for the branch); "unavailable" means the
 * lookup could not produce an answer (gh missing, not authenticated, timeout,
 * unparseable output), so callers must not treat it as "no PR exists".
 */
export type GitHostPullRequestLookup =
  | { outcome: "found"; pullRequest: GitHostPullRequest }
  | { outcome: "none" }
  | { outcome: "unavailable"; message: string };

/** `gh pr view` stderr for a branch that genuinely has no pull request. */
const GH_NO_PULL_REQUEST_PATTERN = /no pull requests found for branch/iu;

type PullRequestTargetLookup =
  | { outcome: "current-branch" }
  | { outcome: "upstream-branch"; selector: string }
  | Extract<GitHostPullRequestLookup, { outcome: "unavailable" }>;

interface GitRemoteRepository {
  host: string;
  owner: string;
}

function ghCommandUnavailable(
  ghArgs: string[],
  error: unknown,
): Extract<GitHostPullRequestLookup, { outcome: "unavailable" }> {
  const execError = getExecFileException(error);
  if (execError?.code === "ENOENT") {
    return { outcome: "unavailable", message: "GitHub CLI is not available" };
  }
  if (execError?.killed) {
    return {
      outcome: "unavailable",
      message: `gh ${ghArgs.slice(0, 2).join(" ")} timed out after ${GH_PR_VIEW_TIMEOUT_MS}ms`,
    };
  }
  const detail =
    trimGhOutput(execError?.stderr) ||
    trimGhOutput(execError?.stdout) ||
    (error instanceof Error ? error.message : "");
  const command = `gh ${ghArgs.slice(0, 2).join(" ")}`;
  return {
    outcome: "unavailable",
    message: detail ? `${command} failed: ${detail}` : `${command} failed`,
  };
}

/**
 * Classify a failed `gh pr view` invocation. Only the "no pull requests
 * found" answer is genuine absence; everything else (gh missing, auth
 * failure, no remote, timeout, crash) means the lookup itself failed.
 */
function classifyPullRequestViewError(
  error: unknown,
): Extract<GitHostPullRequestLookup, { outcome: "none" | "unavailable" }> {
  const execError = getExecFileException(error);
  if (GH_NO_PULL_REQUEST_PATTERN.test(trimGhOutput(execError?.stderr))) {
    return { outcome: "none" };
  }
  return ghCommandUnavailable(["pr", "view"], error);
}

function gitUpstreamLookupUnavailable(
  message: string,
  detail: string,
): Extract<GitHostPullRequestLookup, { outcome: "unavailable" }> {
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

/**
 * Parse a GitHub-style remote locally. The URL is never passed to `gh`: Git
 * config is workspace-controlled, while `gh` inherits the user's auth tokens.
 */
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
  return { host: host.toLowerCase(), owner };
}

async function getPullRequestTarget(
  args: GetPullRequestForCurrentBranchArgs,
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
        ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
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

  // Managed worktrees intentionally track the base branch on origin so Git
  // can report ahead/behind state. That is not the PR head: a pushed PR still
  // uses the managed local branch name, which bare `gh pr view` resolves.
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

  // A differently named branch on an alias of the origin repository is base
  // or integration tracking, not a fork PR head. Only substitute the tracked
  // branch when the remote belongs to another GitHub owner.
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

/**
 * Detect the open/most-relevant GitHub pull request for the branch checked out
 * in `cwd` by shelling out to the host `gh` CLI. Bare `gh pr view` correctly
 * resolves the configured upstream owner, but combines it with the local branch
 * name. When Git tracks a differently named branch on a different-owner fork,
 * parse the owner locally from a same-host upstream and pass the fully
 * qualified `owner:branch` selector. Base-branch tracking on origin continues
 * to use the managed local branch name. Configured URLs are never passed to
 * `gh`, which inherits user auth tokens.
 *
 * Never throws: a branch with no PR is `outcome: "none"`, while every lookup
 * failure (`gh` not installed, not authenticated, no GitHub remote, a timeout,
 * unparseable output) is `outcome: "unavailable"` so callers can distinguish
 * "no PR" from "could not check". The inherited environment preserves
 * `HOME`/token vars and substitutes the resolved login-shell PATH when the
 * caller supplies it, so daemon probes resolve the same `gh` as the user.
 */
export async function getPullRequestForCurrentBranch(
  args: GetPullRequestForCurrentBranchArgs,
): Promise<GitHostPullRequestLookup> {
  const target = await getPullRequestTarget(args);
  if (target.outcome === "unavailable") {
    return target;
  }
  const ghArgs = [
    "pr",
    "view",
    ...(target.outcome === "upstream-branch" ? [target.selector] : []),
    "--json",
    GH_PR_VIEW_JSON_FIELDS,
  ];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("gh", ghArgs, {
      cwd: args.cwd,
      encoding: "utf8",
      env: sanitizeInheritedChildProcessEnv({
        env: process.env,
        ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
      }),
      timeout: GH_PR_VIEW_TIMEOUT_MS,
      maxBuffer: GH_PR_VIEW_MAX_BUFFER_BYTES,
    }));
  } catch (error) {
    return classifyPullRequestViewError(error);
  }
  const pullRequest = parseGitHostPullRequest(stdout);
  if (!pullRequest) {
    return {
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    };
  }
  return { outcome: "found", pullRequest };
}

/**
 * Mutate the GitHub pull request for the branch checked out in `cwd`. Uses the
 * same qualified upstream target as detection when the tracked branch has a
 * different name. Mutation failures are meaningful and surface to the caller.
 */
export async function runPullRequestActionForCurrentBranch(
  args: RunPullRequestActionForCurrentBranchArgs,
): Promise<void> {
  const target = await getPullRequestTarget(args);
  if (target.outcome === "unavailable") {
    throw new WorkspaceError("git_host_command_failed", target.message);
  }
  const ghArgs = buildPullRequestActionArgs(
    args.action,
    target.outcome === "upstream-branch" ? target.selector : null,
  );
  try {
    await execFileAsync("gh", ghArgs, {
      cwd: args.cwd,
      encoding: "utf8",
      env: sanitizeInheritedChildProcessEnv({
        env: process.env,
        ...(args.shellPath !== undefined ? { shellPath: args.shellPath } : {}),
      }),
      timeout: GH_PR_ACTION_TIMEOUT_MS,
      maxBuffer: GH_PR_ACTION_MAX_BUFFER_BYTES,
    });
  } catch (error) {
    throw createGitHostCommandFailedError(ghArgs, error);
  }
}
