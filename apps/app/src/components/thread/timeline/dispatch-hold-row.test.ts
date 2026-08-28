import { describe, expect, it } from "vitest";
import {
  collectTimelineAutoExpansionRowIds,
  isRowExpandable,
} from "@bb/client-core";
import { buildTimelineViewRows } from "@bb/thread-view";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";

/**
 * A held-dispatch row's reason rides its title line, so what the body has to
 * offer is the held message and the holder's report. `detail` carries only the
 * report, which is why it cannot be the whole expandability test: a scheduled
 * send has never reported anything and still has a message worth reading.
 */
describe("held dispatch row expandability", () => {
  it("opens for a hold that has only the held message", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "dispatch-hold",
          detail: null,
          reason: "Scheduled",
          inputPreview: "Ship the release notes",
        }),
      ),
    ).toBe(true);
  });

  it("stays closed for a hold whose only content is its reason", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "dispatch-hold",
          detail: null,
          reason: "Rate limited · retrying at 4:05 PM",
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
 * A thread whose first turn is held is not running, so the frontier rules that
 * drive every other auto-expansion never fire for it. Without a rule of its
 * own the one row explaining the silence would be the one row that stays shut.
 */
describe("held dispatch row auto-expansion", () => {
  function waitingHoldIds(scopeActive: boolean): string[] {
    const rows = buildTimelineViewRows([
      systemRow({
        id: "waiting-hold",
        operationKind: "dispatch-hold",
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

  it("opens a waiting hold on an idle thread", () => {
    expect(waitingHoldIds(false)).toEqual(["waiting-hold"]);
  });

  it("opens a waiting hold on an active thread too", () => {
    expect(waitingHoldIds(true)).toEqual(["waiting-hold"]);
  });

  it("closes again once the hold settles", () => {
    const rows = buildTimelineViewRows([
      systemRow({
        id: "settled-hold",
        operationKind: "dispatch-hold",
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
