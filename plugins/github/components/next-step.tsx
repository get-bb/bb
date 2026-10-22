import type { ReactNode } from "react";
import {
  experimental_Icon as Icon,
  UrlLink,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Skeleton } from "@/components/ui/skeleton";
import { checkCounts, stateNameOf } from "../app-logic.js";
import {
  hardMergeBlock,
  isViewerReviewRequested,
  mergeBlockedReason,
  type PullStatus,
} from "../pull-status.js";
import { MergeButton, type MergeTarget } from "./merge.js";
import { activityLabel, type Activity } from "./pull-actions.js";
import {
  AgentGlyph,
  compactAge,
  plural,
  relativeTime,
  SpinnerIcon,
  TEXT_BUTTON_CLASS,
  type AgentInfo,
  type PullCheck,
  type PullDetail,
  type RepoSettings,
} from "./shared.js";

const CHANGED_ICON: Record<string, string> = {
  pending: "GitPullRequest",
  OPEN: "GitPullRequest",
  DRAFT: "GitPullRequestDraft",
  CLOSED: "GitPullRequestClosed",
  MERGED: "GitMerge",
};

const ACTION_CLASS = `${COARSE_POINTER_PROMPT_ACTION_BUTTON_CLASS} @max-[35rem]/github:w-full`;

function Card({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Next step"
      data-next-step=""
      tabIndex={-1}
      className="flex flex-col gap-3 rounded-lg border border-border p-4 outline-none"
    >
      {children}
    </section>
  );
}

function CardHead({
  icon,
  tone,
  title,
  detail,
  busy = false,
}: {
  icon: string;
  tone: string;
  title: ReactNode;
  detail: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex h-5 w-4 shrink-0 items-center justify-center">
        {busy ? (
          <SpinnerIcon className={`size-4 ${tone}`} />
        ) : (
          <Icon name={icon} className={`size-4 ${tone}`} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm leading-5 font-semibold text-foreground ${busy ? "animate-shine" : ""}`}
        >
          {title}
        </p>
        {detail === null ? null : (
          <p className="text-xs text-pretty text-subtle-foreground">{detail}</p>
        )}
      </div>
    </div>
  );
}

function CardBody({ children }: { children: ReactNode }) {
  return <div className="ml-6 @max-[35rem]/github:ml-0">{children}</div>;
}

function CardActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-6 flex flex-wrap gap-2 @max-[35rem]/github:ml-0 @max-[35rem]/github:flex-col">
      {children}
    </div>
  );
}

export function ChecksBar({ checks }: { checks: readonly PullCheck[] }) {
  const counts = checkCounts(checks);
  const parts: Array<[count: number, tone: string]> = [
    [counts.passed, "bg-success"],
    [counts.pending, "bg-warning"],
    [counts.failed, "bg-destructive"],
    [counts.skipped, "bg-muted"],
  ];
  return (
    <div aria-hidden className="flex h-1 gap-0.5 overflow-hidden rounded-full">
      {parts.map(([count, tone]) =>
        count === 0 ? null : (
          <span
            key={tone}
            className={`block h-full ${tone} transition-[flex-grow] duration-500 motion-reduce:transition-none`}
            style={{ flexGrow: count }}
          />
        ),
      )}
    </div>
  );
}

const FAILING_SHOWN = 3;

function FailingList({
  checks,
  onShowChecks,
}: {
  checks: readonly PullCheck[];
  onShowChecks: () => void;
}) {
  const failed = checks.filter((check) => check.status === "failure");
  if (failed.length === 0) return null;
  const hidden = failed.length - FAILING_SHOWN;
  return (
    <CardBody>
      <ul className="flex flex-col">
        {failed.slice(0, FAILING_SHOWN).map((check) => (
          <li
            key={`${check.workflow ?? ""}/${check.name}`}
            className="flex min-h-7 items-center gap-2"
          >
            <Icon
              name="CircleX"
              className="size-3.5 shrink-0 text-destructive"
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
              {check.name}
            </span>
            {check.url.length > 0 ? (
              <UrlLink
                href={check.url}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-subtle-foreground hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:h-9"
              >
                Log
                <Icon name="ExternalLink" className="size-3" />
              </UrlLink>
            ) : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={`-ml-2 ${TEXT_BUTTON_CLASS}`}
          onClick={onShowChecks}
        >
          {hidden} more in Checks
        </Button>
      ) : null}
    </CardBody>
  );
}

function agentTask(title: string): string {
  return title.replace(/ · \S+#\d+(: .*)?$/, "");
}

export function AgentLine({
  agent,
  now,
  onOpenThread,
  inset = true,
}: {
  agent: AgentInfo;
  now: number;
  onOpenThread: () => void;
  inset?: boolean;
}) {
  const state =
    agent.state === "running"
      ? `Agent working · ${compactAge(agent.startedAt, now)}`
      : agent.state === "waiting"
        ? "Agent waiting for your answer"
        : `Agent finished ${relativeTime(agent.updatedAt, now)}`;
  return (
    <div
      className={`flex min-h-8 items-center gap-2 text-xs text-subtle-foreground ${
        inset
          ? "ml-6 border-t border-border pt-3 @max-[35rem]/github:ml-0"
          : "rounded-lg border border-border py-2 pr-2 pl-3"
      }`}
    >
      {agent.indicator === "none" && agent.state !== "running" ? null : (
        <span className="flex size-4 shrink-0 items-center justify-center">
          <AgentGlyph agent={agent} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{state}</span> ·{" "}
        {agentTask(agent.title)}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={`-my-1 shrink-0 ${TEXT_BUTTON_CLASS}`}
        onClick={onOpenThread}
      >
        Open thread
      </Button>
    </div>
  );
}

interface CardShape {
  rows: number;
  more: boolean;
  bar: boolean;
  actions: number;
  agent: boolean;
}

function cardShape(
  status: PullStatus | null,
  viewer: string | null,
  agent: AgentInfo | null,
  canMerge: boolean,
): CardShape {
  const shape = { rows: 0, more: false, bar: false, actions: 2, agent: false };
  if (status === null) return shape;
  if (status.state === "merged") return { ...shape, actions: 0 };
  if (status.state === "closed") return { ...shape, actions: 1 };
  const failed =
    status.checks.state === "failing" ? Math.max(status.checks.failed, 1) : 0;
  const open = {
    ...shape,
    rows: Math.min(failed, FAILING_SHOWN),
    more: failed > FAILING_SHOWN,
    agent: agent !== null,
  };
  const startAgent = agent !== null && agent.state !== "idle" ? 0 : 1;
  const merge = canMerge && hardMergeBlock(status) === null ? 1 : 0;
  const mine = isViewerReviewRequested(status, viewer);
  switch (
    mine && status.attention !== "changes_requested"
      ? "review_requested"
      : status.attention
  ) {
    case "queued":
      return { ...open, actions: 0 };
    case "checks_failed":
      return { ...open, actions: 1 + merge + startAgent };
    case "conflicts":
    case "draft":
    case "ready_to_merge":
      return { ...open, actions: 1 + startAgent };
    case "changes_requested":
      return { ...open, actions: merge + startAgent };
    case "review_requested":
      return { ...open, actions: mine ? 1 + merge + startAgent : merge };
    case "checks_pending":
      return { ...open, bar: true, actions: merge };
    default:
      return { ...open, actions: merge };
  }
}

export function NextStepSkeleton({
  status = null,
  viewer = null,
  agent = null,
  canMerge = true,
}: {
  status?: PullStatus | null;
  viewer?: string | null;
  agent?: AgentInfo | null;
  canMerge?: boolean;
}) {
  const shape = cardShape(status, viewer, agent, canMerge);
  return (
    <Card>
      <div aria-hidden className="flex items-start gap-2">
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          <Skeleton className="size-4 rounded-full" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex h-5 items-center">
            <Skeleton className="h-3 w-2/5" />
          </span>
          <span className="flex h-4 items-center max-md:pointer-coarse:h-5">
            <Skeleton className="h-2.5 w-3/5" />
          </span>
        </div>
      </div>
      {shape.rows > 0 ? (
        <CardBody>
          <ul aria-hidden className="flex flex-col">
            {Array.from({ length: shape.rows }, (_, index) => (
              <li
                key={index}
                className="flex h-7 items-center gap-2 max-md:pointer-coarse:h-9"
              >
                <Skeleton className="size-3.5 shrink-0 rounded-full" />
                <Skeleton
                  className={`h-2.5 ${index % 2 ? "w-1/3" : "w-2/5"}`}
                />
              </li>
            ))}
          </ul>
          {shape.more ? (
            <span
              aria-hidden
              className="flex h-7 items-center max-md:pointer-coarse:h-10"
            >
              <Skeleton className="h-2.5 w-24" />
            </span>
          ) : null}
        </CardBody>
      ) : null}
      {shape.bar ? (
        <CardBody>
          <Skeleton aria-hidden className="h-1 rounded-full" />
        </CardBody>
      ) : null}
      {shape.actions > 0 ? (
        <CardActions>
          {Array.from({ length: shape.actions }, (_, index) => (
            <Skeleton
              key={index}
              aria-hidden
              className={`h-8 max-md:pointer-coarse:h-10 @max-[35rem]/github:w-full ${index ? "w-36" : "w-32"}`}
            />
          ))}
        </CardActions>
      ) : null}
      {shape.agent ? (
        <div
          aria-hidden
          className="ml-6 flex min-h-8 items-center gap-2 border-t border-border pt-3 @max-[35rem]/github:ml-0"
        >
          <Skeleton className="size-4 shrink-0 rounded-full" />
          <Skeleton className="h-2.5 flex-1" />
          <Skeleton className="-my-1 h-7 w-20 shrink-0 max-md:pointer-coarse:h-10" />
        </div>
      ) : null}
    </Card>
  );
}

export interface NextStepHandlers {
  onMergeMenuOpenChange: (open: boolean) => void;
  onShowChecks: () => void;
  onRerun: () => void;
  onReady: () => void;
  onReopen: () => void;
  onStartAgent: () => void;
  onOpenThread: () => void;
}

function GitHubLink({ url, label }: { url: string; label: string }) {
  const navigate = useBbNavigate();
  return (
    <Button
      type="button"
      size="sm"
      className={ACTION_CLASS}
      onClick={() => navigate.openUrl(url)}
    >
      {label}
      <Icon name="ExternalLink" />
    </Button>
  );
}

export function NextStepCard({
  pull,
  status,
  viewer,
  activity,
  agent,
  now,
  rerunning,
  mergeMenuOpen,
  handlers,
}: {
  pull: PullDetail;
  status: PullStatus;
  viewer: string | null;
  activity: Activity | null;
  agent: AgentInfo | null;
  now: number;
  rerunning: boolean;
  mergeMenuOpen: boolean;
  handlers: NextStepHandlers;
}) {
  if (activity?.kind === "merging") {
    return (
      <Card>
        <CardHead
          icon="GitMerge"
          tone="text-muted-foreground"
          title={activityLabel(activity)}
          detail={`${pull.headRefName} → ${pull.baseRefName}`}
          busy
        />
        <CardActions>
          <Button
            type="button"
            size="sm"
            className={ACTION_CLASS}
            disabled
            aria-busy
          >
            <SpinnerIcon />
            Merging…
          </Button>
        </CardActions>
      </Card>
    );
  }
  if (
    activity?.kind === "changing" ||
    (activity?.kind === "changed" && activity.state !== stateNameOf(status))
  ) {
    return (
      <Card>
        <CardHead
          icon={
            CHANGED_ICON[
              activity.kind === "changing" ? "pending" : activity.state
            ]
          }
          tone="text-muted-foreground"
          title={activity.label}
          detail={null}
          busy={activity.kind === "changing"}
        />
      </Card>
    );
  }
  if (status.state === "merged" || activity?.kind === "merged") {
    const by = pull.mergedBy === null ? "" : `by ${pull.mergedBy} · `;
    return (
      <Card>
        <CardHead
          icon="GitMerge"
          tone="text-pr-merged"
          title={`Merged into ${pull.baseRefName}`}
          detail={`${by}${relativeTime(pull.mergedAt ?? now, now)}`}
        />
      </Card>
    );
  }
  if (status.state === "closed") {
    return (
      <Card>
        <CardHead
          icon="GitPullRequestClosed"
          tone="text-destructive"
          title="Closed without merging"
          detail={`${pull.closedAt === null ? "Closed" : `Closed ${relativeTime(pull.closedAt, now)}`} · the branch ${pull.headRefExists ? "is kept" : "was deleted"}`}
        />
        {pull.viewerCanReopen ? (
          <CardActions>
            <Button
              type="button"
              size="sm"
              className={ACTION_CLASS}
              onClick={handlers.onReopen}
            >
              <Icon name="GitPullRequestArrow" />
              Reopen
            </Button>
          </CardActions>
        ) : null}
      </Card>
    );
  }
  const counts = checkCounts(pull.checks);
  const target: MergeTarget = {
    repo: pull.repo,
    number: pull.number,
    baseRefName: pull.baseRefName,
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid.length > 0 ? pull.headRefOid : null,
    isCrossRepository: pull.isCrossRepository,
    canDeleteBranch: pull.viewerCanDeleteHeadRef,
  };
  const mergeable =
    pull.viewerCanMerge &&
    mergeBlockedReason(status, pull.mergeStateStatus) === null;
  const known: RepoSettings = {
    viewerCanWrite: pull.viewerCanMerge,
    mergeMethods: pull.mergeMethods,
    defaultMergeMethod: pull.defaultMergeMethod,
    deleteBranchOnMerge: pull.deleteBranchOnMerge,
  };
  const merge = (primary: boolean) =>
    mergeable ? (
      <MergeButton
        target={target}
        known={known}
        primary={primary}
        menuOpen={mergeMenuOpen}
        onMenuOpenChange={handlers.onMergeMenuOpenChange}
      />
    ) : null;
  const agentBusy = agent !== null && agent.state !== "idle";
  const startAgent = agentBusy ? null : (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-keyshortcuts="A"
      className={ACTION_CLASS}
      onClick={handlers.onStartAgent}
    >
      <Icon name="Zap" />
      Start an agent…
    </Button>
  );
  const agentLine =
    agent === null ? null : (
      <AgentLine agent={agent} now={now} onOpenThread={handlers.onOpenThread} />
    );
  const passedLine = [
    counts.passed > 0 ? `${counts.passed} passed` : null,
    counts.skipped > 0 ? `${counts.skipped} skipped` : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const reviewing =
    isViewerReviewRequested(status, viewer) &&
    status.attention !== "changes_requested";
  switch (reviewing ? "review_requested" : status.attention) {
    case "queued":
      return (
        <Card>
          <CardHead
            icon="Clock"
            tone="text-muted-foreground"
            title="Queued to merge"
            detail="GitHub merges it when its turn in the queue comes."
          />
          {agentLine}
        </Card>
      );
    case "conflicts":
      return (
        <Card>
          <CardHead
            icon="DiffConflict"
            tone="text-destructive"
            title={`Conflicts with ${pull.baseRefName}`}
            detail="Resolve them before merging."
          />
          <FailingList
            checks={pull.checks}
            onShowChecks={handlers.onShowChecks}
          />
          <CardActions>
            <GitHubLink
              url={`${pull.url}/conflicts`}
              label="Resolve on GitHub"
            />
            {startAgent}
          </CardActions>
          {agentLine}
        </Card>
      );
    case "checks_failed":
      return (
        <Card>
          <CardHead
            icon="CircleX"
            tone="text-destructive"
            title={`${plural(Math.max(counts.failed, 1), "check")} failing`}
            detail={`${passedLine.length > 0 ? `${passedLine} · ` : ""}latest commit${pull.headCommittedAt === null ? "" : ` ${relativeTime(pull.headCommittedAt, now)}`}`}
          />
          <FailingList
            checks={pull.checks}
            onShowChecks={handlers.onShowChecks}
          />
          <CardActions>
            <Button
              type="button"
              size="sm"
              className={ACTION_CLASS}
              disabled={rerunning}
              aria-busy={rerunning ? true : undefined}
              onClick={handlers.onRerun}
            >
              {rerunning ? <SpinnerIcon /> : <Icon name="RotateCcw" />}
              {rerunning ? "Re-running…" : "Re-run failed checks"}
            </Button>
            {merge(false)}
            {startAgent}
          </CardActions>
          {agentLine}
        </Card>
      );
    case "changes_requested": {
      const reviewers = pull.reviewVerdicts
        .filter((verdict) => verdict.state === "CHANGES_REQUESTED")
        .map((verdict) => verdict.author);
      return (
        <Card>
          <CardHead
            icon="AlertCircle"
            tone="text-destructive"
            title="Changes requested"
            detail={
              reviewers.length > 0
                ? `${reviewers.join(", ")} asked for changes`
                : "A reviewer asked for changes"
            }
          />
          {mergeable || startAgent !== null ? (
            <CardActions>
              {merge(false)}
              {startAgent}
            </CardActions>
          ) : null}
          {agentLine}
        </Card>
      );
    }
    case "draft":
      return (
        <Card>
          <CardHead
            icon="GitPullRequestDraft"
            tone="text-muted-foreground"
            title="Draft"
            detail={
              status.checks.state === "passing"
                ? `${plural(counts.passed, "check")} passed`
                : status.checks.state === "pending"
                  ? "Checks running"
                  : "No checks have run yet"
            }
          />
          {pull.viewerCanUpdate || startAgent !== null ? (
            <CardActions>
              {pull.viewerCanUpdate ? (
                <Button
                  type="button"
                  size="sm"
                  className={ACTION_CLASS}
                  aria-keyshortcuts="R"
                  onClick={handlers.onReady}
                >
                  <Icon name="GitPullRequestArrow" />
                  Mark ready
                </Button>
              ) : null}
              {startAgent}
            </CardActions>
          ) : null}
          {agentLine}
        </Card>
      );
    case "review_requested": {
      const mine = isViewerReviewRequested(status, viewer);
      const context =
        status.attention === "checks_failed"
          ? `${plural(Math.max(counts.failed, 1), "check")} failing`
          : status.attention === "conflicts"
            ? `conflicts with ${pull.baseRefName}`
            : status.attention === "checks_pending"
              ? "checks running"
              : null;
      return (
        <Card>
          <CardHead
            icon="Eye"
            tone={mine ? "text-foreground" : "text-muted-foreground"}
            title={
              mine
                ? "Your review is requested"
                : status.review.state === "review_required"
                  ? "Review required"
                  : "Waiting for review"
            }
            detail={
              mine
                ? `${pull.author} asked you to review${context === null ? "" : ` · ${context}`}`
                : pull.reviewRequests.length > 0
                  ? `Requested from ${pull.reviewRequests.join(", ")}`
                  : "A review is required before merging"
            }
          />
          <FailingList
            checks={pull.checks}
            onShowChecks={handlers.onShowChecks}
          />
          {mine || mergeable ? (
            <CardActions>
              {mine ? (
                <GitHubLink
                  url={`${pull.url}/files`}
                  label="Review on GitHub"
                />
              ) : null}
              {merge(false)}
              {mine ? startAgent : null}
            </CardActions>
          ) : null}
          {agentLine}
        </Card>
      );
    }
    case "checks_pending":
      return (
        <Card>
          <CardHead
            icon="Clock"
            tone="text-muted-foreground"
            title="Checks running"
            detail={`${counts.passed + counts.failed + counts.skipped} of ${pull.checks.length} done`}
            busy
          />
          <CardBody>
            <ChecksBar checks={pull.checks} />
          </CardBody>
          {mergeable ? <CardActions>{merge(false)}</CardActions> : null}
          {agentLine}
        </Card>
      );
    case "ready_to_merge":
      return (
        <Card>
          <CardHead
            icon="CircleCheck"
            tone="text-success"
            title="Ready to merge"
            detail={`${status.review.state === "approved" ? "Approved · " : ""}${counts.passed > 0 ? "checks passed" : "no checks"} · no conflicts with ${pull.baseRefName}`}
          />
          <CardActions>
            {merge(true) ?? (
              <p className="py-1.5 text-xs text-subtle-foreground">
                You can't merge in {pull.repo}; someone with write access can.
              </p>
            )}
            {startAgent}
          </CardActions>
          {agentLine}
        </Card>
      );
    case "none":
    case "merged":
    case "closed": {
      const [title, detail] =
        pull.mergeStateStatus === "BLOCKED"
          ? ["Blocked by rules", "Branch protection blocks the merge for now."]
          : pull.mergeStateStatus === "BEHIND"
            ? [
                `Behind ${pull.baseRefName}`,
                "Update the branch before merging.",
              ]
            : status.mergeability === "unknown"
              ? [
                  "Waiting for GitHub",
                  "GitHub is still checking whether it can merge.",
                ]
              : status.checks.state === "no_checks"
                ? [
                    "No checks",
                    `Nothing runs on this branch, and it has no conflicts with ${pull.baseRefName}.`,
                  ]
                : [
                    "Checks unknown",
                    "GitHub didn't report a result for every check.",
                  ];
      const mergeControl = merge(false);
      return (
        <Card>
          <CardHead
            icon="GitPullRequest"
            tone="text-muted-foreground"
            title={title}
            detail={detail}
          />
          {mergeControl === null ? null : (
            <CardActions>{mergeControl}</CardActions>
          )}
          {agentLine}
        </Card>
      );
    }
  }
}
