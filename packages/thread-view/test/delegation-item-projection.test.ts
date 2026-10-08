import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

type TimelineDelegationRow = Extract<
  TimelineRow,
  { kind: "work"; workKind: "delegation" }
>;

function findDelegationRow(
  rows: readonly TimelineRow[],
  callId: string,
): TimelineDelegationRow {
  for (const row of rows) {
    if (
      row.kind === "work" &&
      row.workKind === "delegation" &&
      row.callId === callId
    ) {
      return row;
    }
    if (row.kind === "turn" && row.children) {
      const nested = row.children.find(
        (child): child is TimelineDelegationRow =>
          child.kind === "work" &&
          child.workKind === "delegation" &&
          child.callId === callId,
      );
      if (nested) return nested;
    }
  }
  throw new Error(`no delegation row for ${callId}`);
}

describe("delegation item projection", () => {
  it.each(["explicit", "inherited", "completion-only"] as const)(
    "keeps %s child compactions inside the delegation and root compactions in the main feed",
    (mode) => {
      const event = createTimelineEventFactory({ threadId: "thread-1" });
      const childScope = {
        turnId: "child-turn",
        ...(mode === "inherited" ? {} : { parentToolCallId: "call-1" }),
      };
      const timeline = renderTimelineFixture({
        events: [
          event.turnStarted({ turnId: "parent-turn", createdAt: 0 }),
          event.delegationStarted({
            turnId: "parent-turn",
            itemId: "call-1",
            childRef: "child",
            label: "/root/review",
            createdAt: 1_000,
          }),
          event.turnStarted({
            turnId: "child-turn",
            ...(mode === "inherited" ? { parentToolCallId: "call-1" } : {}),
            createdAt: 2_000,
          }),
          ...(mode === "completion-only"
            ? []
            : [
                event.contextCompactionStarted({
                  ...childScope,
                  createdAt: 3_000,
                }),
              ]),
          event.contextCompactionStarted({
            turnId: "parent-turn",
            itemId: "root-compaction",
            createdAt: 4_000,
          }),
          event.contextCompactionCompleted({ ...childScope, createdAt: 5_000 }),
          event.contextCompactionCompleted({
            turnId: "parent-turn",
            itemId: "root-compaction",
            createdAt: 6_000,
          }),
        ],
        projectionOptions: {
          threadStatus: "active",
          turnMessageDetail: "full",
        },
      });
      const delegation = findDelegationRow(timeline.rows, "call-1");
      expect(delegation.childRows).toContainEqual(
        expect.objectContaining({
          kind: "system",
          operationKind: "compaction",
          status: "completed",
          startedAt: mode === "completion-only" ? 5_000 : 3_000,
          completedAt: 5_000,
        }),
      );
      const rootRows = timeline.rows.flatMap((row) =>
        row.kind === "turn" ? (row.children ?? []) : [row],
      );
      const compactions = rootRows.filter(
        (row) =>
          row.kind === "system" &&
          row.systemKind === "operation" &&
          row.operationKind === "compaction",
      );
      expect(compactions).toHaveLength(1);
      expect(compactions[0]).toMatchObject({
        startedAt: 4_000,
        completedAt: 6_000,
      });
    },
  );

  it("renders a delegation item as a delegation row with its child content nested", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "parent-turn", createdAt: 0 }),
        event.delegationStarted({
          turnId: "parent-turn",
          itemId: "call-1",
          childRef: "agent-thread-1",
          label: "/root/read_readme",
          createdAt: 1_000,
        }),
        event.turnStarted({
          turnId: "child-turn",
          parentToolCallId: "call-1",
          createdAt: 2_000,
        }),
        event.assistantCompleted({
          turnId: "child-turn",
          parentToolCallId: "call-1",
          itemId: "child-message",
          text: "README says hello.",
          createdAt: 3_000,
        }),
        event.turnCompleted({ turnId: "child-turn", createdAt: 4_000 }),
        event.delegationCompleted({
          turnId: "parent-turn",
          itemId: "call-1",
          childRef: "agent-thread-1",
          label: "/root/read_readme",
          summary: "Read the README.",
          createdAt: 5_000,
        }),
        event.turnCompleted({ turnId: "parent-turn", createdAt: 6_000 }),
      ],
      projectionOptions: {
        threadStatus: "idle",
        turnMessageDetail: "full",
      },
    });

    const row = findDelegationRow(timeline.rows, "call-1");
    expect(row).toEqual(
      expect.objectContaining({
        workKind: "delegation",
        status: "completed",
        description: "/root/read_readme",
        output: "Read the README.",
        completedAt: 5_000,
      }),
    );
    expect(
      row.childRows.map((child) =>
        child.kind === "conversation" ? child.text : child.kind,
      ),
    ).toContain("README says hello.");
    const rootConversationTexts = timeline.rows.flatMap((row) =>
      row.kind === "turn"
        ? (row.children ?? []).flatMap((child) =>
            child.kind === "conversation" ? [child.text] : [],
          )
        : row.kind === "conversation"
          ? [row.text]
          : [],
    );
    expect(rootConversationTexts).not.toContain("README says hello.");
  });

  it("keeps a delegation pending across the settled parent turn", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "parent-turn", createdAt: 0 }),
        event.delegationStarted({
          turnId: "parent-turn",
          itemId: "call-1",
          childRef: "agent-thread-1",
          label: "/root/review",
          createdAt: 1_000,
        }),
        event.turnCompleted({ turnId: "parent-turn", createdAt: 2_000 }),
      ],
      projectionOptions: {
        threadStatus: "active",
        turnMessageDetail: "full",
      },
    });
    expect(findDelegationRow(timeline.rows, "call-1")).toEqual(
      expect.objectContaining({
        status: "pending",
        description: "/root/review",
      }),
    );
  });

  it.each([
    { lastRoundCompletes: true, status: "completed", completedAt: 21_000 },
    { lastRoundCompletes: false, status: "pending", completedAt: null },
  ] as const)(
    "reopens a nested delegation per follow-up instead of repeating it (last round completes: $lastRoundCompletes)",
    ({ lastRoundCompletes, status, completedAt }) => {
      const event = createTimelineEventFactory({ threadId: "thread-1" });
      const reviewer = { childRef: "reviewer", label: "/root/review" };
      const checker = { childRef: "checker", label: "/root/review/check" };
      const reviewerRound = (round: number, at: number) => [
        event.delegationStarted({
          turnId: "parent-turn",
          itemId: "review",
          ...reviewer,
          createdAt: at,
        }),
        event.turnStarted({
          turnId: `review-turn-${round}`,
          parentToolCallId: "review",
          createdAt: at + 1,
        }),
        ...[0, 1].flatMap((checkRound) => [
          event.delegationStarted({
            turnId: `review-turn-${round}`,
            parentToolCallId: "review",
            itemId: "check",
            ...checker,
            createdAt: at + 2 + checkRound * 4,
          }),
          event.turnStarted({
            turnId: `check-turn-${round}-${checkRound}`,
            parentToolCallId: "check",
            createdAt: at + 3 + checkRound * 4,
          }),
          event.assistantCompleted({
            turnId: `check-turn-${round}-${checkRound}`,
            parentToolCallId: "check",
            itemId: `check-message-${round}-${checkRound}`,
            text: `check ${round}.${checkRound}`,
            createdAt: at + 4 + checkRound * 4,
          }),
          event.turnCompleted({
            turnId: `check-turn-${round}-${checkRound}`,
            createdAt: at + 5 + checkRound * 4,
          }),
          event.delegationCompleted({
            turnId: `review-turn-${round}`,
            parentToolCallId: "review",
            itemId: "check",
            ...checker,
            summary: `checked ${round}.${checkRound}`,
            createdAt: at + 6 + checkRound * 4,
          }),
        ]),
        event.turnCompleted({
          turnId: `review-turn-${round}`,
          createdAt: at + 20,
        }),
      ];
      const timeline = renderTimelineFixture({
        events: [
          event.turnStarted({ turnId: "parent-turn", createdAt: 0 }),
          ...reviewerRound(0, 1_000),
          event.delegationCompleted({
            turnId: "parent-turn",
            itemId: "review",
            ...reviewer,
            summary: "first review",
            createdAt: 11_000,
          }),
          ...reviewerRound(1, 20_000),
          ...(lastRoundCompletes
            ? [
                event.delegationCompleted({
                  turnId: "parent-turn",
                  itemId: "review",
                  ...reviewer,
                  summary: "second review",
                  createdAt: 21_000,
                }),
                event.turnCompleted({
                  turnId: "parent-turn",
                  createdAt: 22_000,
                }),
              ]
            : []),
        ],
        projectionOptions: {
          threadStatus: lastRoundCompletes ? "idle" : "active",
          turnMessageDetail: "full",
        },
      });

      const delegationRows = (
        rows: readonly TimelineRow[],
      ): TimelineDelegationRow[] =>
        rows.flatMap((row) => {
          if (row.kind === "turn") return delegationRows(row.children ?? []);
          if (row.kind === "work" && row.workKind === "delegation") {
            return [row, ...delegationRows(row.childRows)];
          }
          return [];
        });
      expect(delegationRows(timeline.rows).map((row) => row.callId)).toEqual([
        "review",
        "check",
      ]);
      expect(findDelegationRow(timeline.rows, "review")).toEqual(
        expect.objectContaining({ status, completedAt }),
      );
      const check = findDelegationRow(
        findDelegationRow(timeline.rows, "review").childRows,
        "check",
      );
      expect(check).toEqual(
        expect.objectContaining({
          status: "completed",
          output: "checked 1.1",
        }),
      );
      expect(
        check.childRows.flatMap((row) =>
          row.kind === "conversation" ? [row.text] : [],
        ),
      ).toEqual(["check 0.0", "check 0.1", "check 1.0", "check 1.1"]);
    },
  );
});
