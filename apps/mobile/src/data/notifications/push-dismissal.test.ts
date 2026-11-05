import { describe, expect, it } from "vitest";
import {
  parseDismissedThreadId,
  presentedNotificationIdsForThread,
} from "./push-dismissal";

function taskPayload(data: unknown) {
  return {
    notification: null,
    aps: { "content-available": 1 },
    data: { dataString: JSON.stringify(data), experienceId: "@bb-team/bb-app" },
  };
}

describe("parseDismissedThreadId", () => {
  it("reads the thread from a dismissal push's JSON data", () => {
    expect(
      parseDismissedThreadId(
        taskPayload({
          kind: "dismiss",
          threadId: "thr_1",
          subscriptionId: "sub_1",
          serverUrl: "https://bb.example.com",
        }),
      ),
    ).toBe("thr_1");
  });

  it("ignores alert pushes, notification responses, and unreadable data", () => {
    expect(
      parseDismissedThreadId(
        taskPayload({ kind: "turn-finished", threadId: "thr_1" }),
      ),
    ).toBeNull();
    expect(
      parseDismissedThreadId({
        actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
        notification: {},
      }),
    ).toBeNull();
    expect(
      parseDismissedThreadId({ data: { dataString: "{not json" } }),
    ).toBeNull();
  });
});

describe("presentedNotificationIdsForThread", () => {
  it("picks only the read thread's delivered notifications", () => {
    expect(
      presentedNotificationIdsForThread(
        [
          {
            identifier: "a",
            data: { kind: "turn-finished", threadId: "thr_1" },
          },
          {
            identifier: "b",
            data: { kind: "turn-finished", threadId: "thr_2" },
          },
          { identifier: "c", data: { kind: "message", threadId: "thr_1" } },
          { identifier: "d", data: { kind: "message" } },
          { identifier: "e", data: null },
        ],
        "thr_1",
      ),
    ).toEqual(["a", "c"]);
  });
});
