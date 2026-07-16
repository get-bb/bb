import { describe, expect, it } from "vitest";
import {
  formatFileSize,
  formatRelativeTime,
  splitSystemBody,
} from "./time.js";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

describe("formatRelativeTime", () => {
  it("covers the just-now/minutes/hours/days ladder", () => {
    expect(formatRelativeTime(at(20_000), NOW)).toBe("just now");
    expect(formatRelativeTime(at(5 * 60_000), NOW)).toBe("5m ago");
    expect(formatRelativeTime(at(59 * 60_000), NOW)).toBe("59m ago");
    expect(formatRelativeTime(at(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(formatRelativeTime(at(50 * 3_600_000), NOW)).toBe("2d ago");
  });

  it("clamps future timestamps (clock skew) to just now", () => {
    expect(formatRelativeTime(at(-90_000), NOW)).toBe("just now");
  });

  it("returns empty for an unparseable timestamp", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});

describe("splitSystemBody", () => {
  it("bolds the trailing author of a server system comment", () => {
    expect(splitSystemBody("Status changed to Done by You", "You")).toEqual([
      { text: "Status changed to Done by ", bold: false },
      { text: "You", bold: true },
    ]);
  });

  it("leaves bodies without the by-author suffix untouched", () => {
    expect(splitSystemBody("Task attached to thread", "You")).toEqual([
      { text: "Task attached to thread", bold: false },
    ]);
  });

  it("does not bold when the author only appears mid-sentence", () => {
    expect(splitSystemBody("You changed the status", "You")).toEqual([
      { text: "You changed the status", bold: false },
    ]);
  });
});

describe("formatFileSize", () => {
  it("scales bytes to KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(204 * 1024)).toBe("204 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
