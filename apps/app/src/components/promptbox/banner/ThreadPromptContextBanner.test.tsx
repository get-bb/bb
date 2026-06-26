import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
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
  mergeBase: ThreadPromptGitSection["mergeBase"] = null,
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
    mergeBase,
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

    expect(markup).toContain("Environment is unavailable");
    expect(markup).toContain("This thread can&#x27;t run any more work.");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("Provision");
  });

  it.each([
    {
      label: "archived",
      archivedSection: { archivedAt: 1_731_456_000_000 },
      environmentGoneSection: null,
      expectedLabel: "Thread is archived",
    },
    {
      label: "environment gone",
      archivedSection: null,
      environmentGoneSection: { status: "destroyed" as const },
      expectedLabel: "Environment is unavailable",
    },
  ])(
    "keeps the $label read-only status label visible in compact mode",
    ({ archivedSection, environmentGoneSection, expectedLabel }) => {
      const markup = renderToStaticMarkup(
        <MemoryRouter>
          <ThreadPromptContextBanner
            gitSection={null}
            gitSectionPending={false}
            archivedSection={archivedSection}
            environmentGoneSection={environmentGoneSection}
            parentThreadSection={{
              parentThreadTitle: "Parent thread",
              href: "/threads/thr_parent",
              relationship: "parent",
            }}
            childThreadsSection={null}
            pullRequestSection={null}
            expandedSection={null}
            onToggleSection={noop}
          />
        </MemoryRouter>,
      );

      expect(markup).toContain(expectedLabel);
      expect(markup).not.toContain(
        `data-promptbox-hide-compact="">${expectedLabel}`,
      );
    },
  );

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

  it("uses the compact pull request pill height inside the banner row", () => {
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

    expect(markup).toMatch(
      /class="(?=[^"]*\bh-4\b)(?=[^"]*cursor-pointer)[^"]*"/,
    );
    expect(markup).not.toMatch(
      /class="(?=[^"]*\bh-5\b)(?=[^"]*cursor-pointer)[^"]*"/,
    );
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
    expect(markup).not.toContain("data-promptbox-hide-compact");
    expect(markup).toContain("data-promptbox-hide-tiny");
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

  it("renders active child threads as a full active card instead of a compact segment", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_child",
                title: "Investigate failing checks",
                href: "/threads/thr_child",
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Active child threads"');
    expect(markup).toContain("1 active child thread");
    expect(markup).toContain("rounded-none");
    expect(markup).not.toContain('aria-label="Thread context before sending"');
    expect(markup).not.toContain("data-promptbox-hide-compact");
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
    expect(markup).not.toContain('data-promptbox-hide-compact="">Uncommitted');
    expect(markup).not.toContain('data-promptbox-compact-label="">1 file');
  });

  it("does not force fixed minimum widths on compact segments", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={{
            parentThreadTitle: "Parent thread",
            href: "/threads/thr_parent",
            relationship: "parent",
          }}
          childThreadsSection={null}
          pullRequestSection={{ pullRequest: pullRequestFixture }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).not.toContain("min-w-12");
    expect(markup).not.toContain("min-w-11");
  });

  it("compacts the git status label when more than two segments are visible", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={{
            parentThreadTitle: "Parent thread",
            href: "/threads/thr_parent",
            relationship: "parent",
          }}
          childThreadsSection={null}
          pullRequestSection={{ pullRequest: pullRequestFixture }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("Uncommitted");
    expect(markup).toContain('data-promptbox-hide-compact="">Uncommitted');
    expect(markup).toContain('data-promptbox-compact-label="">1 file');
  });

  it("hides the standalone merge-base action at the compact breakpoint", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={makeGitSection("committed", {
          branch: "origin/very-long-feature-base-branch",
          onChange: noop,
        })}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Merge base");
    expect(markup).toContain("origin/very-long-feature-base-branch");
    expect(markup).toContain("data-promptbox-hide-compact");
    expect(markup).toContain("data-promptbox-hide-tiny");
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
