import { describe, expect, it } from "vitest";
import type { DisplayComment } from "../../shared/contract.js";
import {
  commentActorDisplayName,
  commentByline,
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

describe("commentActorDisplayName and commentByline", () => {
  const base: DisplayComment = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZC1",
    taskId: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    kind: "agent",
    authorName: "agent (thr_worker)",
    presetName: null,
    threadId: "thr_worker",
    threadTitle: "Fix the login bug",
    provider: { id: "codex", name: "Codex", logoUrl: null },
    body: "Done",
    notifiedCount: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
    actor: {
      principalId: "system:legacy",
      principalKind: "system",
      displayName: "System (legacy)",
    },
  };

  it("links an agent comment to its thread by the resolved human title", () => {
    expect(commentByline(base)).toEqual({
      kind: "thread-link",
      threadId: "thr_worker",
      title: "Fix the login bug",
    });
  });

  it("uses modern human actor display for user bylines", () => {
    const comment: DisplayComment = {
      ...base,
      kind: "user",
      authorName: "legacy-author",
      threadId: null,
      threadTitle: null,
      provider: null,
      actor: {
        principalId: "user_alice",
        principalKind: "human",
        displayName: "Alice",
      },
    };
    expect(commentActorDisplayName(comment)).toBe("Alice");
    expect(commentByline(comment)).toEqual({ kind: "text", name: "Alice" });
  });

  it("uses modern system actor display for system events", () => {
    const comment: DisplayComment = {
      ...base,
      kind: "system",
      authorName: "Tasks",
      threadId: null,
      threadTitle: null,
      provider: null,
      actor: {
        principalId: "user_alice",
        principalKind: "human",
        displayName: "Alice",
      },
    };
    expect(commentActorDisplayName(comment)).toBe("Alice");
    expect(
      splitSystemBody(
        "Status changed to Done by Alice",
        commentActorDisplayName(comment),
      ),
    ).toEqual([
      { text: "Status changed to Done by ", bold: false },
      { text: "Alice", bold: true },
    ]);
  });

  it("falls back to authorName for explicit system:legacy actors", () => {
    const comment: DisplayComment = {
      ...base,
      kind: "user",
      authorName: "Stored legacy name",
      threadId: null,
      threadTitle: null,
      provider: null,
    };
    expect(commentActorDisplayName(comment)).toBe("Stored legacy name");
    expect(commentByline(comment)).toEqual({
      kind: "text",
      name: "Stored legacy name",
    });
  });

  it("does not treat a colliding system:legacy id as a legacy actor", () => {
    const comment: DisplayComment = {
      ...base,
      kind: "user",
      authorName: "must-not-win",
      threadId: null,
      threadTitle: null,
      provider: null,
      actor: {
        principalId: "system:legacy",
        principalKind: "human",
        displayName: "Authenticated Legacy-Named Human",
      },
    };
    expect(commentActorDisplayName(comment)).toBe(
      "Authenticated Legacy-Named Human",
    );
  });

  it("labels unresolved modern agents so they cannot look like humans", () => {
    const comment: DisplayComment = {
      ...base,
      threadTitle: null,
      authorName: "should-not-win",
      actor: {
        principalId: "agent:thread/thr_worker",
        principalKind: "agent",
        displayName: "Thread agent",
      },
    };
    expect(commentActorDisplayName(comment)).toBe("Agent · Thread agent");
    expect(commentByline(comment)).toEqual({
      kind: "text",
      name: "Agent · Thread agent",
    });
  });

  it("falls back to authorName for unresolved legacy agents", () => {
    expect(commentByline({ ...base, threadTitle: null })).toEqual({
      kind: "text",
      name: "agent (thr_worker)",
    });
  });

  it("falls back to the author name for legacy agent comments with no thread", () => {
    expect(
      commentByline({ ...base, threadId: null, threadTitle: null }),
    ).toEqual({ kind: "text", name: "agent (thr_worker)" });
  });

  it("never links user comments even if a thread id is present", () => {
    expect(
      commentByline({
        ...base,
        kind: "user",
        authorName: "You",
        threadTitle: "Should be ignored",
        actor: {
          principalId: "local-owner",
          principalKind: "human",
          displayName: "Local Owner",
        },
      }),
    ).toEqual({ kind: "text", name: "Local Owner" });
  });
});

describe("formatFileSize", () => {
  it("scales bytes to KB and MB", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(204 * 1024)).toBe("204 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
