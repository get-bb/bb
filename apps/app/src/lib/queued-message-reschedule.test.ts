import { describe, expect, it } from "vitest";
import {
  isQueuedMessageReschedulable,
  parseQueuedMessageScheduleFields,
  queuedMessageScheduleFields,
} from "./queued-message-reschedule";

describe("queued message reschedule fields", () => {
  const now = new Date(2026, 9, 30, 8, 15).getTime();

  it("prefills the fields with the current schedule in local time", () => {
    expect(
      queuedMessageScheduleFields(new Date(2026, 9, 31, 9, 5).getTime()),
    ).toEqual({ date: "2026-10-31", time: "09:05" });
  });

  it("round-trips a prefilled schedule", () => {
    const at = new Date(2026, 9, 31, 11, 0).getTime();
    expect(
      parseQueuedMessageScheduleFields(queuedMessageScheduleFields(at), now),
    ).toEqual({ ok: true, at });
  });

  it.each([
    [{ date: "", time: "09:00" }, "Choose a date."],
    [{ date: "2026-10-31", time: "" }, "Choose a time."],
    [{ date: "2026-02-30", time: "09:00" }, "Choose a real date and time."],
    [{ date: "2026-10-30", time: "08:15" }, "Choose a future time."],
    [{ date: "2026-10-29", time: "11:00" }, "Choose a future time."],
  ])("rejects %j", (fields, message) => {
    expect(parseQueuedMessageScheduleFields(fields, now)).toEqual({
      ok: false,
      message,
    });
  });

  it("offers rescheduling only for rows waiting on their send time", () => {
    expect(
      isQueuedMessageReschedulable({ sendAt: now, state: "scheduled" }),
    ).toBe(true);
    expect(
      isQueuedMessageReschedulable({ sendAt: null, state: "queued" }),
    ).toBe(false);
    expect(
      isQueuedMessageReschedulable({ sendAt: now, state: "claimed" }),
    ).toBe(false);
  });
});
