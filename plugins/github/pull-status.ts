export type PullState = "open" | "draft" | "merged" | "closed";
export type PullChecksState =
  | "passing"
  | "failing"
  | "pending"
  | "no_checks"
  | "unknown";
export type PullReviewState =
  | "approved"
  | "changes_requested"
  | "review_requested"
  | "review_required"
  | "none";
export type PullMergeabilityState =
  | "conflicts"
  | "draft"
  | "mergeable"
  | "unknown";
export type PullAttention =
  | "merged"
  | "closed"
  | "conflicts"
  | "checks_failed"
  | "changes_requested"
  | "draft"
  | "queued"
  | "review_requested"
  | "checks_pending"
  | "ready_to_merge"
  | "none";

export interface PullStatus {
  state: PullState;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  stack: PullStack | null;
  headOwner: string | null;
  checks: {
    state: PullChecksState;
    passed: number;
    failed: number;
    pending: number;
  };
  review: { state: PullReviewState; requested: string[] };
  mergeability: PullMergeabilityState;
  attention: PullAttention;
}

export interface PullStateCount {
  state: string;
  count: number;
}

export interface RawPullStatus {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string | null;
  isCrossRepository: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  mergeable: string;
  reviewDecision: string | null;
  isInMergeQueue: boolean;
  requestedReviewers: string[];
  checkRunCounts: PullStateCount[];
  statusContextCounts: PullStateCount[];
  checksVerdict: string | null;
  stack: PullStack | null;
  headOwner: string | null;
}

export interface PullStack {
  number: number;
  size: number;
  position: number;
}

const CHECK_RUN_PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const CHECK_RUN_FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);
const CHECK_RUN_CANCELLED = new Set(["CANCELLED", "STALE"]);
const CHECK_RUN_PENDING = new Set([
  "QUEUED",
  "IN_PROGRESS",
  "PENDING",
  "WAITING",
  "REQUESTED",
]);
const STATUS_CONTEXT_FAILED = new Set(["FAILURE", "ERROR"]);
const STATUS_CONTEXT_PENDING = new Set(["PENDING", "EXPECTED"]);

export function isFailedCheck(conclusion: string): boolean {
  const value = conclusion.toUpperCase();
  return (
    CHECK_RUN_FAILED.has(value) ||
    CHECK_RUN_CANCELLED.has(value) ||
    STATUS_CONTEXT_FAILED.has(value)
  );
}

const VERDICT_STATES: Record<string, PullChecksState> = {
  SUCCESS: "passing",
  FAILURE: "failing",
  ERROR: "failing",
  PENDING: "pending",
  EXPECTED: "pending",
};

function assembleChecks(raw: RawPullStatus): PullStatus["checks"] {
  let passed = 0;
  let failed = 0;
  let cancelled = 0;
  let pending = 0;
  let unknown = 0;
  for (const { state, count } of raw.checkRunCounts) {
    if (CHECK_RUN_PASSED.has(state)) passed += count;
    else if (CHECK_RUN_FAILED.has(state)) failed += count;
    else if (CHECK_RUN_CANCELLED.has(state)) cancelled += count;
    else if (CHECK_RUN_PENDING.has(state)) pending += count;
    else unknown += count;
  }
  for (const { state, count } of raw.statusContextCounts) {
    if (state === "SUCCESS") passed += count;
    else if (STATUS_CONTEXT_FAILED.has(state)) failed += count;
    else if (STATUS_CONTEXT_PENDING.has(state)) pending += count;
    else unknown += count;
  }
  const verdict =
    raw.checksVerdict === null ? undefined : VERDICT_STATES[raw.checksVerdict];
  let state: PullChecksState;
  if (passed + failed + cancelled + pending + unknown === 0) {
    state = "no_checks";
  } else if (verdict !== undefined) state = verdict;
  else if (failed + cancelled > 0) state = "failing";
  else if (pending > 0) state = "pending";
  else if (unknown > 0) state = "unknown";
  else state = "passing";
  return {
    state,
    passed,
    failed: state === "failing" && failed === 0 ? cancelled : failed,
    pending,
  };
}

function assembleReview(raw: RawPullStatus): PullStatus["review"] {
  const requested = raw.requestedReviewers.length > 0;
  let state: PullReviewState;
  switch (raw.reviewDecision) {
    case "APPROVED":
      state = "approved";
      break;
    case "CHANGES_REQUESTED":
      state = "changes_requested";
      break;
    case "REVIEW_REQUIRED":
      state = requested ? "review_requested" : "review_required";
      break;
    default:
      state = requested ? "review_requested" : "none";
  }
  return { state, requested: raw.requestedReviewers };
}

function assembleMergeability(raw: RawPullStatus): PullMergeabilityState {
  if (raw.mergeable === "CONFLICTING") return "conflicts";
  if (raw.state === "OPEN" && raw.isDraft) return "draft";
  if (raw.mergeable === "MERGEABLE") return "mergeable";
  return "unknown";
}

function assembleAttention(
  state: PullState,
  checks: PullStatus["checks"],
  review: PullStatus["review"],
  mergeability: PullStatus["mergeability"],
  inMergeQueue: boolean,
): PullAttention {
  if (state === "merged") return "merged";
  if (state === "closed") return "closed";
  if (mergeability === "conflicts") return "conflicts";
  if (checks.state === "failing") return "checks_failed";
  if (review.state === "changes_requested") return "changes_requested";
  if (state === "draft") return "draft";
  if (inMergeQueue) return "queued";
  if (
    review.state === "review_requested" ||
    review.state === "review_required"
  ) {
    return "review_requested";
  }
  if (checks.state === "pending") return "checks_pending";
  if (
    mergeability === "mergeable" &&
    (checks.state === "passing" || checks.state === "no_checks")
  ) {
    return "ready_to_merge";
  }
  return "none";
}

export function assemblePullStatus(raw: RawPullStatus): PullStatus {
  const state: PullState =
    raw.state === "MERGED"
      ? "merged"
      : raw.state === "CLOSED"
        ? "closed"
        : raw.isDraft
          ? "draft"
          : "open";
  const checks = assembleChecks(raw);
  const review = assembleReview(raw);
  const mergeability = assembleMergeability(raw);
  return {
    state,
    baseRefName: raw.baseRefName,
    headRefName: raw.headRefName,
    headRefOid: raw.headRefOid,
    isCrossRepository: raw.isCrossRepository,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    mergedAt: raw.mergedAt,
    stack: raw.stack,
    headOwner: raw.headOwner,
    checks,
    review,
    mergeability,
    attention: assembleAttention(
      state,
      checks,
      review,
      mergeability,
      raw.isInMergeQueue,
    ),
  };
}

export type PullGroup =
  | "you"
  | "ready"
  | "fixing"
  | "progress"
  | "review"
  | "open"
  | "draft"
  | "snoozed"
  | "merged"
  | "closed";

export const PULL_GROUPS: ReadonlyArray<{ id: PullGroup; label: string }> = [
  { id: "you", label: "Your move" },
  { id: "ready", label: "Ready to merge" },
  { id: "fixing", label: "Needs fixing" },
  { id: "progress", label: "In progress" },
  { id: "review", label: "Waiting for review" },
  { id: "open", label: "Open" },
  { id: "draft", label: "Drafts" },
  { id: "snoozed", label: "Snoozed" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
];

export interface PullGroupExtra {
  snoozed?: boolean;
}

export type PullView = "inbox" | "mine" | "all" | "merged";

export const PULL_VIEWS: ReadonlyArray<{ id: PullView; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All" },
  { id: "merged", label: "Merged" },
];

const OWN_INBOX_GROUPS: ReadonlySet<PullGroup> = new Set([
  "ready",
  "fixing",
  "progress",
]);

export const INBOX_COUNT_GROUPS: ReadonlySet<PullGroup> = new Set([
  "you",
  "ready",
  "fixing",
]);

export const COLLAPSED_PULL_GROUPS: Record<PullView, ReadonlySet<PullGroup>> = {
  inbox: new Set(["snoozed"]),
  mine: new Set(["draft", "snoozed", "closed"]),
  all: new Set(["draft", "snoozed", "closed"]),
  merged: new Set(),
};

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function needsViewer(
  status: PullStatus,
  author: string,
  viewer: string | null,
): boolean {
  const group = pullGroup(status, author, viewer);
  if (group === "you") return true;
  return (
    viewer !== null && sameLogin(author, viewer) && OWN_INBOX_GROUPS.has(group)
  );
}

export function inPullView(
  view: PullView,
  pull: { pr: PullStatus; author: string; group: PullGroup },
  viewer: string | null,
): boolean {
  switch (view) {
    case "inbox":
      return needsViewer(pull.pr, pull.author, viewer);
    case "mine":
      return (
        pull.group !== "merged" &&
        viewer !== null &&
        sameLogin(pull.author, viewer)
      );
    case "all":
      return pull.group !== "merged";
    case "merged":
      return pull.group === "merged";
  }
}

export function isViewerReviewRequested(
  status: PullStatus,
  viewer: string | null,
): boolean {
  return (
    viewer !== null &&
    status.state === "open" &&
    status.review.requested.some((login) => sameLogin(login, viewer))
  );
}

export function pullGroup(
  status: PullStatus,
  author: string,
  viewer: string | null,
  extra: PullGroupExtra = {},
): PullGroup {
  if (status.attention === "merged") return "merged";
  if (status.attention === "closed") return "closed";
  if (extra.snoozed === true) return "snoozed";
  if (isViewerReviewRequested(status, viewer)) return "you";
  if (
    status.attention === "changes_requested" &&
    viewer !== null &&
    sameLogin(author, viewer)
  ) {
    return "you";
  }
  switch (status.attention) {
    case "ready_to_merge":
      return "ready";
    case "conflicts":
    case "checks_failed":
    case "changes_requested":
      return "fixing";
    case "checks_pending":
    case "queued":
      return "progress";
    case "review_requested":
      return "review";
    case "draft":
      return "draft";
    case "none":
      return "open";
  }
}

export type PullTone =
  | "action"
  | "ready"
  | "merged"
  | "you"
  | "waiting"
  | "closed"
  | "working";

export interface PullGlyph {
  icon: string;
  tone: PullTone;
  label: string;
}

export function pullGlyph(status: PullStatus, group: PullGroup): PullGlyph {
  if (group === "snoozed") {
    return { icon: "TimeSchedule", tone: "waiting", label: "Snoozed" };
  }
  if (group === "you" && status.attention !== "changes_requested") {
    return { icon: "Eye", tone: "you", label: "Your review is requested" };
  }
  switch (status.attention) {
    case "ready_to_merge":
      return { icon: "CircleCheck", tone: "ready", label: "Ready to merge" };
    case "checks_failed":
      return { icon: "CircleX", tone: "action", label: "Checks failing" };
    case "conflicts":
      return { icon: "DiffConflict", tone: "action", label: "Conflicts" };
    case "changes_requested":
      return {
        icon: "AlertCircle",
        tone: "action",
        label: "Changes requested",
      };
    case "checks_pending":
      return { icon: "Clock", tone: "waiting", label: "Checks running" };
    case "queued":
      return { icon: "Clock", tone: "waiting", label: "Queued to merge" };
    case "review_requested":
      return { icon: "Eye", tone: "waiting", label: "Waiting for review" };
    case "draft":
      return { icon: "GitPullRequestDraft", tone: "waiting", label: "Draft" };
    case "merged":
      return { icon: "GitMerge", tone: "merged", label: "Merged" };
    case "closed":
      return {
        icon: "GitPullRequestClosed",
        tone: "closed",
        label: "Closed",
      };
    case "none":
      return { icon: "GitPullRequest", tone: "waiting", label: "Open" };
  }
}

const CHECKS_WORDS: Record<PullChecksState, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks running",
  no_checks: "No checks",
  unknown: "Checks unknown",
};

export function checksWords(state: PullChecksState): string {
  return CHECKS_WORDS[state];
}

export function pullNextStep(status: PullStatus, group: PullGroup): string {
  if (group === "you" && status.attention !== "changes_requested") {
    return "Your review is requested";
  }
  switch (status.attention) {
    case "merged":
      return `Merged into ${status.baseRefName}`;
    case "closed":
      return "Closed without merging";
    case "conflicts":
      return "Merge conflicts";
    case "changes_requested":
      return "Changes requested";
    case "queued":
      return "Queued to merge";
    case "review_requested":
      return status.review.state === "review_required"
        ? "Review required"
        : "Review requested";
    case "ready_to_merge":
      return status.review.state === "approved"
        ? "Approved"
        : checksWords(status.checks.state);
    case "none":
    case "checks_failed":
    case "checks_pending":
    case "draft":
      return checksWords(status.checks.state);
  }
}

export type AgentPreset = "fix" | "conflicts" | "feedback" | "review";

export function pullPreset(
  status: PullStatus,
  author: string,
  viewer: string | null,
): AgentPreset {
  if (viewer !== null && !sameLogin(author, viewer)) return "review";
  if (status.attention === "conflicts") return "conflicts";
  if (status.attention === "checks_failed") return "fix";
  if (status.attention === "changes_requested") return "feedback";
  return "review";
}

const MERGEABLE_STATES: ReadonlySet<string> = new Set([
  "CLEAN",
  "UNSTABLE",
  "HAS_HOOKS",
]);

export function hardMergeBlock(status: PullStatus): string | null {
  switch (status.attention) {
    case "merged":
      return "Already merged";
    case "closed":
      return "Reopen it first";
    case "draft":
      return "Mark it ready first";
    case "queued":
      return "Queued to merge";
    case "conflicts":
      return `Conflicts with ${status.baseRefName}`;
    default:
      return null;
  }
}

export function mergeBlockedReason(
  status: PullStatus,
  mergeStateStatus: string | null = null,
): string | null {
  const hard = hardMergeBlock(status);
  if (hard !== null) return hard;
  if (mergeStateStatus === "BEHIND") return `Behind ${status.baseRefName}`;
  if (mergeStateStatus === "BLOCKED") return "Blocked by rules";
  if (status.attention === "ready_to_merge") return null;
  if (
    mergeStateStatus !== null &&
    MERGEABLE_STATES.has(mergeStateStatus) &&
    status.mergeability === "mergeable"
  ) {
    return null;
  }
  switch (status.attention) {
    case "checks_failed":
      return "Checks failing";
    case "checks_pending":
      return "Checks running";
    case "changes_requested":
      return "Changes requested";
    case "review_requested":
      return status.review.state === "review_required"
        ? "Review required"
        : "Waiting for review";
    default:
      return "Waiting for GitHub";
  }
}

export interface StackPull {
  repo: string;
  number: number;
  pr: PullStatus;
}

function isOpenPull(pull: StackPull): boolean {
  return pull.pr.state === "open" || pull.pr.state === "draft";
}

export function stackChain<T extends StackPull>(
  pull: T,
  pulls: readonly T[],
): T[] | null {
  if (!isOpenPull(pull)) return null;
  const open = pulls.filter(
    (other) => other.repo === pull.repo && isOpenPull(other),
  );
  const native = pull.pr.stack;
  if (native !== null) {
    const chain = open
      .filter((other) => other.pr.stack?.number === native.number)
      .sort(
        (a, b) => (a.pr.stack?.position ?? 0) - (b.pr.stack?.position ?? 0),
      );
    return chain.length > 1 ? chain : null;
  }
  const byHead = new Map(
    open
      .filter((other) => !other.pr.isCrossRepository)
      .map((other) => [other.pr.headRefName, other]),
  );
  const below: T[] = [];
  const seen = new Set([pull.number]);
  for (
    let current = byHead.get(pull.pr.baseRefName);
    current !== undefined && !seen.has(current.number);
    current = byHead.get(current.pr.baseRefName)
  ) {
    seen.add(current.number);
    below.unshift(current);
  }
  const above: T[] = [];
  for (let current: T = pull; !current.pr.isCrossRepository;) {
    const next = open
      .filter(
        (other) =>
          other.pr.stack === null &&
          other.pr.baseRefName === current.pr.headRefName &&
          !seen.has(other.number),
      )
      .sort((a, b) => a.number - b.number)[0];
    if (next === undefined) break;
    seen.add(next.number);
    above.push(next);
    current = next;
  }
  const chain = [...below, pull, ...above];
  return chain.length > 1 ? chain : null;
}

export function stackPosition(
  pull: StackPull,
  chain: readonly StackPull[] | null,
): { index: number; size: number } | null {
  const native = pull.pr.stack;
  if (native !== null && native.size > 1) {
    return { index: native.position, size: native.size };
  }
  if (chain === null) return null;
  const at = chain.findIndex((entry) => entry.number === pull.number);
  return at < 0 ? null : { index: at + 1, size: chain.length };
}

export type PullStateTarget = "open" | "draft" | "closed";

export interface PullStateView {
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
}

export function pullStateCommands(
  current: PullStateView,
  target: PullStateTarget,
): Array<[verb: string, ...flags: string[]]> {
  if (current.state === "MERGED") {
    throw new Error("A merged pull request keeps its state.");
  }
  if (target === "closed") {
    return current.state === "CLOSED" ? [] : [["close"]];
  }
  const commands: Array<[verb: string, ...flags: string[]]> =
    current.state === "CLOSED" ? [["reopen"]] : [];
  if (target === "open" && current.isDraft) commands.push(["ready"]);
  if (target === "draft" && !current.isDraft) {
    commands.push(["ready", "--undo"]);
  }
  return commands;
}
