import { describe, expect, it } from "vitest";
import { assemblePullStatus, type RawPullStatus } from "./pull-status.js";
import {
  nextMondayMorning,
  snoozeFor,
  snoozeLabel,
  snoozeWakes,
  tomorrowMorning,
} from "./snooze.js";

function status(overrides: Partial<RawPullStatus> = {}) {
  return assemblePullStatus({
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "0000000",
    isCrossRepository: false,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    mergedAt: null,
    checksVerdict: null,
    stack: null,
    headOwner: null,
    mergeable: "MERGEABLE",
    reviewDecision: null,
    isInMergeQueue: false,
    requestedReviewers: [],
    checkRunCounts: [{ state: "IN_PROGRESS", count: 2 }],
    statusContextCounts: [],
    ...overrides,
  });
}

const now = new Date(2026, 9, 20, 15, 30);

describe("snooze wake rules", () => {
  const subject = { pr: status({ headRefOid: "aaa" }) };

  it("wakes on a new checks state, not on checks ticking along", () => {
    const snooze = snoozeFor("checks", null, subject, now);
    expect(snooze.checks).toBe("pending");
    expect(snoozeWakes(snooze, subject, now)).toBe(false);
    expect(
      snoozeWakes(
        snooze,
        {
          ...subject,
          pr: status({ checkRunCounts: [{ state: "IN_PROGRESS", count: 1 }] }),
        },
        now,
      ),
    ).toBe(false);
    expect(
      snoozeWakes(
        snooze,
        {
          ...subject,
          pr: status({ checkRunCounts: [{ state: "FAILURE", count: 1 }] }),
        },
        now,
      ),
    ).toBe(true);
  });

  it("wakes on a new head commit or at the chosen time", () => {
    const push = snoozeFor("push", null, subject, now);
    expect(snoozeWakes(push, subject, now)).toBe(false);
    expect(
      snoozeWakes(push, { ...subject, pr: status({ headRefOid: "bbb" }) }, now),
    ).toBe(true);
    expect(
      snoozeWakes(push, { ...subject, pr: status({ headRefOid: null }) }, now),
    ).toBe(false);

    const later = snoozeFor(
      "time",
      tomorrowMorning(now).toISOString(),
      subject,
      now,
    );
    expect(snoozeWakes(later, subject, now)).toBe(false);
    expect(snoozeWakes(later, subject, tomorrowMorning(now))).toBe(true);
  });

  it("wakes once the pull request is merged or closed", () => {
    const snooze = snoozeFor("checks", null, subject, now);
    expect(
      snoozeWakes(snooze, { ...subject, pr: status({ state: "MERGED" }) }, now),
    ).toBe(true);
  });
});

describe("snooze times and labels", () => {
  it("picks tomorrow 8:00 and next Monday 8:00 in local time", () => {
    expect(tomorrowMorning(now)).toEqual(new Date(2026, 9, 21, 8, 0));
    expect(nextMondayMorning(now)).toEqual(new Date(2026, 9, 26, 8, 0));
    expect(nextMondayMorning(new Date(2026, 9, 26, 7, 0))).toEqual(
      new Date(2026, 10, 2, 8, 0),
    );
    expect(nextMondayMorning(new Date(2026, 9, 25, 22, 0))).toEqual(
      new Date(2026, 9, 26, 8, 0),
    );
  });

  it("names when a snooze ends", () => {
    const subject = { pr: status() };
    const at = (date: Date) =>
      snoozeLabel(snoozeFor("time", date.toISOString(), subject, now), now);
    expect(snoozeLabel(snoozeFor("checks", null, subject, now), now)).toBe(
      "until checks change",
    );
    expect(at(tomorrowMorning(now))).toBe("until tomorrow 8:00");
    expect(at(nextMondayMorning(now))).toBe("until Mon 8:00");
    expect(at(new Date(2026, 9, 20, 18, 0))).toBe("until 18:00");
  });
});
