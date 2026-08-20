import type { TimelineTitle } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import { isPastTimelineRow } from "./row-dim";

function title(shimmer = false): TimelineTitle {
  return {
    action: null,
    decorations: [],
    plain: "t",
    segments: [{ text: "t", em: false, shimmer, truncate: false }],
    tone: "default",
  };
}

describe("isPastTimelineRow", () => {
  it("recedes finished structural rows only", () => {
    const completed = { status: "completed" } as never;
    expect(
      isPastTimelineRow({ kind: "turn", row: completed, title: title() }),
    ).toBe(true);
    expect(
      isPastTimelineRow({
        kind: "step-summary",
        row: completed,
        title: title(),
      }),
    ).toBe(true);
    expect(
      isPastTimelineRow({ kind: "system", row: completed, title: title() }),
    ).toBe(true);
    expect(
      isPastTimelineRow({
        kind: "system",
        row: { status: "error" } as never,
        title: title(),
      }),
    ).toBe(false);
    expect(
      isPastTimelineRow({
        kind: "system",
        row: { status: null } as never,
        title: title(),
      }),
    ).toBe(false);
  });

  it("keeps prose and the shimmering live frontier at full strength", () => {
    expect(
      isPastTimelineRow({
        kind: "conversation:assistant",
        row: {} as never,
        title: title(),
      }),
    ).toBe(false);
    expect(
      isPastTimelineRow({
        kind: "bundle-summary",
        row: { status: "completed" } as never,
        title: title(true),
      }),
    ).toBe(false);
  });
});
