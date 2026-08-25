import { describe, expect, it } from "vitest";
import { formatHoldResumeCountdown, parseHoldUntil } from "./hold-time.js";

// A fixed local wall clock so duration arithmetic and the "already passed"
// boundary are both exact.
const NOW = Date.parse("2026-08-25T12:00:00Z");

describe("parseHoldUntil", () => {
  it("resolves every duration unit against the supplied clock", () => {
    expect(parseHoldUntil("30s", NOW)).toBe(NOW + 30_000);
    expect(parseHoldUntil("10m", NOW)).toBe(NOW + 600_000);
    expect(parseHoldUntil("2h", NOW)).toBe(NOW + 7_200_000);
    expect(parseHoldUntil("7d", NOW)).toBe(NOW + 604_800_000);
  });

  it("accepts fractional durations and surrounding whitespace", () => {
    expect(parseHoldUntil(" 1.5h ", NOW)).toBe(NOW + 5_400_000);
  });

  it("resolves an absolute ISO timestamp with an explicit offset", () => {
    expect(parseHoldUntil("2026-08-25T13:30:00Z", NOW)).toBe(
      Date.parse("2026-08-25T13:30:00Z"),
    );
    expect(parseHoldUntil("2026-08-25 13:30:00Z", NOW)).toBe(
      Date.parse("2026-08-25T13:30:00Z"),
    );
  });

  // Rejecting the past is the whole point of the flag: a `holdUntil` already
  // behind the sweep would dispatch immediately, silently ignoring the request.
  it("rejects a timestamp that has already passed", () => {
    expect(() => parseHoldUntil("2026-08-25T11:59:00Z", NOW)).toThrow(
      /must be in the future/,
    );
  });

  it("rejects a zero-length duration", () => {
    expect(() => parseHoldUntil("0m", NOW)).toThrow(/must be in the future/);
  });

  // `Date.parse` reads a bare date as UTC midnight while the user meant their
  // own midnight, so the ambiguity is refused rather than guessed at.
  it("rejects a date with no time of day", () => {
    expect(() => parseHoldUntil("2026-12-01", NOW)).toThrow(/no time of day/);
  });

  // `Date.parse("10")` yields a date in 2001; only the two documented shapes
  // are accepted so no such fallback can reach the server.
  it("rejects values that are neither a timestamp nor a duration", () => {
    expect(() => parseHoldUntil("10", NOW)).toThrow(/neither a timestamp/);
    expect(() => parseHoldUntil("tomorrow", NOW)).toThrow(
      /neither a timestamp/,
    );
    expect(() => parseHoldUntil("10 minutes", NOW)).toThrow(
      /neither a timestamp/,
    );
    expect(() => parseHoldUntil("", NOW)).toThrow(/It is empty/);
  });

  it("rejects a well-formed timestamp that is not a real date", () => {
    expect(() => parseHoldUntil("2026-13-01T10:00:00Z", NOW)).toThrow(
      /not a real date/,
    );
  });
});

describe("formatHoldResumeCountdown", () => {
  it("distinguishes owner-held, pending and overdue timers", () => {
    expect(formatHoldResumeCountdown(null, NOW)).toBe("-");
    expect(formatHoldResumeCountdown(NOW + 600_000, NOW)).toBe("in 10m");
    expect(formatHoldResumeCountdown(NOW - 1, NOW)).toBe("due");
  });
});
