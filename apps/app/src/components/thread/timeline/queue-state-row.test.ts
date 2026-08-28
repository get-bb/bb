import { describe, expect, it } from "vitest";
import {
  collectTimelineAutoExpansionRowIds,
  isRowExpandable,
} from "@bb/client-core";
import { buildTimelineViewRows } from "@bb/thread-view";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";

/**
 * A parked queue row's reason rides its title line, so the only thing the body
 * has to offer is the parked message. That is not the generic `detail`-only
 * rule every other system row uses, and this file exists to prove the kind is
 * actually wired into the predicate rather than falling through to it.
 */
describe("queue-state row expandability", () => {
  it("opens for a parked row that has only the parked message", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "queue-state",
          detail: null,
          reason: "Scheduled",
          inputPreview: "Ship the release notes",
        }),
      ),
    ).toBe(true);
  });

  it("stays closed for a parked row whose only content is its reason", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "queue-state",
          detail: null,
          reason: "4 of 4 running",
          inputPreview: null,
        }),
      ),
    ).toBe(false);
  });

  it("leaves the rule for every other system row alone", () => {
    expect(
      isRowExpandable(
        systemRow({ operationKind: "thread-provisioning", detail: null }),
      ),
    ).toBe(false);
  });
});

/**
 * A thread whose first message is parked is not running, so the frontier rules
 * that drive every other auto-expansion never fire for it. Without a rule of
 * its own the one row explaining the silence would be the one row that stays
 * shut.
 */
describe("queue-state row auto-expansion", () => {
  function waitingRowIds(scopeActive: boolean): string[] {
    const rows = buildTimelineViewRows([
      systemRow({
        id: "waiting-queue-row",
        operationKind: "queue-state",
        status: "pending",
        title: "Waiting to send",
        reason: "Scheduled",
        inputPreview: "Ship the release notes",
        detail: null,
      }),
    ]);
    return Array.from(
      collectTimelineAutoExpansionRowIds({ rows, scopeActive })
        .liveExpandedRowIds,
    );
  }

  it("opens a parked row on an idle thread", () => {
    expect(waitingRowIds(false)).toEqual(["waiting-queue-row"]);
  });

  it("opens a parked row on an active thread too", () => {
    expect(waitingRowIds(true)).toEqual(["waiting-queue-row"]);
  });

  it("closes again once the row dispatches", () => {
    const rows = buildTimelineViewRows([
      systemRow({
        id: "settled-queue-row",
        operationKind: "queue-state",
        status: "completed",
        title: "Sent",
        reason: "Scheduled",
        inputPreview: "Ship the release notes",
        detail: null,
      }),
    ]);
    const { liveExpandedRowIds, terminalFrontierRowIds } =
      collectTimelineAutoExpansionRowIds({ rows, scopeActive: false });
    expect(Array.from(liveExpandedRowIds)).toEqual([]);
    expect(Array.from(terminalFrontierRowIds)).toEqual([]);
  });
});
