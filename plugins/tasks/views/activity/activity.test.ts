import { describe, expect, it } from "vitest";
import { formatRelativeTime as formatDetailTime } from "../detail/meta.js";
import type { DisplayComment } from "../../shared/contract.js";
import {
  commentByline,
  formatFileSize,
  formatRelativeTime,
  splitSystemBody,
} from "./time.js";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW - offsetMs).toISOString();

const agentComment: DisplayComment = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZC1",
  taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
  kind: "agent",
  authorName: "agent (thr_worker)",
  presetName: null,
  threadId: "thr_worker",
  threadTitle: "Fix the login bug",
  provider: null,
  body: "Done",
  notifiedCount: 0,
  createdAt: "2026-07-15T00:00:00.000Z",
};

describe("commentByline", () => {
  it.each<[string, Partial<DisplayComment>, ReturnType<typeof commentByline>]>([
    [
      "links an agent comment to its resolved thread",
      {},
      {
        kind: "thread-link",
        threadId: "thr_worker",
        title: "Fix the login bug",
      },
    ],
    [
      "falls back to the author name when the thread title is unresolved",
      { threadTitle: null },
      { kind: "text", name: "agent (thr_worker)" },
    ],
    [
      "never links a user comment even with a thread id and title",
      { kind: "user", authorName: "You", threadTitle: "Should be ignored" },
      { kind: "text", name: "You" },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(commentByline({ ...agentComment, ...overrides })).toEqual(expected);
  });
});

describe("formatRelativeTime", () => {
  it("covers the now/minutes/hours/days ladder", () => {
    expect(formatRelativeTime(at(20_000), NOW)).toBe("now");
    expect(formatRelativeTime(at(5 * 60_000), NOW)).toBe("5m");
    expect(formatRelativeTime(at(59 * 60_000), NOW)).toBe("59m");
    expect(formatRelativeTime(at(3 * 3_600_000), NOW)).toBe("3h");
    expect(formatRelativeTime(at(50 * 3_600_000), NOW)).toBe("2d");
  });

  it("clamps future timestamps (clock skew) to now", () => {
    expect(formatRelativeTime(at(-90_000), NOW)).toBe("now");
  });

  it.each([
    [59_999, "now"],
    [119_999, "1m"],
    [3_599_999, "59m"],
    [86_399_999, "23h"],
    [7 * 86_400_000, "1w"],
    [35 * 86_400_000 - 1, "4w"],
  ])("floors elapsed units at %i ms", (age, expected) => {
    expect(formatRelativeTime(at(age), NOW)).toBe(expected);
  });

  it.each([35, 400])("shows a date for a %i-day-old activity", (days) => {
    const now = Date.now();
    const iso = new Date(now - days * 86_400_000).toISOString();
    const expected = new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    expect.soft(formatDetailTime(iso)).toBe(expected);
    expect.soft(formatRelativeTime(iso, now)).toBe(expected);
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
