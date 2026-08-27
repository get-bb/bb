import { isRowExpandable } from "@bb/client-core";
import { describe, expect, it } from "vitest";
import { systemRow } from "@/test/fixtures/thread-timeline-rows";

/**
 * A held-dispatch row keeps its reason and the held message in their own
 * fields, so `detail` carries the hold owner's report alone — and the ordinary
 * hold ("Scheduled", nothing reported yet) has no report at all. Testing
 * `detail` for expandability would therefore collapse the one row whose whole
 * job is to explain why the thread has not run.
 */
describe("held dispatch row expandability", () => {
  it("opens for a hold whose only content is its reason", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "dispatch-hold",
          detail: null,
          reason: "Scheduled",
          inputPreview: null,
        }),
      ),
    ).toBe(true);
  });

  it("opens for a hold that has only the held message", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "dispatch-hold",
          detail: null,
          reason: "",
          inputPreview: "Ship the release notes",
        }),
      ),
    ).toBe(true);
  });

  it("stays closed when a hold has nothing to show at all", () => {
    expect(
      isRowExpandable(
        systemRow({
          operationKind: "dispatch-hold",
          detail: null,
          reason: "   ",
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
