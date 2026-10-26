// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { buildTimelineViewRows } from "@bb/thread-view";
import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  commandRow,
  conversationRow,
  systemRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import type { ThreadTimelineUnreadDividerPlacement } from "./types";
import {
  buildTimelineRowsListItems,
  useLoadedUnreadDividerPlacement,
} from "./ThreadTimelineRows";

const DIVIDER = "__divider__";

function firstUnreadRow(
  cutoffAt: number,
): ThreadTimelineUnreadDividerPlacement {
  return { anchor: "first-unread-row", cutoffAt };
}

function turnAnswer(cutoffAt: number): ThreadTimelineUnreadDividerPlacement {
  return { anchor: "turn-answer", cutoffAt };
}

function renderTopLevelSequence(
  timelineRows: TimelineRow[],
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null,
  scopeActive = false,
): string[] {
  return buildTimelineRowsListItems({
    rows: buildTimelineViewRows(timelineRows),
    scopeActive,
    unreadDividerPlacement,
  }).map((item) => {
    if (item.kind !== "row") return DIVIDER;
    return item.row.kind === "conversation" ? item.row.role : item.row.kind;
  });
}

function userMessage(createdAt: number, turnId = "turn-1"): TimelineRow {
  return conversationRow({
    id: `user-${createdAt}`,
    seq: createdAt,
    role: "user",
    text: "PROMPT",
    createdAt,
    startedAt: createdAt,
    turnId,
  });
}

function agentMessage(createdAt: number, turnId: string): TimelineRow {
  return conversationRow({
    id: `agent-${createdAt}`,
    seq: createdAt,
    role: "user",
    initiator: "agent",
    text: "REPORT",
    createdAt,
    startedAt: createdAt,
    turnId,
  });
}

function assistantMessage(createdAt: number, turnId = "turn-1"): TimelineRow {
  return conversationRow({
    id: `assistant-${createdAt}`,
    seq: createdAt,
    role: "assistant",
    text: "ANSWER",
    createdAt,
    startedAt: createdAt,
    turnId,
  });
}

function command(createdAt: number, turnId = "turn-1"): TimelineRow {
  return commandRow({
    id: `command-${createdAt}`,
    seq: createdAt,
    command: `echo ${createdAt}`,
    createdAt,
    startedAt: createdAt,
    turnId,
  });
}

describe("unread divider placement at the turn answer", () => {
  it("lands on the final answer of a flat turn that ran after the reader's prompt", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        assistantMessage(300),
        command(400),
        command(500),
        assistantMessage(600),
      ],
      turnAnswer(100),
    );

    expect(sequence).toEqual([
      "user",
      "work",
      "assistant",
      "step-summary",
      DIVIDER,
      "assistant",
    ]);
  });

  it("skips thread setup rows above the work of a new thread", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        systemRow({ id: "provisioned", seq: 150, startedAt: 150 }),
        command(200),
        assistantMessage(300),
      ],
      turnAnswer(100),
    );

    expect(sequence).toEqual(["user", "system", "work", DIVIDER, "assistant"]);
  });

  it("lands on the final answer of a collapsed turn the same way", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        turnRow({
          id: "turn-row",
          seq: 100,
          createdAt: 500,
          startedAt: 150,
          turnId: "turn-1",
          summaryCount: 3,
          children: [command(200), command(300), command(400)],
        }),
        assistantMessage(600),
      ],
      turnAnswer(100),
    );

    expect(sequence).toEqual(["user", "turn", DIVIDER, "assistant"]);
  });

  it("keeps the divider on an agent message that started a turn", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100, "turn-1"),
        assistantMessage(200, "turn-1"),
        agentMessage(400, "turn-2"),
        command(500, "turn-2"),
        assistantMessage(600, "turn-2"),
      ],
      turnAnswer(300),
    );

    expect(sequence).toEqual([
      "user",
      "assistant",
      DIVIDER,
      "user",
      "work",
      "assistant",
    ]);
  });

  it("lands on an error that ended the turn", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        systemRow({
          id: "error-300",
          seq: 300,
          createdAt: 300,
          startedAt: 300,
          systemKind: "error",
          title: "Provider failed",
          detail: null,
          turnId: "turn-1",
        }),
      ],
      turnAnswer(100),
    );

    expect(sequence).toEqual(["user", "work", DIVIDER, "system"]);
  });

  it("falls back to the first new row in a turn with no reply", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), command(300)],
      turnAnswer(100),
    );

    expect(sequence).toEqual(["user", DIVIDER, "bundle-summary"]);
  });

  it("does not move the divider onto the streaming reply of a running turn", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100, "turn-1"),
        assistantMessage(200, "turn-1"),
        agentMessage(400, "turn-2"),
        command(500, "turn-2"),
        assistantMessage(600, "turn-2"),
      ],
      turnAnswer(450),
      true,
    );

    expect(sequence).toEqual([
      "user",
      "assistant",
      "user",
      DIVIDER,
      "work",
      "assistant",
    ]);
  });

  it("keeps the divider below a work group the reader already saw part of", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        command(300),
        command(400),
        assistantMessage(500),
      ],
      turnAnswer(350),
    );

    expect(sequence).toEqual(["user", "step-summary", DIVIDER, "assistant"]);
  });

  it("never anchors the divider on the reader's own message", () => {
    const sequence = renderTopLevelSequence(
      [
        assistantMessage(100, "turn-1"),
        userMessage(400, "turn-2"),
        command(500, "turn-2"),
      ],
      turnAnswer(300),
    );

    expect(sequence).toEqual(["assistant", "user", DIVIDER, "work"]);
  });
});

describe("unread divider placement at the first unread row", () => {
  it("keeps the divider below a work group the reader already saw part of", () => {
    const sequence = renderTopLevelSequence(
      [
        userMessage(100),
        command(200),
        command(300),
        command(400),
        assistantMessage(500),
      ],
      firstUnreadRow(350),
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
      firstUnreadRow(300),
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
      firstUnreadRow(350),
    );

    expect(collapsed).toEqual(["user", "turn", DIVIDER, "assistant"]);
  });

  it("never anchors the divider on the reader's own message", () => {
    const sequence = renderTopLevelSequence(
      [assistantMessage(100), userMessage(400), command(500)],
      firstUnreadRow(300),
    );

    expect(sequence).toEqual(["assistant", "user", DIVIDER, "work"]);
  });

  it("omits the divider when no row started after the cutoff", () => {
    const sequence = renderTopLevelSequence(
      [userMessage(100), command(200), assistantMessage(300)],
      firstUnreadRow(400),
    );

    expect(sequence).not.toContain(DIVIDER);
  });
});

describe("loaded unread divider placement", () => {
  it("drops a divider whose cutoff is older than the loaded rows, and keeps it dropped after older rows load", () => {
    const placement = firstUnreadRow(350);
    const latestPage = buildTimelineViewRows([
      command(400),
      assistantMessage(500),
    ]);
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useLoadedUnreadDividerPlacement>[0]) =>
        useLoadedUnreadDividerPlacement(props),
      {
        initialProps: {
          hasOlderRows: true,
          rows: latestPage,
          unreadDividerPlacement: placement,
        },
      },
    );
    expect(result.current).toBeNull();

    rerender({
      hasOlderRows: false,
      rows: buildTimelineViewRows([
        userMessage(100),
        command(200),
        command(400),
        assistantMessage(500),
      ]),
      unreadDividerPlacement: placement,
    });
    expect(result.current).toBeNull();
  });

  it("keeps a divider whose cutoff falls inside the loaded rows", () => {
    const placement = firstUnreadRow(350);
    const { result } = renderHook(() =>
      useLoadedUnreadDividerPlacement({
        hasOlderRows: true,
        rows: buildTimelineViewRows([
          userMessage(300),
          command(400),
          assistantMessage(500),
        ]),
        unreadDividerPlacement: placement,
      }),
    );
    expect(result.current).toBe(placement);
  });
});
