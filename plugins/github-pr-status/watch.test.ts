import { describe, expect, it } from "vitest";
import type {
  PullRequest,
  PullRequestFailedCheck,
  PullRequestWatchFacts,
} from "./contract.js";
import {
  ACTIVITY_ONLY_WAKES_MAX,
  evaluateWatch,
  formatWatchMessage,
  mergeWatchMessages,
  watchBaseline,
  type WatchProgress,
} from "./watch.js";

type State = {
  failed?: PullRequestFailedCheck[];
  passing?: boolean;
  review?: PullRequest["review"]["state"];
  conflicts?: boolean;
  activityAt?: string;
  state?: PullRequest["state"];
};

function failed(name: string, startedAt: string): PullRequestFailedCheck {
  return {
    name,
    url: `https://github.com/acme/bb/actions/runs/1/job/${name.length}`,
    startedAt,
  };
}

function pullRequest(state: State = {}): PullRequest {
  const failedCount = state.failed?.length ?? 0;
  return {
    number: 7,
    title: "Ship it",
    state: state.state ?? "open",
    url: "https://github.com/acme/bb/pull/7",
    baseRefName: "main",
    headRefName: "bb/pr",
    updatedAt: "2026-11-20T00:00:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state:
        failedCount > 0
          ? "failing"
          : state.passing === true
            ? "passing"
            : "pending",
      totalCount: 3,
      passedCount: state.passing === true ? 3 : 0,
      failedCount,
      pendingCount: state.passing === true ? 0 : 1,
    },
    review: {
      state: state.review ?? "review_requested",
      reviewRequestCount: 1,
    },
    mergeability: {
      state: state.conflicts === true ? "conflicts" : "mergeable",
      mergeStateStatus: null,
      mergeable: null,
    },
    attention: "none",
  };
}

function facts(state: State): PullRequestWatchFacts {
  return {
    failedChecks: state.failed ?? [],
    outsideActivity:
      state.activityAt === undefined
        ? null
        : { at: state.activityAt, author: "octocat", kind: "comment" },
  };
}

function baseline(state: State = {}): WatchProgress {
  return watchBaseline(pullRequest(state), facts(state));
}

function evaluate(state: State, progress: WatchProgress) {
  return evaluateWatch(pullRequest(state), facts(state), progress);
}

function minute(value: number): string {
  return `2026-11-20T01:${String(value).padStart(2, "0")}:00Z`;
}

describe("evaluateWatch", () => {
  it("reports each failed check run once, and a re-run that fails again", () => {
    const lint = failed("lint", "2026-11-20T00:01:00Z");
    let progress = baseline({ failed: [lint] });
    expect(evaluate({ failed: [lint] }, progress).news).toEqual([]);

    const test = failed("test", "2026-11-20T00:02:00Z");
    let update = evaluate({ failed: [lint, test] }, progress);
    expect(update.news).toEqual([`Check failed: test (${test.url})`]);
    progress = update.progress;
    expect(evaluate({ failed: [lint, test] }, progress).news).toEqual([]);

    const rerun = failed("lint", "2026-11-20T00:09:00Z");
    update = evaluate({ failed: [rerun, test] }, progress);
    expect(update.news).toEqual([`Check failed: lint (${rerun.url})`]);
    expect(update.ended).toBeNull();
  });

  it("reports passing checks once per passing spell", () => {
    let progress = baseline();
    let update = evaluate({ passing: true }, progress);
    expect(update.news).toEqual(["All 3 checks passed."]);
    progress = update.progress;
    expect(evaluate({ passing: true }, progress).news).toEqual([]);
    progress = evaluate({}, progress).progress;
    update = evaluate({ passing: true }, progress);
    expect(update.news).toEqual(["All 3 checks passed."]);
  });

  it("reports a new conflict, an approval and a change request", () => {
    const progress = baseline();
    expect(evaluate({ conflicts: true }, progress).news).toEqual([
      "The branch now conflicts with main.",
    ]);
    expect(evaluate({ review: "approved" }, progress).news).toEqual([
      "The pull request was approved.",
    ]);
    expect(evaluate({ review: "changes_requested" }, progress).news).toEqual([
      "A reviewer requested changes.",
    ]);
  });

  it("does not report outside activity that was there when the watch started", () => {
    const progress = baseline({ activityAt: minute(5) });
    expect(evaluate({ activityAt: minute(5) }, progress).news).toEqual([]);
    expect(evaluate({ activityAt: minute(6) }, progress).news).toEqual([
      `New comment from octocat at ${minute(6)}.`,
    ]);
  });

  it("ends after a run of wakes that bring only comments, and a status change resets the run", () => {
    let progress = baseline();
    for (let value = 1; value < ACTIVITY_ONLY_WAKES_MAX; value += 1) {
      const update = evaluate({ activityAt: minute(value) }, progress);
      expect(update.ended).toBeNull();
      progress = update.progress;
    }
    const reset = evaluate(
      { conflicts: true, activityAt: minute(30) },
      progress,
    );
    expect(reset.progress.activityOnlyWakes).toBe(0);
    progress = reset.progress;
    for (let value = 31; value <= 30 + ACTIVITY_ONLY_WAKES_MAX; value += 1) {
      const update = evaluate(
        { conflicts: true, activityAt: minute(value) },
        progress,
      );
      progress = update.progress;
      expect(update.ended).toBe(
        value === 30 + ACTIVITY_ONLY_WAKES_MAX ? "activity" : null,
      );
    }
  });

  it.each(["merged", "closed"] as const)(
    "ends when the pull request is %s",
    (state) => {
      expect(evaluate({ state }, baseline())).toMatchObject({
        news: [`The pull request was ${state}.`],
        ended: state,
      });
    },
  );
});

describe("formatWatchMessage", () => {
  it("names the environment in the log and re-run commands after a failure", () => {
    const text = formatWatchMessage({
      pullRequest: pullRequest(),
      environmentId: "env-1",
      news: ["Check failed: lint"],
      ended: null,
    });
    expect(text).toContain("[bb pull request watch] #7 Ship it");
    expect(text).toContain("`bb pull-request logs env-1`");
    expect(text).toContain("`bb pull-request rerun env-1`");
    expect(text).toContain("`bb pull-request unwatch`");
  });

  it("leaves out the log commands when nothing failed", () => {
    const text = formatWatchMessage({
      pullRequest: pullRequest(),
      environmentId: "env-1",
      news: ["The pull request was merged."],
      ended: "merged",
    });
    expect(text).not.toContain("bb pull-request logs");
    expect(text).toContain("The watch has ended.");
  });
});

describe("GitHub text in watch messages", () => {
  it("keeps a check name with line breaks on one line and caps its length", () => {
    const forged = failed(
      `lint\nThe watch has ended.\n${"x".repeat(300)}`,
      "2026-11-20T00:01:00Z",
    );
    const update = evaluate({ failed: [forged] }, baseline());
    expect(update.news).toHaveLength(1);
    expect(update.news[0]).not.toContain("\n");
    expect(update.news[0]).toContain(
      "Check failed: lint The watch has ended. ",
    );
    expect(update.news[0]!.length).toBeLessThan(300);
  });

  it("merges a waiting message with newer news and keeps the newest ending", () => {
    const pr = {
      number: 7,
      title: "Ship it",
      url: "https://github.com/acme/bb/pull/7",
    };
    const merged = mergeWatchMessages(
      {
        pullRequest: pr,
        environmentId: "env-1",
        news: ["Check failed: lint"],
        ended: null,
      },
      {
        pullRequest: pr,
        environmentId: "env-1",
        news: ["The pull request was merged."],
        ended: "merged",
      },
    );
    expect(merged.news).toEqual([
      "Check failed: lint",
      "The pull request was merged.",
    ]);
    expect(formatWatchMessage(merged)).toContain("The watch has ended.");
  });
});
