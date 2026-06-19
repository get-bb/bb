import { renderToStaticMarkup } from "react-dom/server";
import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  ThreadPromptContextBanner,
  type ThreadPromptGitSection,
} from "./ThreadPromptContextBanner";

const noop = () => {};

const changedFile = {
  path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
  status: "M" as const,
  insertions: 2,
  deletions: 0,
};

const pullRequestFixture: ThreadPullRequest = {
  number: 128,
  title: "Show pull request status in the prompt context banner",
  state: "open",
  url: "https://github.com/acme/bb/pull/128",
  baseRefName: "main",
  headRefName: "bb/pr-context-banner",
  updatedAt: "2026-06-16T12:30:00Z",
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: {
    state: "none",
    reviewRequestCount: 0,
  },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

function makeGitSection(
  kind: ThreadPromptGitSection["changedFiles"]["kind"] = "uncommitted",
): ThreadPromptGitSection {
  return {
    changedFiles: {
      kind,
      label: kind === "committed" ? "Committed" : "Uncommitted",
      files: [changedFile],
      mergeBaseRef: kind === "committed" ? "abc1234" : null,
      stats: {
        insertions: 2,
        deletions: 0,
        files: [changedFile],
      },
    },
    mergeBase: null,
    onPromptBannerFileClick: noop,
  };
}

describe("ThreadPromptContextBanner", () => {
  it("renders the archived read-only status without an action", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={{ archivedAt: 1_731_456_000_000 }}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Thread is archived");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
  });

  it("renders the environment-gone read-only status without a provision action", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{ status: "destroyed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment is no longer available");
    expect(markup).toContain("This thread can&#x27;t run any more work.");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Provision");
  });

  it("labels a standalone pull request without non-actionable attention text", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest: pullRequestFixture }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).not.toContain("PR #128 · Open");
    expect(markup).not.toContain("· Ready to merge");
    expect(markup).not.toContain('alt="Checks success"');
  });

  it("uses the selected pull request merge method as the action label without a merge icon", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: pullRequestFixture,
          actions: {
            onMerge: noop,
            selectedMergeMethod: "squash",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Squash merge");
    expect(markup).not.toContain('data-icon="GitMerge"');
  });

  it("does not label standalone pending checks", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            checks: {
              state: "pending",
              totalCount: 1,
              passedCount: 0,
              failedCount: 0,
              pendingCount: 1,
            },
            attention: "checks_pending",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).not.toContain("PR #128 · Open");
    expect(markup).not.toContain("· Checks pending");
    expect(markup).not.toContain('alt="Checks pending"');
  });

  it("keeps useful standalone terminal pull request state labels", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            state: "closed",
            attention: "closed",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128 · Closed");
  });

  it("labels standalone actionable pull request attention", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            checks: {
              state: "failing",
              totalCount: 1,
              passedCount: 0,
              failedCount: 1,
              pendingCount: 0,
            },
            attention: "checks_failed",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).toContain("· Checks failing");
    expect(markup).not.toContain("Checks failure");
  });

  it("shows pull request and diff labels together when only PR and git context are visible", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={makeGitSection("uncommitted")}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest: pullRequestFixture }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).not.toContain("Open PR #128");
    expect(markup).not.toContain("· Ready to merge");
    expect(markup).toContain("Uncommitted");
    expect(markup).toContain("1 file");
  });

  it("keeps the pull request action visible beside other context segments", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={makeGitSection("uncommitted")}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: pullRequestFixture,
          actions: {
            onMerge: noop,
            selectedMergeMethod: "rebase",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).toContain("Uncommitted");
    expect(markup).toContain("Rebase and merge");
  });

  it("uses the shared committed git label beside pull request context", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={makeGitSection("committed")}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest: pullRequestFixture }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).toContain("Committed");
    expect(markup).toContain("1 file");
  });
});
