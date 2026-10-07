import type { TimelineRow } from "@bb/server-contract";
import { assertTimelineSourceOwnership } from "./timeline-source-ownership.js";
import { describe, expect, it } from "vitest";
import { buildThreadTimelineTurnDetailsFromEvents } from "../src/build-thread-timeline.js";
import {
  createTimelineEventFactory,
  fromRows,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

describe("timeline source ownership", () => {
  it("preserves distinct events with identical content", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const { rows } = renderTimelineFixture({
      events: [
        factory.systemError({ code: "test", message: "Failure" }),
        factory.systemError({ code: "test", message: "Failure" }),
      ],
      projectionOptions: { threadStatus: "error", turnMessageDetail: "full" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it.each([false, true])(
    "merges provisioning companions across intervening events: %s",
    (intervening) => {
      const factory = createTimelineEventFactory({ threadId: "thread-1" });
      const started = factory.threadProvisioning({
        status: "active",
        entries: [],
      });
      const failed = factory.threadProvisioning({
        status: "failed",
        entries: [
          {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup failed",
            status: "failed",
          },
        ],
      });
      const other = factory.systemError({
        code: "unrelated",
        message: "Other failure",
      });
      const error = factory.systemError({
        code: "thread_provisioning_failed",
        message: "Provisioning thread failed",
        detail: "Cannot checkout branch",
      });
      const { rows } = renderTimelineFixture({
        events: [started, failed, ...(intervening ? [other] : []), error],
        projectionOptions: { threadStatus: "error", turnMessageDetail: "full" },
      });
      const failures = rows.filter(
        (row) =>
          row.kind === "system" && row.title === "Provisioning thread failed",
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        detail: expect.stringContaining("Cannot checkout branch"),
      });
      expect(failures[0]).toMatchObject({
        detail: expect.stringContaining("Workspace setup failed"),
      });
      expect(rows).toHaveLength(intervening ? 2 : 1);
    },
  );

  it("retains a standalone provisioning error and an unpaired failed operation", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const { rows } = renderTimelineFixture({
      events: [
        factory.systemError({
          code: "thread_provisioning_failed",
          message: "Provisioning thread failed",
          detail: "Standalone detail",
        }),
        factory.threadProvisioning({ status: "failed", entries: [] }),
      ],
      projectionOptions: { threadStatus: "error", turnMessageDetail: "full" },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      systemKind: "error",
      detail: "Standalone detail",
    });
    expect(rows[1]).toMatchObject({
      operationKind: "thread-provisioning",
      status: "error",
    });
  });

  it("retains distinct provisioning attempts and unrelated equal-titled errors", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const events = ["first", "second"].flatMap((provisioningId) => [
      factory.threadProvisioning({
        provisioningId,
        status: "failed",
        entries: [],
      }),
      factory.systemError({
        code: "thread_provisioning_failed",
        message: "Provisioning thread failed",
        detail: provisioningId,
      }),
    ]);
    events.push(
      factory.systemError({
        code: "unrelated",
        message: "Provisioning thread failed",
      }),
    );
    const { rows } = renderTimelineFixture({
      events,
      projectionOptions: { threadStatus: "error", turnMessageDetail: "full" },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ detail: "first" });
    expect(rows[1]).toMatchObject({ detail: "second" });
    expect(rows[2]).toMatchObject({ systemKind: "error" });
  });
  it("normalizes reconnect rows consistently in eager and lazy turn details", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      factory.turnStarted({}),
      factory.providerError({
        message: "Provider error",
        detail: "Reconnecting... 1/3\nstream disconnected",
        willRetry: true,
      }),
      factory.providerError({
        message: "Provider error",
        detail: "Reconnecting... 2/3\nstream disconnected",
        willRetry: true,
      }),
      factory.assistantCompleted({ text: "Recovered" }),
      factory.turnCompleted({}),
    ];
    const timeline = renderTimelineFixture({
      events,
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    });
    const turn = timeline.turnRows[0];
    expect(turn.children).toHaveLength(1);
    expect(turn.children?.[0]).toMatchObject({ title: "Reconnecting... 2/3" });
    const details = buildThreadTimelineTurnDetailsFromEvents({
      events: fromRows(events),
      options: {
        completedTurnDisplay: "collapse",
        includeDiagnosticOperations: false,
        sourceSeqStart: turn.sourceSeqStart,
        turnId: turn.turnId,
        threadStatus: "idle",
        threadName: "",
        workspaceRoot: null,
      },
    });
    expect(details).toMatchObject({ kind: "matched", rows: turn.children });
  });
  it.each([false, true])(
    "rejects two distinct row ids owning one source, nested: %s",
    (nested) => {
      const factory = createTimelineEventFactory({ threadId: "thread-1" });
      const events = [
        factory.systemError({ code: "test", message: "Failure" }),
      ];
      const fixture = renderTimelineFixture({
        events,
        projectionOptions: { threadStatus: "error", turnMessageDetail: "full" },
      });
      const entry = fixture.projection.entries[0];
      if (entry.kind !== "projected-message")
        throw new Error("Expected standalone failure");
      const duplicateMessage = {
        ...entry.message,
        id: "second-representation",
      };
      const duplicateRow = { ...fixture.rows[0], id: duplicateMessage.id };
      const extraRow: TimelineRow = nested
        ? {
            ...fixture.rows[0],
            id: "summary",
            kind: "turn",
            turnId: "turn-1",
            status: "completed",
            completedAt: 10,
            summaryCount: 1,
            children: [duplicateRow],
          }
        : duplicateRow;
      expect(() =>
        assertTimelineSourceOwnership(
          fromRows(events),
          {
            ...fixture.projection,
            entries: [
              ...fixture.projection.entries,
              { kind: "projected-message", message: duplicateMessage },
            ],
          },
          [...fixture.rows, extraRow],
          [],
        ),
      ).toThrow("Duplicate source ownership");
    },
  );

  it("preserves distinct grouped input parts through event replay", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const event = factory.clientTurnRequested({
      text: "First Second",
      inputGroups: [
        [{ type: "text", text: "", mentions: [] }],
        [{ type: "text", text: "First", mentions: [] }],
        [{ type: "text", text: "Second", mentions: [] }],
      ],
    });
    const fixture = renderTimelineFixture({
      events: [event, event],
      projectionOptions: { threadStatus: "active", turnMessageDetail: "full" },
    });
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.messages.map((message) => message.sourceEvent)).toEqual([
      { seq: event.seq, part: 1 },
      { seq: event.seq, part: 2 },
    ]);
  });

  it("preserves distinct file changes through event replay", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const start = factory.turnStarted({});
    const event = factory.fileChangeCompleted({
      changes: [
        { path: "a.ts", kind: "update", diff: "" },
        { path: "b.ts", kind: "update", diff: "" },
      ],
    });
    const fixture = renderTimelineFixture({
      events: [start, event, event],
      completedTurnDisplay: "flat",
      projectionOptions: { threadStatus: "active", turnMessageDetail: "full" },
    });
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.messages.map((message) => message.sourceEvent)).toEqual([
      { seq: event.seq, part: 0 },
      { seq: event.seq, part: 1 },
    ]);
  });

  it("applies assistant and command output deltas once per source event", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const start = factory.turnStarted({});
    const assistant = factory.assistantDelta({ delta: "Inspecting.\n" });
    const command = factory.commandStarted({
      itemId: "command-1",
      command: "inspect",
    });
    const output = factory.commandOutputDelta({
      itemId: "command-1",
      delta: "result\n",
    });
    const fixture = renderTimelineFixture({
      events: [start, assistant, assistant, command, output, output],
      completedTurnDisplay: "flat",
      projectionOptions: { threadStatus: "active", turnMessageDetail: "full" },
    });
    expect(fixture.rows).toHaveLength(2);
    expect(fixture.rows[0]).toMatchObject({ text: "Inspecting.\n" });
    expect(fixture.rows[1]).toMatchObject({ output: "result\n" });
  });
});
