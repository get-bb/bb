import type { ThreadEventRow } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildThreadTimelineTurnDetailsFromEvents } from "../src/build-thread-timeline.js";
import { assertTimelineSourceOwnership } from "./timeline-source-ownership.js";
import {
  createTimelineEventFactory,
  fromRows,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

function fixture() {
  const factory = createTimelineEventFactory({ threadId: "thread-1" });
  return {
    factory,
    failed: (provisioningId = "first", transcript = false) =>
      factory.threadProvisioning({
        provisioningId,
        status: "failed",
        entries: transcript
          ? [
              {
                type: "step",
                key: "workspace-failed",
                text: "Workspace setup failed",
                status: "failed",
              },
            ]
          : [],
      }),
    error: (
      detail: string | undefined = undefined,
      code = "thread_provisioning_failed",
    ) =>
      factory.systemError({
        code,
        message: "Provisioning thread failed",
        detail,
      }),
    render: (
      events: ThreadEventRow[],
      threadStatus: "error" | "idle" | "active" = "error",
      completedTurnDisplay: "collapse" | "flat" = "collapse",
    ) =>
      renderTimelineFixture({
        events,
        completedTurnDisplay,
        projectionOptions: { threadStatus, turnMessageDetail: "full" },
      }),
  };
}

describe("timeline source ownership", () => {
  it("merges provisioning companions across intervening events and preserves both details", () => {
    const { factory, failed, error, render } = fixture();
    const { rows } = render([
      factory.threadProvisioning({
        provisioningId: "first",
        status: "active",
        entries: [],
      }),
      failed("first", true),
      factory.systemError({ code: "unrelated", message: "Other failure" }),
      error("Cannot checkout branch"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "Provisioning thread failed",
      detail: expect.stringContaining("Cannot checkout branch"),
    });
    expect(rows[0]).toMatchObject({
      detail: expect.stringContaining("Workspace setup failed"),
    });
  });

  it("retains a standalone provisioning error and an unpaired failed operation", () => {
    const { failed, error, render } = fixture();
    const { rows } = render([error("Standalone detail"), failed()]);
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

  it("retains distinct attempts and distinct errors with identical content", () => {
    const { failed, error, render } = fixture();
    const events = ["first", "second"].flatMap((id) => [failed(id), error(id)]);
    const { rows } = render([
      ...events,
      error(undefined, "unrelated"),
      error(undefined, "unrelated"),
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ detail: "first" });
    expect(rows[1]).toMatchObject({ detail: "second" });
    expect(rows.slice(2)).toEqual([
      expect.objectContaining({ systemKind: "error" }),
      expect.objectContaining({ systemKind: "error" }),
    ]);
    expect(rows[2].id).not.toBe(rows[3].id);
  });

  it("normalizes reconnect rows consistently in eager and lazy turn details", () => {
    const { factory, render } = fixture();
    const events = [
      factory.turnStarted({}),
      ...[1, 2].map((attempt) =>
        factory.providerError({
          message: "Provider error",
          detail: `Reconnecting... ${attempt}/3\nstream disconnected`,
          willRetry: true,
        }),
      ),
      factory.assistantCompleted({ text: "Recovered" }),
      factory.turnCompleted({}),
    ];
    const turn = render(events, "idle").turnRows[0];
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

  it("rejects distinct root and nested row ids owning one source", () => {
    const { error, render } = fixture();
    const events = [error()];
    const timeline = render(events);
    const entry = timeline.projection.entries[0];
    if (entry.kind !== "projected-message")
      throw new Error("Expected standalone failure");
    const message = { ...entry.message, id: "second-representation" };
    expect(() =>
      assertTimelineSourceOwnership(
        fromRows(events),
        {
          ...timeline.projection,
          entries: [
            ...timeline.projection.entries,
            { kind: "projected-message", message },
          ],
        },
        [
          ...timeline.rows,
          {
            ...timeline.rows[0],
            id: "summary",
            kind: "turn",
            turnId: "turn-1",
            status: "completed",
            completedAt: 10,
            summaryCount: 1,
            children: [{ ...timeline.rows[0], id: message.id }],
          },
        ],
        [],
      ),
    ).toThrow("Duplicate source ownership");
  });

  it("preserves distinct grouped input parts, including a skipped empty part", () => {
    const { factory, render } = fixture();
    const event = factory.clientTurnRequested({
      text: "First Second",
      inputGroups: ["", "First", "Second"].map((text) => [
        { type: "text", text, mentions: [] },
      ]),
    });
    const timeline = render([event], "active");
    expect(timeline.rows).toHaveLength(2);
    expect(timeline.messages.map((message) => message.sourceEvent)).toEqual(
      [1, 2].map((part) => ({ seq: event.seq, part })),
    );
  });

  it("preserves distinct file changes", () => {
    const { factory, render } = fixture();
    const start = factory.turnStarted({});
    const event = factory.fileChangeCompleted({
      changes: ["a.ts", "b.ts"].map((path) => ({
        path,
        kind: "update",
        diff: "",
      })),
    });
    const timeline = render([start, event], "active", "flat");
    expect(timeline.rows).toHaveLength(2);
    expect(timeline.messages.map((message) => message.sourceEvent)).toEqual(
      [0, 1].map((part) => ({ seq: event.seq, part })),
    );
  });

  it.each(["provisioning", "turn"] as const)(
    "clears provisioning correlation on a new %s lifecycle",
    (kind) => {
      const { factory, failed, error, render } = fixture();
      const first = failed();
      const boundary =
        kind === "provisioning"
          ? factory.threadProvisioning({
              provisioningId: "second",
              status: "active",
              entries: [],
            })
          : factory.turnStarted({});
      const { rows } = render([first, boundary, error("Unpaired error")]);
      expect(rows).toContainEqual(
        expect.objectContaining({
          systemKind: "error",
          detail: "Unpaired error",
        }),
      );
      expect(rows[0]).toMatchObject({
        operationKind: "thread-provisioning",
        detail: null,
      });
    },
  );
});
