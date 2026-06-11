// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ThreadRuntimeDisplayStatus, WorkspaceFileStatus } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  isThreadDisplayStatusBannerActive,
  ThreadPromptContextBanner,
  type ThreadPromptContextBannerProps,
  type ThreadPromptGitSection,
  type ThreadPromptTodoSection,
  type ThreadPromptWorkflowsSection,
} from "./ThreadPromptContextBanner";

type BannerOverrides = Partial<ThreadPromptContextBannerProps>;

const changedFile: WorkspaceFileStatus = {
  path: "apps/app/src/components/promptbox/banner/ThreadPromptContextBanner.tsx",
  status: "M",
  insertions: 3,
  deletions: 1,
};

const todoSection: ThreadPromptTodoSection = {
  pendingTodos: {
    sourceSeq: 1,
    updatedAt: 1,
    items: [
      {
        id: "todo_1",
        text: "Keep compact context readable",
        status: "pending",
      },
    ],
  },
};

const gitSection: ThreadPromptGitSection = {
  changedFiles: {
    kind: "uncommitted",
    label: "Uncommitted",
    files: [changedFile],
    mergeBaseRef: null,
    stats: {
      files: [changedFile],
      insertions: 3,
      deletions: 1,
    },
  },
  mergeBase: null,
  onPromptBannerFileClick: vi.fn(),
};

const gitSectionWithMergeBase: ThreadPromptGitSection = {
  ...gitSection,
  mergeBase: {
    branch: "main",
    options: ["main", "develop"],
    onChange: vi.fn(),
  },
};

const parentThreadSection: ThreadPromptContextBannerProps["parentThreadSection"] = {
  parentThreadTitle: "Parent thread",
  href: "/projects/proj_1/threads/thr_parent",
};

const workflowsSection: ThreadPromptWorkflowsSection = {
  items: [
    {
      id: "wfr_1",
      name: "Repo audit fanout",
      agentProgress: "2/5 agents",
      href: "/workflows/runs/wfr_1",
    },
  ],
};

function renderBanner(overrides: BannerOverrides): void {
  render(
    <MemoryRouter>
      <ThreadPromptContextBanner
        todoSection={null}
        gitSection={null}
        gitSectionPending={false}
        archivedSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        workflowsSection={null}
        expandedSection={null}
        onToggleSection={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadPromptContextBanner", () => {
  it("counts child statuses with live lifecycle work as banner-active", () => {
    const activeStatuses = [
      "active",
      "created",
      "host-reconnecting",
      "provisioning",
      "waiting-for-host",
    ] satisfies readonly ThreadRuntimeDisplayStatus[];

    for (const status of activeStatuses) {
      expect(isThreadDisplayStatusBannerActive(status)).toBe(true);
    }
  });

  it("excludes terminal child statuses from banner-active count", () => {
    const inactiveStatuses = [
      "error",
      "idle",
    ] satisfies readonly ThreadRuntimeDisplayStatus[];

    for (const status of inactiveStatuses) {
      expect(isThreadDisplayStatusBannerActive(status)).toBe(false);
    }
  });

  it("keeps a single context segment label visible in compact markup", () => {
    renderBanner({ todoSection });

    const todoButton = screen.getByRole("button", { name: "Todos: 1" });

    expect(todoButton.querySelector("[data-promptbox-hide-compact]")).toBeNull();
  });

  it("keeps the archived label visible when it is the only segment", () => {
    renderBanner({
      archivedSection: { archivedAt: 1 },
    });

    expect(
      screen
        .getByText("Thread is archived")
        .hasAttribute("data-promptbox-hide-compact"),
    ).toBe(false);
  });

  it("keeps an accessible archived status when archived text compacts next to parent-thread", () => {
    renderBanner({
      archivedSection: { archivedAt: 1 },
      parentThreadSection,
    });

    expect(
      screen.getByRole("status", { name: "Thread is archived" }),
    ).toBeTruthy();
    expect(
      screen
        .getByText("Thread is archived")
        .hasAttribute("data-promptbox-hide-compact"),
    ).toBe(true);
  });

  it("allows segment labels to collapse when multiple segments share the row", () => {
    renderBanner({ todoSection, gitSection });

    expect(
      screen
        .getByRole("button", { name: "Todos: 1" })
        .querySelector("[data-promptbox-hide-compact]"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: /Changed files:/ })
        .querySelector("[data-promptbox-hide-compact]"),
    ).not.toBeNull();
  });

  it("renders nothing when workflows is the only section and it is null", () => {
    const { container } = render(
      <MemoryRouter>
        <ThreadPromptContextBanner
          todoSection={null}
          gitSection={null}
          gitSectionPending={false}
          archivedSection={null}
          parentThreadSection={null}
          childThreadsSection={null}
          workflowsSection={null}
          expandedSection={null}
          onToggleSection={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("hides the workflows section when the section has no items", () => {
    renderBanner({ todoSection, workflowsSection: { items: [] } });

    expect(
      screen.queryByRole("button", { name: /workflow/ }),
    ).toBeNull();
  });

  it("shows an active workflow with a link to its run page", () => {
    renderBanner({ workflowsSection, expandedSection: "workflows" });

    expect(
      screen.getByRole("button", { name: "1 active workflow" }),
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Repo audit fanout/ });
    expect(link.getAttribute("href")).toBe("/workflows/runs/wfr_1");
    expect(link.textContent).toContain("2/5 agents");
  });

  it("pluralizes the workflows label", () => {
    renderBanner({
      workflowsSection: {
        items: [
          ...workflowsSection.items,
          {
            id: "wfr_2",
            name: "Adversarial review",
            agentProgress: null,
            href: "/workflows/runs/wfr_2",
          },
        ],
      },
    });

    expect(
      screen.getByRole("button", { name: "2 active workflows" }),
    ).toBeTruthy();
  });

  it("hides the merge-base selector in compact markup", () => {
    renderBanner({ gitSection: gitSectionWithMergeBase });

    expect(
      screen
        .getByLabelText("Merge base")
        .closest("[data-promptbox-hide-compact]"),
    ).not.toBeNull();
  });

  it("opens changed files from the expanded git row", () => {
    const onPromptBannerFileClick = vi.fn();
    renderBanner({
      gitSection: {
        ...gitSection,
        onPromptBannerFileClick,
      },
      expandedSection: "git",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /ThreadPromptContextBanner\.tsx/,
      }),
    );

    expect(onPromptBannerFileClick).toHaveBeenCalledWith({
      file: changedFile,
      section: gitSection.changedFiles,
    });
  });
});
