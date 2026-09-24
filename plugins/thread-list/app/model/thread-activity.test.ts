import { describe, expect, it } from "vitest";
import {
  getCollapsedChildActivity,
  hasThreadListWorkingActivity,
  isUnreadDoneThread,
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorState,
} from "./thread-activity.js";
import { makeSidebarThread, type SidebarThreadOverrides } from "./fixtures.js";

type ChildActivityInput = Parameters<
  typeof getCollapsedChildActivity
>[0][number];

function makeChild(overrides: SidebarThreadOverrides = {}): ChildActivityInput {
  return makeSidebarThread({
    id: "thr-child",
    status: "idle",
    lastReadAt: 10,
    latestAttentionAt: 10,
    parentThreadId: null,
    hasPendingInteraction: false,
    runtimeStatus: "idle",
    ...overrides,
  });
}

function makeEntry(overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  });
}

const busyChild = makeChild({
  status: "active",
  runtimeStatus: "active",
});
const pendingChild = makeChild({ hasPendingInteraction: true });
const unreadChild = makeChild({ latestAttentionAt: 20, lastReadAt: 10 });
const unreadErrorChild = makeChild({
  status: "error",
  latestAttentionAt: 20,
  lastReadAt: 10,
});

const idleIndicatorState: ThreadListIndicatorState = {
  hasPendingInteraction: false,
  hasUnsubmittedDraft: false,
  hasUnreadError: false,
  hasUnreadSuccess: false,
  isBackgroundAgentActive: false,
  isBackgroundCommandActive: false,
  isGoalActive: false,
  queuedWork: "none",
  isPlanModeActive: false,
  isRuntimeActive: false,
  isWorkflowActive: false,
};

describe("thread-activity", () => {
  describe("hasThreadListWorkingActivity", () => {
    it.each([
      "isRuntimeActive",
      "isWorkflowActive",
      "isBackgroundAgentActive",
      "isBackgroundCommandActive",
      "isPlanModeActive",
      "isGoalActive",
    ] as const)(
      "keeps %s working despite higher-priority attention states",
      (flag) => {
        expect(
          hasThreadListWorkingActivity({
            ...idleIndicatorState,
            hasPendingInteraction: true,
            hasUnreadError: true,
            [flag]: true,
          }),
        ).toBe(true);
      },
    );

    it("includes plugin work without treating attention-only states as work", () => {
      const attentionOnly = {
        ...idleIndicatorState,
        hasPendingInteraction: true,
        hasUnreadError: true,
      };

      expect(hasThreadListWorkingActivity(attentionOnly)).toBe(false);
      expect(hasThreadListWorkingActivity(attentionOnly, true)).toBe(true);
    });
  });

  describe("resolveThreadListIndicator", () => {
    it.each([
      ["hasPendingInteraction", "waiting-for-input"],
      ["hasUnreadError", "unread-error"],
      ["hasUnsubmittedDraft", "working-draft"],
      ["isPlanModeActive", "plan-mode"],
      ["isGoalActive", "goal"],
    ] as const)("shows %s as %s over the runtime spinner", (flag, kind) => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          isRuntimeActive: true,
          [flag]: true,
        }),
      ).toBe(kind);
    });

    it.each([
      "hasUnreadSuccess",
      "isWorkflowActive",
      "isBackgroundAgentActive",
      "isBackgroundCommandActive",
    ] as const)("prefers runtime work over concurrent %s", (flag) => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          isRuntimeActive: true,
          [flag]: true,
        }),
      ).toBe("runtime");
    });

    it.each([
      "isWorkflowActive",
      "isBackgroundAgentActive",
      "isBackgroundCommandActive",
      "isPlanModeActive",
      "isGoalActive",
    ] as const)("uses the working draft pencil with %s", (flag) => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnsubmittedDraft: true,
          [flag]: true,
        }),
      ).toBe("working-draft");
    });

    it("shows the queued clock over a draft, and never over active work", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnsubmittedDraft: true,
          queuedWork: "waiting",
        }),
      ).toBe("queued-waiting");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          queuedWork: "waiting",
          isRuntimeActive: true,
        }),
      ).toBe("runtime");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasPendingInteraction: true,
          queuedWork: "waiting",
        }),
      ).toBe("waiting-for-input");
    });

    it("promotes a failed queued row over a waiting one, but not over work", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          queuedWork: "failed",
        }),
      ).toBe("queued-failed");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          queuedWork: "failed",
          isBackgroundCommandActive: true,
        }),
      ).toBe("background-command");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnreadError: true,
          queuedWork: "failed",
        }),
      ).toBe("unread-error");
    });

    it.each([
      ["waiting", "unread-success"],
      ["failed", "queued-failed"],
    ] as const)(
      "resolves unread success and %s queued work as %s",
      (queuedWork, expectedIndicator) => {
        expect(
          resolveThreadListIndicator({
            ...idleIndicatorState,
            hasUnreadSuccess: true,
            queuedWork,
          }),
        ).toBe(expectedIndicator);
      },
    );

    it("keeps Plan and Goal independent and applies Plan precedence", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          isGoalActive: true,
          isPlanModeActive: true,
        }),
      ).toBe("plan-mode");
    });

    it("applies idle activity precedence before background work", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          isBackgroundAgentActive: true,
          isBackgroundCommandActive: true,
          isGoalActive: true,
          isPlanModeActive: true,
        }),
      ).toBe("plan-mode");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          isBackgroundAgentActive: true,
          isBackgroundCommandActive: true,
          isGoalActive: true,
        }),
      ).toBe("goal");
    });

    it("applies critical, idle draft, and unread precedence", () => {
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasPendingInteraction: true,
          hasUnreadError: true,
          isWorkflowActive: true,
        }),
      ).toBe("unread-error");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasPendingInteraction: true,
          isWorkflowActive: true,
        }),
      ).toBe("waiting-for-input");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnsubmittedDraft: true,
          hasUnreadSuccess: true,
        }),
      ).toBe("unread-success");
      expect(
        resolveThreadListIndicator({
          ...idleIndicatorState,
          hasUnreadSuccess: true,
        }),
      ).toBe("unread-success");
    });
  });

  it("exposes shared running/unread helpers", () => {
    expect(
      isUnreadDoneThread({
        status: "idle",
        isUnread: true,
        parentThreadId: null,
      }),
    ).toBe(true);
    expect(
      isUnreadDoneThread({
        status: "idle",
        isUnread: true,
        parentThreadId: "manager-1",
      }),
    ).toBe(false);
    expect(
      isUnreadDoneThread({
        status: "error",
        isUnread: true,
        parentThreadId: null,
      }),
    ).toBe(true);
    expect(
      isUnreadDoneThread({
        status: "active",
        isUnread: true,
        parentThreadId: null,
      }),
    ).toBe(false);
  });

  describe("threadListIndicatorStateForThread", () => {
    it("marks an unread error thread as an unread error, not a success", () => {
      const thread = makeEntry({
        status: "error",
        latestAttentionAt: 20,
        lastReadAt: 10,
      });

      expect(threadListIndicatorStateForThread(thread, false)).toMatchObject({
        hasUnreadError: true,
        hasUnreadSuccess: false,
        hasUnsubmittedDraft: false,
      });
    });

    it("marks an unread idle thread as an unread success and passes the draft flag through", () => {
      const thread = makeEntry({
        status: "idle",
        latestAttentionAt: 20,
        lastReadAt: 10,
      });

      expect(threadListIndicatorStateForThread(thread, true)).toMatchObject({
        hasUnreadError: false,
        hasUnreadSuccess: true,
        hasUnsubmittedDraft: true,
      });
    });

    it("fills activity flags from the list entry", () => {
      const thread = makeEntry({
        hasPendingInteraction: true,
        queuedWork: "waiting",
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 1,
          planMode: 0,
          goals: 1,
        },
        runtimeStatus: "active",
      });

      expect(threadListIndicatorStateForThread(thread, false)).toEqual({
        hasPendingInteraction: true,
        hasUnsubmittedDraft: false,
        hasUnreadError: false,
        hasUnreadSuccess: false,
        isBackgroundAgentActive: false,
        isBackgroundCommandActive: true,
        isGoalActive: true,
        queuedWork: "waiting",
        isPlanModeActive: false,
        isRuntimeActive: true,
        isWorkflowActive: true,
      });
    });
  });

  describe("getCollapsedChildActivity", () => {
    it("preserves descendant draft state independently from work", () => {
      expect(
        getCollapsedChildActivity(
          [busyChild, pendingChild],
          new Set([pendingChild.id]),
        ),
      ).toMatchObject({
        pending: true,
        working: true,
        hasUnsubmittedDraft: true,
        runtimeWorking: true,
      });
    });

    it("flags nothing for an empty or fully-idle child list", () => {
      expect(getCollapsedChildActivity([])).toEqual({
        pending: false,
        working: false,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([makeChild(), makeChild()])).toEqual({
        pending: false,
        working: false,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("flags a single child's activity", () => {
      expect(getCollapsedChildActivity([busyChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([pendingChild])).toEqual({
        pending: true,
        working: false,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([unreadChild])).toEqual({
        pending: false,
        working: false,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: true,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([unreadErrorChild])).toEqual({
        pending: false,
        working: false,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: true,
      });
    });

    it("flags pending and working independently when both are present", () => {
      expect(
        getCollapsedChildActivity([unreadChild, busyChild, pendingChild]),
      ).toEqual({
        pending: true,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: true,
        unreadError: false,
      });
      expect(
        getCollapsedChildActivity([
          unreadErrorChild,
          unreadChild,
          busyChild,
          pendingChild,
        ]),
      ).toEqual({
        pending: true,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: true,
        unreadError: true,
      });
    });

    it("keeps unread errors visible even when a child is busy", () => {
      const busyUnreadErrorChild = makeChild({
        status: "error",
        latestAttentionAt: 20,
        lastReadAt: 10,
        activity: {
          workflows: 1,
          backgroundAgents: 1,
          backgroundCommands: 1,
          planMode: 0,
          goals: 0,
        },
        runtimeStatus: "active",
      });

      expect(getCollapsedChildActivity([busyUnreadErrorChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: true,
        backgroundAgent: true,
        backgroundCommand: true,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: true,
      });
    });

    it("preserves raw work signals for a blocked child", () => {
      const busyAndPending = makeChild({
        status: "active",
        hasPendingInteraction: true,
        runtimeStatus: "active",
      });
      expect(getCollapsedChildActivity([busyAndPending])).toEqual({
        pending: true,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes idle background commands from runtime work", () => {
      const commandChild = makeChild({
        activity: {
          workflows: 0,
          backgroundAgents: 0,
          backgroundCommands: 1,
          planMode: 0,
          goals: 0,
        },
      });

      expect(getCollapsedChildActivity([commandChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: true,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes idle background agent activity from runtime work", () => {
      const agentChild = makeChild({
        activity: {
          workflows: 0,
          backgroundAgents: 1,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      });

      expect(getCollapsedChildActivity([agentChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: true,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes idle workflow activity from runtime work", () => {
      const workflowChild = makeChild({
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      });

      expect(getCollapsedChildActivity([workflowChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: true,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes plan-mode banner activity from runtime work", () => {
      const planModeChild = makeChild({
        activity: {
          workflows: 0,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 1,
          goals: 0,
        },
      });

      expect(getCollapsedChildActivity([planModeChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: true,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes active-goal banner activity from runtime work", () => {
      const goalChild = makeChild({
        activity: {
          workflows: 0,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 1,
        },
      });

      expect(getCollapsedChildActivity([goalChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: false,
        workflow: false,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: true,
        unread: false,
        unreadError: false,
      });
    });

    it("keeps workflow activity visible when the same child also has runtime work", () => {
      const workflowAndRuntimeChild = makeChild({
        activity: {
          workflows: 1,
          backgroundAgents: 0,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
        runtimeStatus: "active",
        status: "active",
      });

      expect(getCollapsedChildActivity([workflowAndRuntimeChild])).toEqual({
        pending: false,
        working: true,
        hasUnsubmittedDraft: false,
        runtimeWorking: true,
        workflow: true,
        backgroundAgent: false,
        backgroundCommand: false,
        planMode: false,
        goal: false,
        unread: false,
        unreadError: false,
      });
    });

    it("never flags 'unread' for parented children", () => {
      const unreadButParented = makeChild({
        latestAttentionAt: 20,
        lastReadAt: 10,
        parentThreadId: "manager-1",
      });
      expect(getCollapsedChildActivity([unreadButParented])).toMatchObject({
        unread: false,
        unreadError: false,
      });
    });
  });
});
