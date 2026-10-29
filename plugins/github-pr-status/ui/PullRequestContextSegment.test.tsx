// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ExperimentalThreadContextSegmentReference } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentPullRequest, PullRequest } from "../contract";
import {
  PullRequestSegmentAction,
  PullRequestSegmentSummary,
  usePullRequestSegmentVisible,
} from "./PullRequestContextSegment";

const sdk = vi.hoisted(() => ({
  rows: {} as Record<string, EnvironmentPullRequest>,
  settings: { showPullRequest: true } as Record<string, boolean> | undefined,
  mutate: vi.fn(async () => ({ message: "Merged" })),
  isPending: false,
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useRpcKeyedQuery: () => ({
    data: sdk.rows,
    error: null,
    refetch: async () => {},
  }),
  experimental_useRpcMutation: () => ({
    mutate: sdk.mutate,
    isPending: sdk.isPending,
  }),
  useBbNavigate: () => ({ openUrl: () => false }),
  useSettings: () => ({ values: sdk.settings, isLoading: false }),
}));

vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

const PULL_REQUEST: PullRequest = {
  number: 128,
  title: "Show pull request status in the prompt context banner",
  state: "open",
  url: "https://github.com/acme/bb/pull/128",
  baseRefName: "main",
  headRefName: "bb/pr-context-banner",
  updatedAt: "2026-06-16T12:30:00Z",
  autoMerge: false,
  inMergeQueue: false,
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: { state: "none", reviewRequestCount: 0 },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

const SELF = {
  key: "bb--github-pr-status/pull-request",
  pluginId: "bb--github-pr-status",
};
const CHANGED_FILES = { key: "bb--git/changed-files", pluginId: "bb--git" };
const PARENT = { key: "bb--core/parent-thread", pluginId: "bb--core" };

function show(pullRequest: PullRequest) {
  sdk.rows = { env_1: { outcome: "available", pullRequest } };
}

const PARTS = {
  summary: PullRequestSegmentSummary,
  action: PullRequestSegmentAction,
};

function renderPart(
  part: keyof typeof PARTS,
  segments: readonly ExperimentalThreadContextSegmentReference[] = [SELF],
) {
  const Part = PARTS[part];
  return render(
    <Part
      threadId="thr_1"
      projectId="proj_1"
      environment={{ id: "env_1" }}
      segments={segments}
      isExpanded={false}
      onToggle={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  sdk.rows = {};
  sdk.settings = { showPullRequest: true };
  sdk.isPending = false;
  sdk.mutate.mockClear();
  window.localStorage.clear();
});

describe("pull request context segment", () => {
  it("shows only when the thread's environment has a pull request", () => {
    show(PULL_REQUEST);
    const input = { threadId: "thr_1", projectId: "proj_1" };
    expect(
      renderHook(() =>
        usePullRequestSegmentVisible({
          ...input,
          environment: { id: "env_1" },
        }),
      ).result.current,
    ).toBe(true);
    expect(
      renderHook(() =>
        usePullRequestSegmentVisible({ ...input, environment: null }),
      ).result.current,
    ).toBe(false);
    sdk.rows = { env_1: { outcome: "absent" } };
    expect(
      renderHook(() =>
        usePullRequestSegmentVisible({
          ...input,
          environment: { id: "env_1" },
        }),
      ).result.current,
    ).toBe(false);
  });

  it.each([
    ["off", { showPullRequest: false }],
    ["loading", undefined],
  ])("hides while the Show pull request setting is %s", (_state, settings) => {
    show(PULL_REQUEST);
    sdk.settings = settings;
    expect(
      renderHook(() =>
        usePullRequestSegmentVisible({
          threadId: "thr_1",
          projectId: "proj_1",
          environment: { id: "env_1" },
        }),
      ).result.current,
    ).toBe(false);
  });

  it("labels a standalone pull request without a redundant open state", () => {
    show(PULL_REQUEST);
    const { container } = renderPart("summary");

    expect(container.textContent).toContain("PR #128");
    expect(container.textContent).not.toContain("· Open");
    expect(container.textContent).not.toContain("Ready to merge");
    expect(container.querySelector("[data-promptbox-hide-compact]")).toBeNull();
  });

  it("keeps a standalone terminal state label", () => {
    show({ ...PULL_REQUEST, state: "closed", attention: "closed" });
    expect(renderPart("summary").container.textContent).toContain(
      "PR #128 · Closed",
    );
  });

  it.each([
    ["beside changed files", [SELF, CHANGED_FILES], "PR #128", true],
    ["beside a parent thread", [PARENT, SELF], null, false],
    ["among three segments", [PARENT, SELF, CHANGED_FILES], null, false],
  ] as const)("sizes the label %s", (_, segments, label, hiddenInCompact) => {
    show({ ...PULL_REQUEST, state: "closed", attention: "closed" });
    const { container } = renderPart("summary", segments);
    const link = screen.getByRole("link", { name: /Pull request 128:/ });
    if (label) {
      expect(container.textContent).toContain(label);
      expect(container.textContent).not.toContain("Closed");
    } else {
      expect(link.textContent).not.toContain("PR #128");
    }
    expect(
      container.querySelector("[data-promptbox-hide-compact]") !== null,
    ).toBe(hiddenInCompact);
  });

  it.each([
    ["checks_pending", false, null],
    ["checks_failed", false, null],
    ["checks_failed", true, null],
    ["checks_pending", true, null],
    ["ready_to_merge", true, null],
    ["queued", true, "Queued to merge"],
  ] as const)(
    "shows the next step and auto-merge for %s with auto-merge %s",
    (attention, autoMerge, label) => {
      show({
        ...PULL_REQUEST,
        autoMerge,
        inMergeQueue: attention === "queued",
        review: { state: "approved", reviewRequestCount: 0 },
        checks: {
          state: attention === "checks_failed" ? "failing" : "pending",
          totalCount: 1,
          passedCount: 0,
          failedCount: 0,
          pendingCount: 1,
        },
        attention,
      });
      const markup = renderPart("summary").container.innerHTML;

      if (label) {
        expect(markup).toContain(`>${label}</span>`);
      } else {
        expect(markup).not.toContain('aria-hidden="true">·</span>');
      }
      expect(markup.includes('aria-label="Auto-merge on"')).toBe(autoMerge);
      expect(markup).toContain(
        attention === "checks_failed"
          ? 'class="fill-destructive"'
          : 'class="fill-attention"',
      );
    },
  );

  it("keeps failed-check detail accessible without a visible label", () => {
    show({
      ...PULL_REQUEST,
      checks: {
        state: "failing",
        totalCount: 1,
        passedCount: 0,
        failedCount: 1,
        pendingCount: 0,
      },
      attention: "checks_failed",
    });
    const markup = renderPart("summary").container.innerHTML;

    expect(markup).not.toContain(">Checks failing</span>");
    expect(markup).toContain('title="Open, Checks failing"');
  });

  it.each([
    ["checked open", PULL_REQUEST, "min-w-13"],
    [
      "merged",
      {
        ...PULL_REQUEST,
        state: "merged" as const,
        attention: "merged" as const,
      },
      "min-w-8",
    ],
  ])("reserves the pill width a %s pull request needs", (_, pr, width) => {
    show(pr);
    renderPart("summary", [SELF, CHANGED_FILES]);
    const link = screen.getByRole("link", { name: /Pull request 128:/ });
    expect(
      ["min-w-8", "min-w-13"].filter((name) => link.classList.contains(name)),
    ).toEqual([width]);
  });

  it("offers Mark ready for a draft", () => {
    show({ ...PULL_REQUEST, state: "draft", attention: "draft" });
    renderPart("action");
    fireEvent.click(screen.getByRole("button", { name: "Mark ready" }));
    expect(sdk.mutate).toHaveBeenCalledWith({ environmentId: "env_1" });
  });

  it("merges with the remembered method and remembers a new one", () => {
    window.localStorage.setItem("bb.pullRequest.mergeMethod", "squash");
    show(PULL_REQUEST);
    renderPart("action", [SELF, CHANGED_FILES]);
    fireEvent.click(screen.getByRole("button", { name: "Squash merge" }));
    expect(sdk.mutate).toHaveBeenCalledWith({
      environmentId: "env_1",
      method: "squash",
    });
  });

  it("disables the actions while one runs", () => {
    sdk.isPending = true;
    show({ ...PULL_REQUEST, state: "draft", attention: "draft" });
    renderPart("action");
    expect(
      screen
        .getByRole("button", { name: "Marking..." })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it.each([
    [
      "an open pull request with conflicts",
      {
        ...PULL_REQUEST,
        mergeability: {
          ...PULL_REQUEST.mergeability,
          state: "conflicts" as const,
        },
      },
    ],
    [
      "a merged pull request",
      {
        ...PULL_REQUEST,
        state: "merged" as const,
        attention: "merged" as const,
      },
    ],
  ])("offers no action for %s", (_, pr) => {
    show(pr);
    expect(renderPart("action").container.textContent).toBe("");
  });
});
