import { describe, expect, it } from "vitest";
import {
  getCollapsedChildActivity,
  isBusyThread,
  isUnreadDoneThread,
} from "./thread-activity";

type ChildActivityInput = Parameters<
  typeof getCollapsedChildActivity
>[0][number];

function makeChild(
  overrides: Partial<ChildActivityInput> = {},
): ChildActivityInput {
  return {
    status: "idle",
    lastReadAt: 10,
    latestAttentionAt: 10,
    parentThreadId: null,
    hasPendingInteraction: false,
    activity: { activeWorkflowCount: 0 },
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

const busyChild = makeChild({
  status: "active",
  runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
});
const pendingChild = makeChild({ hasPendingInteraction: true });
const unreadChild = makeChild({ latestAttentionAt: 20, lastReadAt: 10 });
const unreadErrorChild = makeChild({
  status: "error",
  latestAttentionAt: 20,
  lastReadAt: 10,
});

describe("thread-activity", () => {
  it("exposes shared running/unread helpers", () => {
    expect(
      isBusyThread({
        activity: { activeWorkflowCount: 0 },
        runtime: {
          displayStatus: "active",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ).toBe(true);
    expect(
      isBusyThread({
        activity: { activeWorkflowCount: 0 },
        runtime: {
          displayStatus: "host-reconnecting",
          hostReconnectGraceExpiresAt: 100,
        },
      }),
    ).toBe(true);
    expect(
      isBusyThread({
        activity: { activeWorkflowCount: 0 },
        runtime: {
          displayStatus: "provisioning",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ).toBe(true);
    expect(
      isBusyThread({
        activity: { activeWorkflowCount: 0 },
        runtime: {
          displayStatus: "waiting-for-host",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ).toBe(false);

    expect(
      isBusyThread({
        activity: { activeWorkflowCount: 1 },
        runtime: {
          displayStatus: "idle",
          hostReconnectGraceExpiresAt: null,
        },
      }),
    ).toBe(true);

    expect(
      isUnreadDoneThread({
        status: "idle",
        latestAttentionAt: 20,
        lastReadAt: 10,
        parentThreadId: null,
      }),
    ).toBe(true);
    expect(
      isUnreadDoneThread({
        status: "idle",
        latestAttentionAt: 20,
        lastReadAt: 10,
        parentThreadId: "manager-1",
      }),
    ).toBe(false);
    expect(
      isUnreadDoneThread({
        status: "error",
        latestAttentionAt: 20,
        lastReadAt: 10,
        parentThreadId: null,
      }),
    ).toBe(true);
    expect(
      isUnreadDoneThread({
        status: "active",
        latestAttentionAt: 20,
        lastReadAt: null,
        parentThreadId: null,
      }),
    ).toBe(false);
  });

  describe("getCollapsedChildActivity", () => {
    it("flags nothing for an empty or fully-idle child list", () => {
      expect(getCollapsedChildActivity([])).toEqual({
        pending: false,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([makeChild(), makeChild()])).toEqual({
        pending: false,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: false,
        unreadError: false,
      });
    });

    it("flags a single child's activity", () => {
      expect(getCollapsedChildActivity([busyChild])).toEqual({
        pending: false,
        working: true,
        runtimeWorking: true,
        workflow: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([pendingChild])).toEqual({
        pending: true,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: false,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([unreadChild])).toEqual({
        pending: false,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: true,
        unreadError: false,
      });
      expect(getCollapsedChildActivity([unreadErrorChild])).toEqual({
        pending: false,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: true,
        unreadError: true,
      });
    });

    it("flags pending and working independently when both are present", () => {
      expect(
        getCollapsedChildActivity([unreadChild, busyChild, pendingChild]),
      ).toEqual({
        pending: true,
        working: true,
        runtimeWorking: true,
        workflow: false,
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
        runtimeWorking: true,
        workflow: false,
        unread: true,
        unreadError: true,
      });
    });

    it("reads a blocked child as pending only, never also working", () => {
      const busyAndPending = makeChild({
        status: "active",
        hasPendingInteraction: true,
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      });
      expect(getCollapsedChildActivity([busyAndPending])).toEqual({
        pending: true,
        working: false,
        runtimeWorking: false,
        workflow: false,
        unread: false,
        unreadError: false,
      });
    });

    it("distinguishes idle workflow activity from runtime work", () => {
      const workflowChild = makeChild({
        activity: { activeWorkflowCount: 1 },
      });

      expect(getCollapsedChildActivity([workflowChild])).toEqual({
        pending: false,
        working: true,
        runtimeWorking: false,
        workflow: true,
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
