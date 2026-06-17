import { execFile } from "node:child_process";
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

const execFileAsync = promisify(execFile);

/** `gh` is a network round-trip; cap it so it never blocks a status poll. */
const GH_PR_VIEW_TIMEOUT_MS = 10_000;

/**
 * Explicit stdout cap rather than Node's 1 MB execFile default. The selected
 * field set is tiny (a few hundred bytes) so this is never reached today, but
 * stating the bound keeps it intentional and matches the package's git buffer
 * if the field list ever grows.
 */
const GH_PR_VIEW_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

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

interface GetPullRequestForBranchArgs {
  cwd: string;
  branch: string;
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
 * Detect the open/most-relevant GitHub pull request for `branch` by shelling
 * out to the host `gh` CLI in `cwd`. Returns `null` — never throws — for every
 * "no PR" condition: `gh` not installed, not authenticated, no GitHub remote,
 * no PR for the branch, a timeout, or unparseable output. The inherited
 * environment preserves `PATH`/`HOME`/token vars so `gh` auth resolves the same
 * way it would in the user's shell.
 */
export async function getPullRequestForBranch(
  args: GetPullRequestForBranchArgs,
): Promise<GitHostPullRequest | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      // `--` ends option parsing so `branch` is always taken as the positional
      // target, never mistaken for a flag.
      ["pr", "view", "--json", GH_PR_VIEW_JSON_FIELDS, "--", args.branch],
      {
        cwd: args.cwd,
        encoding: "utf8",
        env: sanitizeInheritedChildProcessEnv({ env: process.env }),
        timeout: GH_PR_VIEW_TIMEOUT_MS,
        maxBuffer: GH_PR_VIEW_MAX_BUFFER_BYTES,
      },
    );
    return parseGitHostPullRequest(stdout);
  } catch {
    // gh-missing / not-authed / no-remote / no-PR / timeout all land here and
    // mean the same thing to the product: there is no PR to show.
    return null;
  }
}
