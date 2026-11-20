import { z } from "zod";
import type {
  PullRequest,
  PullRequestFailedCheck,
  PullRequestWatchFacts,
} from "./contract.js";

export const ACTIVITY_ONLY_WAKES_MAX = 10;
export const WATCH_UNAVAILABLE_LIMIT_MS = 15 * 60_000;
export const WATCH_MESSAGE_PREFIX = "[bb pull request watch]";
const GITHUB_TEXT_MAX_CHARS = 200;

export function githubText(value: string): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > GITHUB_TEXT_MAX_CHARS
    ? `${text.slice(0, GITHUB_TEXT_MAX_CHARS)}...`
    : text;
}

export const watchProgressSchema = z
  .object({
    failures: z.array(z.string()),
    passing: z.boolean(),
    conflicts: z.boolean(),
    review: z.enum([
      "approved",
      "changes_requested",
      "review_required",
      "review_requested",
      "none",
    ]),
    outsideActivityAt: z.string().nullable(),
    activityOnlyWakes: z.number().int().nonnegative(),
  })
  .strict();
export type WatchProgress = z.infer<typeof watchProgressSchema>;

export type WatchUpdate = {
  news: string[];
  progress: WatchProgress;
  ended: "merged" | "closed" | "activity" | null;
};

function failureKey(check: PullRequestFailedCheck): string {
  return `${check.name}\u0000${check.startedAt ?? ""}`;
}

export function watchBaseline(
  pr: PullRequest,
  facts: PullRequestWatchFacts,
): WatchProgress {
  return {
    failures: facts.failedChecks.map(failureKey),
    passing: pr.checks.state === "passing",
    conflicts: pr.mergeability.state === "conflicts",
    review: pr.review.state,
    outsideActivityAt: facts.outsideActivity?.at ?? null,
    activityOnlyWakes: 0,
  };
}

export function evaluateWatch(
  pr: PullRequest,
  facts: PullRequestWatchFacts,
  progress: WatchProgress,
): WatchUpdate {
  if (pr.state === "merged" || pr.state === "closed")
    return {
      news: [`The pull request was ${pr.state}.`],
      progress,
      ended: pr.state,
    };
  const news: string[] = [];
  const reported = new Set(progress.failures);
  for (const check of facts.failedChecks) {
    if (reported.has(failureKey(check))) continue;
    news.push(
      `Check failed: ${githubText(check.name)}${check.url === null ? "" : ` (${githubText(check.url)})`}`,
    );
  }
  const passing = pr.checks.state === "passing";
  if (passing && !progress.passing)
    news.push(`All ${pr.checks.totalCount} checks passed.`);
  const conflicts = pr.mergeability.state === "conflicts";
  if (conflicts && !progress.conflicts)
    news.push(`The branch now conflicts with ${pr.baseRefName}.`);
  if (pr.review.state !== progress.review) {
    if (pr.review.state === "approved")
      news.push("The pull request was approved.");
    if (pr.review.state === "changes_requested")
      news.push("A reviewer requested changes.");
  }
  const statusNews = news.length;
  const activity = facts.outsideActivity;
  if (
    activity !== null &&
    (progress.outsideActivityAt === null ||
      Date.parse(activity.at) > Date.parse(progress.outsideActivityAt))
  )
    news.push(
      `New ${activity.kind} from ${activity.author === null ? "someone else" : githubText(activity.author)} at ${activity.at}.`,
    );
  const activityOnlyWakes =
    news.length === 0
      ? progress.activityOnlyWakes
      : statusNews > 0
        ? 0
        : progress.activityOnlyWakes + 1;
  return {
    news,
    progress: {
      failures: facts.failedChecks.map(failureKey),
      passing,
      conflicts,
      review: pr.review.state,
      outsideActivityAt: activity?.at ?? progress.outsideActivityAt,
      activityOnlyWakes,
    },
    ended: activityOnlyWakes >= ACTIVITY_ONLY_WAKES_MAX ? "activity" : null,
  };
}

export type WatchMessage = {
  pullRequest: { number: number; title: string | null; url: string };
  environmentId: string;
  news: readonly string[];
  ended: WatchUpdate["ended"] | "stopped";
};

export function mergeWatchMessages(
  older: WatchMessage,
  newer: WatchMessage,
): WatchMessage {
  return { ...newer, news: [...older.news, ...newer.news] };
}

export function formatWatchMessage(args: WatchMessage): string {
  const { pullRequest, environmentId } = args;
  const lines = [
    pullRequest.title === null
      ? `${WATCH_MESSAGE_PREFIX} #${pullRequest.number}`
      : `${WATCH_MESSAGE_PREFIX} #${pullRequest.number} ${githubText(pullRequest.title)}`,
    pullRequest.url,
    ...args.news.map((line) => `- ${line}`),
  ];
  if (args.news.some((line) => line.startsWith("Check failed:")))
    lines.push(
      `Read the failing logs with \`bb pull-request logs ${environmentId}\`. Re-run a flaky check with \`bb pull-request rerun ${environmentId}\`.`,
    );
  switch (args.ended) {
    case "merged":
    case "closed":
      lines.push("The watch has ended.");
      break;
    case "activity":
      lines.push(
        `The watch ended after ${ACTIVITY_ONLY_WAKES_MAX} messages in a row that brought only comments or reviews. Run \`bb pull-request watch\` to watch again.`,
      );
      break;
    case "stopped":
      lines.push("Run `bb pull-request watch` to watch again.");
      break;
    case null:
      lines.push("The watch continues. `bb pull-request unwatch` stops it.");
      break;
  }
  return lines.join("\n");
}
