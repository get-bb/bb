// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import type { EnvironmentPullRequest, PullRequest } from "./contract.js";
import { pullRequestsReadContract } from "./read-contract.js";

const app = await loadPluginApp(() => import("./app.js"));
afterEach(cleanup);

function thread(
  environmentId: string | null,
  id = "thr_row",
): PluginSidebarThread {
  return {
    id,
    projectId: "proj_row",
    title: "Row",
    titleFallback: null,
    displayTitle: "Row",
    parentThreadId: null,
    parentNotifications: "auto",
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

const passingChecks: PullRequest["checks"] = {
  state: "passing",
  totalCount: 14,
  passedCount: 14,
  failedCount: 0,
  pendingCount: 0,
};

const registration = app.threadRowMetadata[0]!;
interface RowProps {
  thread: PluginSidebarThread;
  listed?: readonly PluginSidebarThread[];
}
function Row({ thread, listed = [thread] }: RowProps) {
  const data = registration.useData?.({ threads: listed });
  const Item = registration.component;
  return (
    <TooltipProvider delayDuration={0}>
      <Item thread={thread} data={data} />
    </TooltipProvider>
  );
}

function renderRow(
  props: RowProps,
  rows: Record<string, EnvironmentPullRequest>,
) {
  return renderSlot<RowProps, typeof pullRequestsReadContract>(
    { component: Row },
    props,
    {
      experimental_rpcContract: pullRequestsReadContract,
      rpc: {
        pullRequests: ({ keys }) =>
          Object.fromEntries(keys.map((key) => [key, rows[key]!])),
      },
    },
  );
}

describe("pull request row metadata", () => {
  it("reads the row's PR and draws its state and checks", async () => {
    const pr = pullRequest();
    const rows: Record<string, EnvironmentPullRequest> = {
      env_row: {
        outcome: "available",
        pullRequest: pr,
      },
    };
    const view = renderRow({ thread: thread("env_row") }, rows);
    const badge = await view.findByRole("img", {
      name: "Pull request #6143, open, checks running",
    });
    expect(badge.dataset.pullRequestBadge).toBe("open");
    expect(badge.textContent).toBe("#6143");
    expect(view.inspection.rpcCalls).toMatchObject([
      {
        method: "pullRequests",
        input: { keys: ["env_row"] },
      },
    ]);
  });

  it("reads every listed row again in one request when the page shows", async () => {
    const view = renderRow(
      {
        thread: thread("env_row"),
        listed: [thread("env_row"), thread("env_other", "thr_other")],
      },
      {
        env_row: { outcome: "available", pullRequest: pullRequest() },
        env_other: { outcome: "absent" },
      },
    );
    await view.findByRole("img", { name: /Pull request #6143/ });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(view.inspection.rpcCalls).toHaveLength(2));
    expect(view.inspection.rpcCalls[1]).toMatchObject({
      method: "pullRequests",
      input: { keys: ["env_other", "env_row"] },
    });
  });

  it("reads every listed thread's environment once, in one request", async () => {
    const view = renderRow(
      {
        thread: thread("env_row"),
        listed: [
          thread("env_row"),
          thread("env_other", "thr_other"),
          thread("env_row", "thr_same_env"),
          thread(null, "thr_no_env"),
        ],
      },
      {
        env_row: { outcome: "available", pullRequest: pullRequest() },
        env_other: { outcome: "absent" },
      },
    );
    await view.findByRole("img", { name: /Pull request #6143/ });
    expect(view.inspection.rpcCalls).toMatchObject([
      { method: "pullRequests", input: { keys: ["env_other", "env_row"] } },
    ]);
  });

  it.each<[string, EnvironmentPullRequest]>([
    ["there is no PR", { outcome: "absent" }],
    [
      "the lookup is unavailable",
      { outcome: "unavailable", message: "asleep" },
    ],
  ])("draws nothing when %s", async (_case, row) => {
    const view = renderRow({ thread: thread("env_row") }, { env_row: row });
    await waitFor(() => expect(view.inspection.rpcCalls).toHaveLength(1));
    expect(view.queryByRole("img")).toBeNull();
  });

  it.each<[Partial<PullRequest>, string]>([
    [{ checks: passingChecks }, "open, checks passing"],
    [
      { checks: { ...passingChecks, state: "failing" } },
      "open, checks failing",
    ],
    [{ attention: "conflicts" }, "open, conflicts, checks running"],
    [{ checks: { ...passingChecks, state: "no_checks" } }, "open"],
    [
      { state: "draft", checks: { ...passingChecks, state: "failing" } },
      "draft, checks failing",
    ],
    [{ state: "merged", attention: "merged" }, "merged"],
  ])("labels %o as %s", async (overrides, expected) => {
    const view = renderRow(
      { thread: thread("env_row") },
      {
        env_row: {
          outcome: "available",
          pullRequest: pullRequest(overrides),
        },
      },
    );
    expect(
      await view.findByRole("img", { name: `Pull request #6143, ${expected}` }),
    ).toBeTruthy();
  });

  it("draws a glyph only while checks run, after they fail, or on conflicts", async () => {
    const glyphs = async (overrides: Partial<PullRequest>) => {
      const view = renderRow(
        { thread: thread("env_row") },
        {
          env_row: {
            outcome: "available",
            pullRequest: pullRequest(overrides),
          },
        },
      );
      const badge = await view.findByRole("img", {
        name: /Pull request #6143/,
      });
      const count = badge.childNodes.length;
      view.unmount();
      return count;
    };
    expect(await glyphs({ checks: passingChecks })).toBe(1);
    expect(
      await glyphs({ checks: { ...passingChecks, state: "failing" } }),
    ).toBe(2);
    expect(
      await glyphs({ checks: { ...passingChecks, state: "pending" } }),
    ).toBe(2);
    expect(
      await glyphs({ attention: "conflicts", checks: passingChecks }),
    ).toBe(2);
  });

  it("shows the number, title and check counts in a tooltip on hover", async () => {
    const pr = pullRequest();
    const view = renderRow(
      { thread: thread("env_row") },
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
