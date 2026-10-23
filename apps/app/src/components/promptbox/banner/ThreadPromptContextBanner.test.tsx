// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isThreadDisplayStatusBannerActive,
  ThreadChildThreadsBanner,
  ThreadPromptContextBanner,
  type ChildThreadQuestion,
  type ThreadPromptArchivedSection,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptEnvironmentGoneSection,
  type ThreadPromptGitSection,
  type ThreadPromptParentThreadSection,
} from "./ThreadPromptContextBanner";

const noop = () => {};
const CHILD_THREADS = "child-threads";

function Banner({
  gitSection,
  gitSectionPending,
  archivedSection,
  environmentGoneSection,
  parentThreadSection,
  childThreadsSection,
  expandedSection,
  onToggleSection,
}: {
  gitSection: ThreadPromptGitSection | null;
  gitSectionPending: boolean;
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  expandedSection: string | null;
  onToggleSection: (key: string) => void;
}) {
  const isReadOnly =
    archivedSection !== null || environmentGoneSection !== null;
  return (
    <>
      <ThreadChildThreadsBanner
        childThreads={isReadOnly ? null : childThreadsSection}
        isExpanded={expandedSection === CHILD_THREADS}
        onExpandedChange={() => onToggleSection(CHILD_THREADS)}
      />
      <ThreadPromptContextBanner
        input={{ threadId: "thr_1", projectId: "proj_1", environment: null }}
        core={{
          git: gitSection,
          gitPending: gitSectionPending,
          parentThread: parentThreadSection,
        }}
        archivedSection={archivedSection}
        environmentGoneSection={environmentGoneSection}
        expandedSegment={expandedSection}
        onToggleSegment={onToggleSection}
      />
    </>
  );
}

function renderToMarkup(element: ReactElement): string {
  const { container, unmount } = render(element);
  const markup = container.innerHTML;
  unmount();
  return markup;
}

const changedFile = {
  path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
  status: "M" as const,
  insertions: 2,
  deletions: 0,
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
        fileCount: 1,
        files: [changedFile],
      },
    },
    mergeBase,
    onPromptBannerFileClick: noop,
  };
}

afterEach(cleanup);

function childThreadItem(
  id: string,
  title: string,
  { pending = false }: { pending?: boolean } = {},
) {
  return { id, title, href: `/threads/${id}`, hasPendingInteraction: pending };
}

function childQuestion(
  childThreadId: string,
  childTitle: string,
  prompt: string,
): ChildThreadQuestion {
  return {
    childThreadId,
    childTitle,
    href: `/threads/${childThreadId}`,
    interaction: {
      id: `pint_${childThreadId}`,
      threadId: childThreadId,
      turnId: "turn_1",
      providerId: "claude-code",
      providerThreadId: "pt_1",
      providerRequestId: `req_${childThreadId}`,
      status: "pending",
      statusReason: null,
      createdAt: 1,
      resolvedAt: null,
      resolution: null,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "choice",
            prompt,
            multiSelect: false,
            allowFreeText: false,
            options: [],
          },
        ],
      },
    },
  };
}

describe("ThreadPromptContextBanner", () => {
  it("renders the archived read-only status without an action", () => {
    const markup = renderToMarkup(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={{ archivedAt: 1_731_456_000_000 }}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
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
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={{ status }}
          parentThreadSection={null}
          childThreadsSection={null}
          expandedSection={null}
          onToggleSection={(section) => toggled.push(section)}
        />,
      );
      const toggle = screen.getByRole("button", { name: label });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText(/history|machine settings/)).toBeNull();
      expect(screen.queryByText("Provision")).toBeNull();
      toggle.click();
      expect(toggled).toEqual(["bb--core/status"]);
    },
  );

  it("shows the machine removal explanation once the status is expanded", () => {
    render(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{ status: "cleanup-failed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        expandedSection="bb--core/status"
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
        "This thread is unavailable while machine cleanup is pending. Retry cleanup in machine settings, or remove the machine without cleanup if it is gone.",
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
      const markup = renderToMarkup(
        <MemoryRouter>
          <Banner
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
    const markup = renderToMarkup(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={{
          archivedAt: 1_731_456_000_000,
          onUnarchive: noop,
        }}
        environmentGoneSection={{ status: "destroyed", onRestore: noop }}
        parentThreadSection={null}
        childThreadsSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).not.toContain("Thread is archived");
    expect(markup).toContain(">Unarchive<");
    expect(markup).not.toContain("Restore workspace");
  });

  it("offers restoring the workspace once the thread is live again", () => {
    const markup = renderToMarkup(
      <Banner
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        environmentGoneSection={{ status: "destroyed", onRestore: noop }}
        parentThreadSection={null}
        childThreadsSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).toContain(">Restore workspace<");
  });

  it("shows the restore action as pending while it runs", () => {
    const markup = renderToMarkup(
      <Banner
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
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(
      markup.match(/<button([^>]*)>Restoring\.\.\.<\/button>/)?.[1],
    ).toContain('disabled=""');
  });

  it("summarizes child threads with a header and total count", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [childThreadItem("thr_child", "Investigate failing checks")],
            pendingInteractions: [],
          }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Child threads"');
    expect(markup).toContain('aria-label="1 active child thread"');
    expect(markup).toContain("Active child threads");
    expect(markup).toContain(">1<");
    expect(markup).toContain('data-icon="ChildThread"');
    expect(markup).toContain("animate-shine-icon");
    expect(markup).toMatch(/animate-shine[^"]*font-normal/);
  });

  it("lists child threads with needs-input and working glyphs when expanded", () => {
    const markup = renderToMarkup(
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_a", "Review the release notes", {
                pending: true,
              }),
              childThreadItem("thr_b", "Investigate failing checks"),
            ],
            pendingInteractions: [],
          }}
          expandedSection={CHILD_THREADS}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(">2<");
    expect(markup).not.toContain(">+");
    expect(markup).toContain('aria-label="Needs input"');
    expect(markup).toContain('aria-label="Working"');
    expect(markup).toContain('data-icon="Loading"');
  });

  it("counts a child waiting for a host as active banner work", () => {
    expect(isThreadDisplayStatusBannerActive("waiting-for-host")).toBe(true);
  });

  it("shows the waiting question in the header only while collapsed", () => {
    const renderBanner = (expandedSection: string | null) => (
      <MemoryRouter>
        <Banner
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_blocked", "Install workspace tools", {
                pending: true,
              }),
              childThreadItem("thr_working", "Investigate failing checks"),
            ],
            pendingInteractions: [
              childQuestion(
                "thr_blocked",
                "Install workspace tools",
                "Which color should the badge use?",
              ),
            ],
          }}
          expandedSection={expandedSection}
          onToggleSection={noop}
        />
      </MemoryRouter>
    );

    const collapsed = renderToMarkup(renderBanner(null));
    expect(collapsed).toContain(">Which color should the badge use?<");
    expect(collapsed).toContain(
      'aria-label="2 active child threads, needs input: Install workspace tools: Which color should the badge use?"',
    );
    expect(collapsed).not.toContain("Active child threads");

    const expanded = renderToMarkup(renderBanner(CHILD_THREADS));
    expect(expanded).toContain("Active child threads");
    expect(expanded).toContain('aria-label="2 active child threads"');
  });

  it("expands once when a child thread newly needs input, even across remounts", () => {
    const onToggleSection = vi.fn();
    const renderBanner = (
      items: ReturnType<typeof childThreadItem>[],
      {
        gitSection = null,
        gitSectionPending = false,
      }: {
        gitSection?: ReturnType<typeof makeGitSection> | null;
        gitSectionPending?: boolean;
      } = {},
    ) => (
      <MemoryRouter>
        <Banner
          gitSection={gitSection}
          gitSectionPending={gitSectionPending}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{ items, pendingInteractions: [] }}
          expandedSection={null}
          onToggleSection={onToggleSection}
        />
      </MemoryRouter>
    );
    const blocked = childThreadItem("thr_blocked", "Install workspace tools", {
      pending: true,
    });
    const working = childThreadItem(
      "thr_working",
      "Investigate failing checks",
    );
    const { rerender } = render(renderBanner([working]));
    expect(onToggleSection).not.toHaveBeenCalled();

    rerender(renderBanner([blocked, working]));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(onToggleSection).toHaveBeenCalledWith(CHILD_THREADS);

    rerender(renderBanner([blocked, working]));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Active child threads")).toBeTruthy();

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
        .getByRole("button", { name: "2 active child threads" })
        .querySelector('[data-icon="CircleQuestion"]'),
    ).not.toBeNull();
  });

  it("keeps child threads visible while git status loads, but not once the environment is gone or the parent is archived", () => {
    const renderBanner = ({
      archived = false,
      environmentGone = false,
      gitSectionPending = false,
    }: {
      archived?: boolean;
      environmentGone?: boolean;
      gitSectionPending?: boolean;
    } = {}) => (
      <MemoryRouter>
        <Banner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={gitSectionPending}
          archivedSection={archived ? { archivedAt: 1_731_456_000_000 } : null}
          environmentGoneSection={
            environmentGone ? { status: "destroyed" } : null
          }
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              childThreadItem("thr_blocked", "Install workspace tools", {
                pending: true,
              }),
            ],
            pendingInteractions: [],
          }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>
    );
    const { rerender } = render(renderBanner());
    const childCard = screen.getByRole("region", { name: "Child threads" });

    rerender(renderBanner({ gitSectionPending: true }));
    expect(screen.getByRole("region", { name: "Child threads" })).toBe(
      childCard,
    );
    expect(
      screen.queryByRole("region", { name: "Thread context before sending" }),
    ).toBeNull();

    rerender(renderBanner({ environmentGone: true }));
    expect(screen.queryByRole("region", { name: "Child threads" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Environment unavailable" }),
    ).toBeTruthy();

    rerender(renderBanner({ archived: true }));
    expect(screen.queryByRole("region", { name: "Child threads" })).toBeNull();
    expect(screen.getByText("Thread is archived")).toBeTruthy();
  });

  it("opens the child card for a newly waiting child while changed files are open", () => {
    const onToggleSection = vi.fn();
    const renderBanner = (
      items: ReturnType<typeof childThreadItem>[],
      expandedSection: "bb--core/changed-files" | null,
    ) => (
      <MemoryRouter>
        <Banner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items,
            pendingInteractions: [],
          }}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />
      </MemoryRouter>
    );
    const working = childThreadItem(
      "thr_working",
      "Investigate failing checks",
    );
    const blocked = childThreadItem("thr_blocked", "Install workspace tools", {
      pending: true,
    });
    const { rerender } = render(
      renderBanner([working], "bb--core/changed-files"),
    );
    expect(onToggleSection).not.toHaveBeenCalled();
    rerender(renderBanner([blocked, working], "bb--core/changed-files"));
    expect(onToggleSection).toHaveBeenCalledTimes(1);
    expect(onToggleSection).toHaveBeenCalledWith(CHILD_THREADS);
  });
});

describe("ThreadPromptContextBanner git section body", () => {
  function renderBanner(expandedSection: "bb--core/changed-files" | null) {
    return (
      <MemoryRouter>
        <Banner
          gitSection={makeGitSection("uncommitted")}
          gitSectionPending={false}
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={null}
          expandedSection={expandedSection}
          onToggleSection={noop}
        />
      </MemoryRouter>
    );
  }

  it("does not mount the changed-files list until the section first expands", () => {
    const { rerender } = render(renderBanner(null));
    expect(screen.queryByRole("list", { hidden: true })).toBeNull();

    rerender(renderBanner("bb--core/changed-files"));
    expect(screen.getByRole("list")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Open ${changedFile.path}` }),
    ).toBeTruthy();

    rerender(renderBanner(null));
    expect(screen.getByRole("list", { hidden: true })).toBeTruthy();
  });
});
