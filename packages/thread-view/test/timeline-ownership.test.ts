import { describe, expect, it } from "vitest";
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
});
