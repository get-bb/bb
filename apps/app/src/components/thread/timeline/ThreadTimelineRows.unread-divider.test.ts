import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import type { ThreadTimelineUnreadDividerPlacement } from "./types";
import { buildTimelineRowsListItems } from "./ThreadTimelineRows";

const DIVIDER = "__divider__";

function renderTopLevelSequence(
  timelineRows: TimelineRow[],
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null,
): string[] {
  return buildTimelineRowsListItems({
    rows: buildTimelineViewRows(timelineRows),
    unreadDividerPlacement,
  }).map((item) => {
    if (item.kind !== "row") return DIVIDER;
    return item.row.kind === "conversation" ? item.row.role : item.row.kind;
  });
}

function userMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `user-${createdAt}`,
    seq: createdAt,
    role: "user",
    text: "PROMPT",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function assistantMessage(createdAt: number): TimelineRow {
  return conversationRow({
    id: `assistant-${createdAt}`,
    seq: createdAt,
    role: "assistant",
    text: "ANSWER",
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

function command(createdAt: number): TimelineRow {
  return commandRow({
    id: `command-${createdAt}`,
    seq: createdAt,
    command: `echo ${createdAt}`,
    createdAt,
    startedAt: createdAt,
    turnId: "turn-1",
  });
}

describe("unread divider placement", () => {
  it("keeps the divider below a work group the reader already saw part of", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        command(300),
        command(400),
        assistantMessage(500),
      ],
      { kind: "after-cutoff", cutoffAt: 350 },
    );

    expect(sequence).toEqual(["user", "step-summary", DIVIDER, "assistant"]);
  });

  it("places the divider above a work group that started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        assistantMessage(200),
        command(400),
        command(500),
        assistantMessage(600),
      ],
      { kind: "after-cutoff", cutoffAt: 300 },
    );

    expect(sequence).toEqual([
      "user",
      "assistant",
      DIVIDER,
      "step-summary",
      "assistant",
    ]);
  });

  it("matches collapsed-turn placement when finished turns stay flat", () => {
    const collapsed = renderTopLevelSequence(
      [
        userMessage(100),
        turnRow({
          id: "turn-row",
          seq: 100,
          createdAt: 100,
          startedAt: 100,
          turnId: "turn-1",
          summaryCount: 3,
          children: [command(200), command(300), command(400)],
        }),
        assistantMessage(500),
      ],
      { kind: "after-cutoff", cutoffAt: 350 },
    );

    expect(collapsed).toEqual(["user", "turn", DIVIDER, "assistant"]);
  });

  it("never anchors the divider on the reader's own message", () => {
    const sequence = renderTopLevelSequence(
      [assistantMessage(100), userMessage(400), command(500)],
      { kind: "after-cutoff", cutoffAt: 300 },
    );

    expect(sequence).toEqual(["assistant", "user", DIVIDER, "work"]);
  });

  it("omits the divider when no row started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      { kind: "after-cutoff", cutoffAt: 400 },
    );

    expect(sequence).not.toContain(DIVIDER);
  });

  it("places the divider above the first row for an explicitly unread thread", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      { kind: "before-first" },
    );

    expect(sequence[0]).toBe(DIVIDER);
  });
});
