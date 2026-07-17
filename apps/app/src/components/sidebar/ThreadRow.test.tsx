// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import { SidebarThreadTitleMentionResourcesProvider } from "./SidebarThreadTitleMentions";
import { SIDEBAR_WORKING_STATUS_COLOR_CLASS } from "./sidebarRowClasses";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  SidebarThreadShortcutKeysContext,
} from "./sidebarThreadShortcuts";

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => true,
}));

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ThreadActionsMenu: () => null,
}));

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    childOrigin: null,
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    ...overrides,
  };
}

const DEFAULT_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function ThreadRowTestHarness({
  accessibleTitle,
  displayTitle,
  isActive = false,
  options = DEFAULT_OPTIONS,
  shortcutKey,
  thread,
}: {
  accessibleTitle?: string;
  displayTitle?: string;
  isActive?: boolean;
  options?: ThreadRowOptions;
  shortcutKey?: string;
  thread: ThreadListEntry;
}) {
  const shortcutKeys = shortcutKey
    ? new Map([
        [
          thread.id,
          { ariaKeyshortcuts: `Meta+${shortcutKey}`, label: `⌘${shortcutKey}` },
        ],
      ])
    : EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS;

  return (
    <MemoryRouter>
      <SidebarThreadShortcutKeysContext.Provider value={shortcutKeys}>
        <ThreadRow
          projectId={thread.projectId}
          thread={thread}
          isActive={isActive}
          hasComposerDraft={false}
          options={options}
          displayTitle={displayTitle}
          accessibleTitle={accessibleTitle}
        />
      </SidebarThreadShortcutKeysContext.Provider>
    </MemoryRouter>
  );
}

function renderThreadRow({
  isActive = false,
  options = DEFAULT_OPTIONS,
  shortcutKey,
  thread = createThread(),
}: {
  isActive?: boolean;
  options?: ThreadRowOptions;
  shortcutKey?: string;
  thread?: ThreadListEntry;
}) {
  const result = render(
    <ThreadRowTestHarness
      isActive={isActive}
      options={options}
      shortcutKey={shortcutKey}
      thread={thread}
    />,
  );
  return {
    ...result,
    rerenderThreadRow(nextThread: ThreadListEntry) {
      result.rerender(
        <ThreadRowTestHarness
          isActive={isActive}
          options={options}
          shortcutKey={shortcutKey}
          thread={nextThread}
        />,
      );
    },
  };
}

afterEach(cleanup);

describe("ThreadRow", () => {
  it("renders serialized title mentions as non-interactive pills", () => {
    const mentionedThread = createThread({
      id: "thr_mentioned",
      projectId: "proj_mentioned",
      title: "Mention target",
      titleFallback: "Mention target",
    });

    render(
      <SidebarThreadTitleMentionResourcesProvider
        sectionNamesById={
          new Map([
            ["sec_mentioned", "Mention section"],
            ["sec_legacy", "Legacy section"],
          ])
        }
        projectNamesById={new Map([["proj_mentioned", "Mention project"]])}
        threadById={new Map([[mentionedThread.id, mentionedThread]])}
      >
        <ThreadRowTestHarness
          thread={createThread({
            title:
              "Compare @thread:thr_mentioned in @project:proj_mentioned, @section:sec_mentioned, legacy @folder:sec_legacy, and @apps/app/src/ThreadRow.tsx",
            titleFallback:
              "Compare @thread:thr_mentioned in @project:proj_mentioned, @section:sec_mentioned, legacy @folder:sec_legacy, and @apps/app/src/ThreadRow.tsx",
          })}
        />
      </SidebarThreadTitleMentionResourcesProvider>,
    );

    expect(screen.getByText("Mention target").closest("a")).toBeNull();
    expect(screen.getByText("Mention project").closest("a")).toBeNull();
    expect(screen.getByText("Mention section").closest("a")).toBeNull();
    expect(screen.getByText("Legacy section").closest("a")).toBeNull();
    expect(screen.getByTitle("apps/app/src/ThreadRow.tsx")).not.toBeNull();
    expect(screen.queryByText("@thread:thr_mentioned")).toBeNull();
    const resolvedTitle =
      "Compare Mention target in Mention project, Mention section, legacy Legacy section, and ThreadRow.tsx";
    expect(
      screen.getByRole("link", { name: `Open ${resolvedTitle}` }),
    ).not.toBeNull();
    expect(screen.getByTitle(resolvedTitle)).not.toBeNull();
  });

  it("keeps an explicit accessible title while resolving its mentions", () => {
    const mentionedThread = createThread({
      id: "thr_visible",
      title: "Visible target",
      titleFallback: "Visible target",
    });
    const onToggleCollapsed = vi.fn();

    render(
      <SidebarThreadTitleMentionResourcesProvider
        sectionNamesById={new Map([["sec_accessible", "Accessible section"]])}
        projectNamesById={new Map()}
        threadById={new Map([[mentionedThread.id, mentionedThread]])}
      >
        <ThreadRowTestHarness
          accessibleTitle="Full path in @section:sec_accessible"
          displayTitle="Leaf @thread:thr_visible"
          thread={createThread({ title: "Fallback raw title" })}
          options={{
            kind: "parent",
            depth: 1,
            isCompact: false,
            isCollapsed: false,
            childCount: 1,
            childActivity: {
              pending: false,
              working: false,
              runtimeWorking: false,
              workflow: false,
              backgroundAgent: false,
              backgroundCommand: false,
              planMode: false,
              goal: false,
              unread: false,
              unreadError: false,
            },
            onToggleCollapsed,
          }}
        />
      </SidebarThreadTitleMentionResourcesProvider>,
    );

    expect(screen.getByText("Visible target")).not.toBeNull();
    expect(
      screen.getByRole("link", {
        name: "Open Full path in Accessible section",
      }),
    ).not.toBeNull();
    expect(screen.getByTitle("Full path in Accessible section")).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Collapse Full path in Accessible section threads",
      }),
    ).not.toBeNull();
  });

  it("renders a complete Unicode path mention instead of an ASCII prefix", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        title: "Review @src/café.ts",
        titleFallback: "Review @src/café.ts",
      }),
    });

    expect(screen.getByTitle("src/café.ts")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-prompt-mention="true"]'),
    ).toHaveLength(1);
    expect(screen.queryByText("é.ts")).toBeNull();
  });

  it.each([
    "Review @docs/My File.md",
    "Review @docs/My Project File.md",
    "Review @docs/My Cool Project/",
    "Review @thread-storage:Release Notes/todo.md",
    "Ask @Release Notes",
    "Ask @owner/repo",
  ])("leaves an ambiguous flattened mention literal: %s", (title) => {
    const { container } = renderThreadRow({
      thread: createThread({ title, titleFallback: title }),
    });

    expect(screen.getByText(title)).not.toBeNull();
    expect(container.querySelector('[data-prompt-mention="true"]')).toBeNull();
  });

  it("renders an entity mention before terminal punctuation", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        title: "Ask @thread:thr_worker. Next",
        titleFallback: "Ask @thread:thr_worker. Next",
      }),
    });

    expect(screen.getByText("thr_worker")).not.toBeNull();
    expect(
      container.querySelectorAll('[data-prompt-mention="true"]'),
    ).toHaveLength(1);
    expect(screen.queryByText("@thread:thr_worker")).toBeNull();
  });

  it("keeps sentence punctuation outside a multi-segment path mention", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        title: "Review @docs/foo.test.ts.",
        titleFallback: "Review @docs/foo.test.ts.",
      }),
    });

    expect(screen.getByTitle("docs/foo.test.ts")).not.toBeNull();
    expect(
      container
        .querySelector('[data-prompt-mention="true"]')
        ?.getAttribute("data-prompt-mention-serialized-text"),
    ).toBe("@docs/foo.test.ts");
    expect(container.textContent).toBe("Review foo.test.ts.");
  });

  it("keeps the parent-thread disclosure caret visible on mobile", () => {
    renderThreadRow({
      thread: createThread({ title: "Parent thread" }),
      options: {
        kind: "parent",
        depth: 1,
        isCompact: false,
        isCollapsed: false,
        childCount: 1,
        childActivity: {
          pending: false,
          working: false,
          runtimeWorking: false,
          workflow: false,
          backgroundAgent: false,
          backgroundCommand: false,
          planMode: false,
          goal: false,
          unread: false,
          unreadError: false,
        },
        onToggleCollapsed: vi.fn(),
      },
    });

    expect(
      screen
        .getByRole("button", { name: "Collapse Parent thread threads" })
        .getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
  });

  it("shows its Command shortcut in place of the trailing status", () => {
    renderThreadRow({
      shortcutKey: "3",
      thread: createThread({ hasPendingInteraction: true }),
    });

    const shortcut = screen.getByText("⌘3");
    expect(shortcut.className).toContain("p-1.5");
    expect(shortcut.className).toContain("opacity-60");
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Open Thread" })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Meta+3");
  });

  it("shows an unread error before pending or active work", () => {
    renderThreadRow({
      thread: createThread({
        status: "error",
        hasPendingInteraction: true,
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    });

    expect(screen.getByLabelText("Unread thread failed")).not.toBeNull();
    expect(screen.queryByLabelText("Thread needs user input")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows an animated working-colored workflow glyph for an idle thread with an active workflow", () => {
    renderThreadRow({
      thread: createThread({
        title: "Workflow thread",
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    const workflowIcon = screen.getByLabelText("Workflow running");
    const workflowIconClasses = Array.from(workflowIcon.classList);
    expect(workflowIconClasses).toContain("animate-shine-icon");
    expect(workflowIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows foreground agent work before active workflow work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Active workflow thread",
        status: "active",
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Agent working")).not.toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Thread working")).toBeNull();
  });

  it("shows an animated delegated-agent glyph for active background agent work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Background agent thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    const agentIcon = screen.getByLabelText("Background agent running");
    const agentIconClasses = Array.from(agentIcon.classList);
    expect(agentIcon.getAttribute("data-icon")).toBe("UserRoundPlus");
    expect(agentIconClasses).toContain("animate-shine-icon");
    expect(agentIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Background command running")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows workflow before background agent and command work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Many background tasks thread",
        activity: {
          activeWorkflowCount: 1,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Workflow running")).not.toBeNull();
    expect(screen.queryByLabelText("Background agent running")).toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows background agent work before background command work", () => {
    renderThreadRow({
      thread: createThread({
        title: "Agent and command thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 1,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    expect(screen.getByLabelText("Background agent running")).not.toBeNull();
    expect(screen.queryByLabelText("Background command running")).toBeNull();
  });

  it("shows an animated terminal glyph for an active background command", () => {
    renderThreadRow({
      thread: createThread({
        title: "Background command thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 1,
          activePlanModeCount: 0,
          activeGoalCount: 0,
        },
      }),
    });

    const terminalIcon = screen.getByLabelText("Background command running");
    const terminalIconClasses = Array.from(terminalIcon.classList);
    expect(terminalIcon.getAttribute("data-icon")).toBe("Terminal");
    expect(terminalIconClasses).toContain("animate-shine-icon");
    expect(terminalIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows an animated plan-mode glyph when the plan banner is active", () => {
    renderThreadRow({
      thread: createThread({
        title: "Plan mode thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 1,
          activeGoalCount: 0,
        },
      }),
    });

    const planIcon = screen.getByLabelText("Plan mode active");
    const planIconClasses = Array.from(planIcon.classList);
    expect(planIcon.getAttribute("data-icon")).toBe("ListTodo");
    expect(planIconClasses).toContain("animate-shine-icon");
    expect(planIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Background command running")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it("shows an animated goal glyph when the goal banner is active", () => {
    renderThreadRow({
      thread: createThread({
        title: "Goal thread",
        activity: {
          activeWorkflowCount: 0,
          activeBackgroundAgentCount: 0,
          activeBackgroundCommandCount: 0,
          activePlanModeCount: 0,
          activeGoalCount: 1,
        },
      }),
    });

    const goalIcon = screen.getByLabelText("Goal active");
    const goalIconClasses = Array.from(goalIcon.classList);
    expect(goalIcon.getAttribute("data-icon")).toBe("Target");
    expect(goalIconClasses).toContain("animate-shine-icon");
    expect(goalIconClasses).toContain(SIDEBAR_WORKING_STATUS_COLOR_CLASS);
    expect(screen.queryByLabelText("Plan mode active")).toBeNull();
    expect(screen.queryByLabelText("Workflow running")).toBeNull();
    expect(screen.queryByLabelText("Agent working")).toBeNull();
  });

  it.each([
    {
      flag: "backgroundAgent" as const,
      label: "Background agent running",
      icon: "UserRoundPlus",
    },
    {
      flag: "backgroundCommand" as const,
      label: "Background command running",
      icon: "Terminal",
    },
    {
      flag: "planMode" as const,
      label: "Plan mode active",
      icon: "ListTodo",
    },
    {
      flag: "goal" as const,
      label: "Goal active",
      icon: "Target",
    },
  ])(
    "shows the $label glyph for collapsed parent rows with hidden child activity",
    ({ flag, icon, label }) => {
      renderThreadRow({
        thread: createThread({
          title: "Parent thread",
          lastReadAt: 1,
          latestAttentionAt: 1,
        }),
        options: {
          kind: "parent",
          depth: 1,
          isCompact: false,
          isCollapsed: true,
          childCount: 1,
          childActivity: {
            pending: false,
            working: true,
            runtimeWorking: false,
            workflow: false,
            backgroundAgent: false,
            backgroundCommand: false,
            planMode: false,
            goal: false,
            unread: false,
            unreadError: false,
            [flag]: true,
          },
          onToggleCollapsed: vi.fn(),
        },
      });

      expect(screen.getByLabelText(label).getAttribute("data-icon")).toBe(icon);
      expect(screen.queryByLabelText("Thread working")).toBeNull();
    },
  );

  it("renders an already-unread successful thread as a settled dot on initial load", () => {
    const { container } = renderThreadRow({
      thread: createThread({
        status: "idle",
        lastReadAt: 1_000,
        latestAttentionAt: 2_000,
      }),
    });

    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
    expect(container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
  });

  it("switches directly from working to the settled done dot after finishing", () => {
    const thread = createThread({
      status: "active",
      lastReadAt: 1_000,
      latestAttentionAt: 1_000,
      runtime: {
        displayStatus: "active",
        hostReconnectGraceExpiresAt: null,
      },
    });
    const { container, rerenderThreadRow } = renderThreadRow({ thread });

    expect(screen.getByLabelText("Agent working")).not.toBeNull();

    rerenderThreadRow({
      ...thread,
      status: "idle",
      latestAttentionAt: 2_000,
      runtime: {
        displayStatus: "idle",
        hostReconnectGraceExpiresAt: null,
      },
    });

    expect(container.querySelector('[data-icon="CircleCheck"]')).toBeNull();
    expect(screen.getByLabelText("Unread thread succeeded")).not.toBeNull();
  });
});
