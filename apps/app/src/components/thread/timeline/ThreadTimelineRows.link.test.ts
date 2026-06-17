import { describe, expect, it } from "vitest";
import { resolveThreadTimelineSegmentLinkHref } from "./ThreadTimelineRows";

describe("resolveThreadTimelineSegmentLinkHref", () => {
  it("renders current-thread title segments as plain text", () => {
    expect(
      resolveThreadTimelineSegmentLinkHref({
        currentThreadId: "thr_current",
        link: { kind: "thread", threadId: "thr_current" },
        projectId: "proj_demo",
      }),
    ).toBeNull();
  });

  it("keeps other-thread title segments navigable", () => {
    expect(
      resolveThreadTimelineSegmentLinkHref({
        currentThreadId: "thr_current",
        link: { kind: "thread", threadId: "thr_other" },
        projectId: "proj_demo",
      }),
    ).toBe("/projects/proj_demo/threads/thr_other");
  });

  it("renders links as plain text without project context", () => {
    expect(
      resolveThreadTimelineSegmentLinkHref({
        currentThreadId: "thr_current",
        link: { kind: "thread", threadId: "thr_other" },
        projectId: undefined,
      }),
    ).toBeNull();
  });
});
