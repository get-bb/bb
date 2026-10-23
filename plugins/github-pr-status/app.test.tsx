// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type {
  ExperimentalThreadRowItemProps,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvironmentPullRequest, PullRequest } from "./contract.js";
import {
  PULL_REQUESTS_ANY_AGE_MS,
  pullRequestsReadContract,
} from "./read-contract.js";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(cleanup);

function thread(environmentId: string | null): PluginSidebarThread {
  return {
    id: "thr_row",
    projectId: "proj_row",
    title: "Row",
    titleFallback: null,
    displayTitle: "Row",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: "/projects/proj_row/threads/thr_row",
    isHidden: false,
    environment:
      environmentId === null
        ? null
        : {
            id: environmentId,
            name: null,
            branchName: "bb/row",
            path: "/work/row",
            isWorktree: true,
            providerId: null,
            workspaceDisplayKind: "other",
          },
    host: null,
    createdAt: 1,
    updatedAt: 1,
    lastReadAt: 1,
    latestAttentionAt: 1,
  };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 6143,
    title: "Share and persist GitHub PR refreshes",
    state: "open",
    url: "https://github.com/get-bb/bb/pull/6143",
    baseRefName: "main",
    headRefName: "bb/row",
    updatedAt: "2026-10-22T00:00:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "pending",
      totalCount: 14,
      passedCount: 11,
      failedCount: 0,
      pendingCount: 3,
    },
    review: { state: "none", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "checks_pending",
    ...overrides,
  };
}

const Item = app.threadRowItems[0]!.component;
function Row(props: ExperimentalThreadRowItemProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <Item {...props} />
    </TooltipProvider>
  );
}

function renderRow(
  props: ExperimentalThreadRowItemProps,
  rows: Record<string, EnvironmentPullRequest>,
) {
  return renderSlot<
    ExperimentalThreadRowItemProps,
    typeof pullRequestsReadContract
  >({ component: Row }, props, {
    experimental_rpcContract: pullRequestsReadContract,
    rpc: {
      pullRequests: ({ keys }) =>
        Object.fromEntries(keys.map((key) => [key, rows[key]!])),
    },
  });
}

describe("pull request row item", () => {
  it("reads nothing until the row is live, then draws the current-branch PR's state and checks", async () => {
    const pr = pullRequest();
    const rows: Record<string, EnvironmentPullRequest> = {
      env_row: {
        outcome: "available",
        pullRequest: pr,
      },
    };
    const view = renderRow({ thread: thread("env_row"), isLive: false }, rows);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.inspection.rpcCalls).toEqual([]);

    view.rerender(<Row thread={thread("env_row")} isLive />);
    const badge = await view.findByRole("img", {
      name: "Pull request #6143, open, checks running",
    });
    expect(badge.dataset.pullRequestBadge).toBe("open");
    expect(badge.dataset.pullRequestChecks).toBe("pending");
    expect(view.inspection.rpcCalls).toMatchObject([
      {
        method: "pullRequests",
        input: { keys: ["env_row"], maxAgeMs: PULL_REQUESTS_ANY_AGE_MS },
      },
    ]);
  });

  it.each<[string, EnvironmentPullRequest]>([
    ["there is no PR", { outcome: "absent" }],
    [
      "the lookup is unavailable",
      { outcome: "unavailable", message: "asleep" },
    ],
  ])("draws nothing when %s", async (_case, row) => {
    const view = renderRow(
      { thread: thread("env_row"), isLive: true },
      { env_row: row },
    );
    await waitFor(() => expect(view.inspection.rpcCalls).toHaveLength(1));
    expect(view.queryByRole("img")).toBeNull();
  });

  it("draws merged PRs without a checks dot", async () => {
    const pr = pullRequest({ state: "merged", attention: "merged" });
    const view = renderRow(
      { thread: thread("env_row"), isLive: true },
      {
        env_row: {
          outcome: "available",
          pullRequest: pr,
        },
      },
    );
    const badge = await view.findByRole("img", {
      name: "Pull request #6143, merged",
    });
    expect(badge.dataset.pullRequestChecks).toBeUndefined();
  });

  it("shows the number, title and check counts in a tooltip on hover", async () => {
    const pr = pullRequest();
    const view = renderRow(
      { thread: thread("env_row"), isLive: true },
      {
        env_row: {
          outcome: "available",
          pullRequest: pr,
        },
      },
    );
    const badge = await view.findByRole("img", {
      name: "Pull request #6143, open, checks running",
    });
    fireEvent.pointerEnter(badge);
    fireEvent.pointerMove(
      view.getByRole("img", {
        name: "Pull request #6143, open, checks running",
      }),
    );
    expect(
      await view.findAllByText("#6143 Share and persist GitHub PR refreshes"),
    ).not.toHaveLength(0);
    expect(
      (await view.findAllByText(/11 passed, 3 pending/)).length,
    ).toBeGreaterThan(0);
  });
});
