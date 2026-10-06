// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isThreadDisplayStatusBannerActive,
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
  autoMerge: false,
  inMergeQueue: false,
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
        lineStatsComplete: true,
        files: [changedFile],
      },
    },
    mergeBase,
    onPromptBannerFileClick: noop,
  };
}

afterEach(cleanup);

function subthreadItem(
  id: string,
  title: string,
  { pending = false }: { pending?: boolean } = {},
) {
  return { id, title, href: `/threads/${id}`, hasPendingInteraction: pending };
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

  it.each([
    ["removed", "Machine removed"],
    ["removing", "Machine removal in progress"],
    ["cleanup-failed", "Machine cleanup failed"],
    ["destroyed", "Environment unavailable"],
  ] as const)(
    "collapses the %s explanation behind its status toggle by default",
    (status, label) => {
      const toggled: string[] = [];
      render(
        <ThreadPromptContextBanner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={{ status }}
          parentThreadSection={null}
          childThreadsSection={null}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={(section) => toggled.push(section)}
        />,
      );
      const toggle = screen.getByRole("button", { name: label });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText(/history|machine settings/)).toBeNull();
      expect(screen.queryByText("Provision")).toBeNull();
      toggle.click();
      expect(toggled).toEqual(["status"]);
    },
  );

  it("shows the machine removal explanation once the status is expanded", () => {
    render(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{ status: "cleanup-failed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection="status"
        onToggleSection={noop}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Machine cleanup failed" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByText(
        "This thread is unavailable while machine cleanup is pending. Retry cleanup in machine settings.",
      ),
    ).toBeDefined();
  });

  it.each([
    {
      label: "archived",
      archivedSection: { archivedAt: 1_731_456_000_000 },
      environmentGoneSection: null,
      expectedLabel: "Thread is archived",
    },
    {
      label: "environment archived",
      archivedSection: null,
      environmentGoneSection: { status: "destroyed" as const },
      expectedLabel: "Environment unavailable",
    },
  ])(
    "keeps the $label read-only status visible in compact mode",
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

  it("offers unarchiving first when an archived thread also lost its environment", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={{
          archivedAt: 1_731_456_000_000,
          onUnarchive: noop,
        }}
        environmentGoneSection={{ status: "destroyed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).not.toContain("Thread is archived");
    expect(markup).toContain(">Unarchive<");
  });

  it("offers restoring the workspace once the thread is live again", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{ status: "destroyed", onRestore: noop }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).toContain(">Restore workspace<");
  });

  it("shows the restore action as pending while it runs", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{
          status: "destroyed",
          onRestore: noop,
          restorePending: true,
        }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain(">Restoring...<");
    expect(markup).toContain("disabled");
  });

  it("keeps ready-to-merge status out of standalone visible labels", () => {
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
    expect(markup).not.toContain(">Ready to merge</span>");
    expect(markup).not.toContain('alt="Checks success"');
  });

  it("uses the selected pull request merge method as the action label", () => {
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
  });

  it.each([
    ["checks_pending", false, null],
    ["checks_failed", false, null],
    ["checks_failed", true, null],
    ["checks_pending", true, null],
    ["ready_to_merge", true, null],
    ["queued", true, "Queued to merge"],
  ] as const)(
    "shows the next step and an auto-merge icon for %s with auto-merge %s",
    (attention, autoMerge, label) => {
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
            },
          }}
          expandedSection={null}
          onToggleSection={noop}
        />,
      );

      expect(markup).toContain("PR #128");
      expect(markup).not.toContain("PR #128 · Open");
      if (label) {
        expect(markup).toContain(`>${label}</span>`);
      } else {
        expect(markup).not.toContain('aria-hidden="true">·</span>');
      }
      expect(markup.includes('aria-label="Auto-merge on"')).toBe(autoMerge);
      expect(markup).toContain('class="size-4 shrink-0 text-success"');
      expect(markup).toContain('data-icon="GitPullRequestArrow"');
      expect(markup).not.toContain('data-icon="GitMerge"');
      expect(markup).toContain(
        attention === "checks_failed"
          ? 'class="fill-destructive"'
          : 'class="fill-attention"',
      );
      expect(markup).not.toContain('alt="Checks pending"');
    },
  );

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

  it("summarizes subthreads with a header and total count", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [subthreadItem("thr_child", "Investigate failing checks")],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Subthreads"');
    expect(markup).toContain('aria-label="1 active subthread"');
    expect(markup).toContain("Active subthreads");
    expect(markup).toContain(">1<");
    expect(markup).toContain('data-icon="Subthread"');
    expect(markup).toContain("animate-shine-icon");
    expect(markup).toContain("animate-shine font-medium");
    expect(markup).not.toContain("running");
  });

  it("lists subthreads with needs-input and working glyphs when expanded", () => {
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
              subthreadItem("thr_a", "Review the release notes", {
                pending: true,
              }),
              subthreadItem("thr_b", "Investigate failing checks"),
            ],
          }}
          pullRequestSection={null}
          expandedSection="childThreads"
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(">2<");
    expect(markup).not.toContain(">+");
    expect(markup).toContain('aria-label="Needs input"');
    expect(markup).toContain('aria-label="Working"');
    expect(markup).toContain('data-icon="Loading"');
    expect(markup).not.toContain('data-icon="UserRoundPlus"');
    expect(markup).not.toContain("running");
  });

  it("lets combined child and context cards shrink inside the composer stack", () => {
    render(
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              subthreadItem(
                "thr_child",
                "Host-owned SourceCode and Diff renderers",
              ),
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    const childCard = screen.getByRole("region", { name: "Subthreads" });
    const contextCard = screen.getByRole("region", {
      name: "Thread context before sending",
    });

    expect(childCard.parentElement).toBe(contextCard.parentElement);
    expect(childCard.parentElement?.classList.contains("min-w-0")).toBe(true);
  });

  it("counts a child waiting for a host as active banner work", () => {
    expect(isThreadDisplayStatusBannerActive("waiting-for-host")).toBe(true);
  });

  it("expands once when a subthread newly needs input, even across remounts", () => {
    const onToggleSection = vi.fn();
    const renderBanner = (
      items: ReturnType<typeof subthreadItem>[],
      {
        gitSection = null,
        gitSectionPending = false,
      }: {
        gitSection?: ReturnType<typeof makeGitSection> | null;
        gitSectionPending?: boolean;
      } = {},
    ) => (
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={gitSection}
          gitSectionPending={gitSectionPending}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{ items }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={onToggleSection}
        />
      </MemoryRouter>
    );
    const blocked = subthreadItem("thr_blocked", "Install workspace tools", {
      pending: true,
    });
    const working = subthreadItem("thr_working", "Investigate failing checks");
    const { rerender } = render(renderBanner([working]));
    expect(onToggleSection).not.toHaveBeenCalled();

    rerender(renderBanner([blocked, working]));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(onToggleSection).toHaveBeenCalledWith("childThreads");

    rerender(renderBanner([blocked, working]));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Active subthreads")).toBeTruthy();

    rerender(
      renderBanner([blocked, working], {
        gitSection: makeGitSection("uncommitted"),
      }),
    );
    rerender(renderBanner([blocked, working], { gitSectionPending: true }));
    rerender(renderBanner([blocked, working]));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("button", { name: "2 active subthreads" })
        .querySelector('[data-icon="CircleQuestion"]'),
    ).not.toBeNull();
  });

  it("keeps failed-check detail accessible without a redundant label", () => {
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
    expect(markup).not.toContain(">Checks failing</span>");
    expect(markup).toContain('title="Open, Checks failing"');
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
    expect(markup).not.toContain(">Ready to merge</span>");
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

  it.each([
    {
      label: "checked open",
      pullRequest: pullRequestFixture,
      expectedMinWidthClass: "min-w-13",
    },
    {
      label: "merged",
      pullRequest: {
        ...pullRequestFixture,
        state: "merged" as const,
        attention: "merged" as const,
      },
      expectedMinWidthClass: "min-w-8",
    },
    {
      label: "closed",
      pullRequest: {
        ...pullRequestFixture,
        state: "closed" as const,
        attention: "closed" as const,
      },
      expectedMinWidthClass: "min-w-8",
    },
  ])(
    "reserves only the width needed by a $label pull request status pill",
    ({ pullRequest, expectedMinWidthClass }) => {
      render(
        <MemoryRouter>
          <ThreadPromptContextBanner
            gitSection={makeGitSection("committed")}
            gitSectionPending={false}
            archivedSection={null}
            environmentGoneSection={null}
            parentThreadSection={null}
            childThreadsSection={null}
            pullRequestSection={{ pullRequest }}
            expandedSection={null}
            onToggleSection={noop}
          />
        </MemoryRouter>,
      );

      const pullRequestLink = screen.getByRole("link", {
        name: /Pull request 128:/,
      });
      expect(
        ["min-w-8", "min-w-13"].filter((className) =>
          pullRequestLink.classList.contains(className),
        ),
      ).toEqual([expectedMinWidthClass]);
    },
  );
});

describe("ThreadPromptContextBanner git section body", () => {
  function renderBanner(expandedSection: "git" | null) {
    return (
      <MemoryRouter>
        <ThreadPromptContextBanner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={null}
          pullRequestSection={null}
          expandedSection={expandedSection}
          onToggleSection={noop}
        />
      </MemoryRouter>
    );
  }

  it("does not mount the changed-files list until the section first expands", () => {
    const { rerender } = render(renderBanner(null));
    expect(screen.queryByRole("list", { hidden: true })).toBeNull();

    rerender(renderBanner("git"));
    expect(screen.getByRole("list")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Open ${changedFile.path}` }),
    ).toBeTruthy();

    rerender(renderBanner(null));
    expect(screen.getByRole("list", { hidden: true })).toBeTruthy();
  });
});
