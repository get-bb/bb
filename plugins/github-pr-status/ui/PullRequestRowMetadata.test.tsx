// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequest } from "../contract";
import { PullRequestBadge } from "./PullRequestRowMetadata";

const pullRequest: PullRequest = {
  number: 73,
  title: "Update branch",
  url: "https://github.com/acme/example/pull/73",
  state: "open",
  baseRefName: "main",
  headRefName: "update",
  updatedAt: "2026-11-05T12:00:00Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: { state: "approved", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

beforeEach(() => {
  vi.stubGlobal("__bbPluginRuntime", undefined);
  installTestPluginRuntime();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("thread row pull request badge", () => {
  it.each<{
    name: string;
    state: PullRequest["state"];
    attention: PullRequest["attention"];
    checks: PullRequest["checks"]["state"];
    review: PullRequest["review"]["state"];
    className: string;
  }>([
    {
      name: "requested changes",
      state: "open",
      attention: "changes_requested",
      checks: "passing",
      review: "changes_requested",
      className: "text-destructive-text",
    },
    {
      name: "failing checks",
      state: "open",
      attention: "checks_failed",
      checks: "failing",
      review: "approved",
      className: "text-warning-text",
    },
    {
      name: "running checks",
      state: "open",
      attention: "checks_pending",
      checks: "pending",
      review: "approved",
      className: "text-timeline-accent",
    },
    {
      name: "ready to merge",
      state: "open",
      attention: "ready_to_merge",
      checks: "passing",
      review: "approved",
      className: "text-success-foreground",
    },
    {
      name: "draft with failing checks",
      state: "draft",
      attention: "draft",
      checks: "failing",
      review: "none",
      className: "text-subtle-foreground",
    },
    {
      name: "merged with stale failure",
      state: "merged",
      attention: "merged",
      checks: "failing",
      review: "changes_requested",
      className: "text-pr-merged",
    },
    {
      name: "closed with stale pending checks",
      state: "closed",
      attention: "closed",
      checks: "pending",
      review: "approved",
      className: "text-destructive-text",
    },
    {
      name: "changes requested with running checks",
      state: "open",
      attention: "changes_requested",
      checks: "pending",
      review: "changes_requested",
      className: "text-destructive-text",
    },
    {
      name: "conflicts with running checks",
      state: "open",
      attention: "conflicts",
      checks: "pending",
      review: "approved",
      className: "text-destructive-text",
    },
    {
      name: "review requested with running checks",
      state: "open",
      attention: "review_requested",
      checks: "pending",
      review: "review_required",
      className: "text-timeline-accent",
    },
  ])(
    "colors the PR number for $name",
    ({ state, attention, checks, review, className }) => {
      render(
        <PullRequestBadge
          pullRequest={{
            ...pullRequest,
            state,
            attention,
            checks: {
              state: checks,
              totalCount: 1,
              passedCount: checks === "passing" ? 1 : 0,
              failedCount: checks === "failing" ? 1 : 0,
              pendingCount: checks === "pending" ? 1 : 0,
            },
            review: { state: review, reviewRequestCount: 0 },
          }}
        />,
      );
      expect(screen.getByText("#73").className).toBe(className);
    },
  );
});
