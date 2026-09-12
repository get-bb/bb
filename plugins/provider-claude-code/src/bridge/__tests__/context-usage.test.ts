import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClaudeContextUsageCollector,
  normalizeClaudeContextUsage,
} from "../context-usage.js";

const metadata = {
  capturedAt: "2026-09-11T12:00:00.000Z",
  providerSessionId: "session-1",
  providerTurnId: null,
};
const report = {
  totalTokens: 1_000,
  rawMaxTokens: 10_000,
  model: "claude-test",
  autoCompactThreshold: 9_000,
  isAutoCompactEnabled: true,
  categories: [
    { name: "Messages", tokens: 600 },
    { name: "Skills", tokens: 200 },
    { name: "Future category", tokens: 200 },
    { name: "System tools (deferred)", tokens: 4_000, isDeferred: true },
    { name: "Autocompact buffer", tokens: 1_000 },
    { name: "Free space", tokens: 8_000 },
  ],
  skills: {
    skillFrontmatter: [{ name: "review", source: "project", tokens: 100 }],
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("Claude context usage normalization", () => {
  it("preserves open categories, partial entries, and separate deferred/reserved accounting", () => {
    const snapshot = normalizeClaudeContextUsage(report, metadata);
    expect(snapshot).toMatchObject({
      ...metadata,
      usedTokens: 1_000,
      contextWindowTokens: 10_000,
      autoCompactAtTokens: 9_000,
      estimated: true,
    });
    expect(snapshot.categories.map(({ label, kind }) => [label, kind])).toEqual(
      [
        ["Messages", "used"],
        ["Skills", "used"],
        ["Future category", "used"],
        ["System tools (deferred)", "deferred"],
        ["Autocompact buffer", "reserved"],
        ["Free space", "free"],
      ],
    );
    expect(snapshot.categories[1].entries).toEqual([
      { id: '["review",0]', label: "review", tokens: 100 },
    ]);
    expect(snapshot.categories[2].entries).toEqual([]);
    expect(
      snapshot.categories.reduce(
        (sum, category) =>
          sum + (category.kind === "used" ? category.tokens : 0),
        0,
      ),
    ).toBe(snapshot.usedTokens);
  });

  it("does not pass inconsistent SDK message subcounts through as additive details", () => {
    const snapshot = normalizeClaudeContextUsage(
      {
        ...report,
        messageBreakdown: {
          toolCallTokens: 0,
          toolResultTokens: 0,
          attachmentTokens: 900,
          assistantMessageTokens: 7,
          userMessageTokens: 5,
          redirectedContextTokens: 0,
          unattributedTokens: 0,
        },
      },
      metadata,
    );
    expect(snapshot.categories[0].entries).toEqual([]);
  });

  it("separates loaded and deferred MCP tools and distinguishes duplicate entry names", () => {
    const snapshot = normalizeClaudeContextUsage(
      {
        ...report,
        categories: [
          { name: "MCP tools", tokens: 400 },
          { name: "MCP tools (deferred)", tokens: 500, isDeferred: true },
        ],
        mcpTools: [
          { name: "read", serverName: "files", tokens: 100 },
          { name: "read", serverName: "files", tokens: 200 },
          { name: "search", serverName: "files", tokens: 500, isLoaded: false },
        ],
      },
      metadata,
    );
    expect(
      snapshot.categories.map((category) =>
        category.entries.map((entry) => entry.tokens),
      ),
    ).toEqual([[100, 200], [500]]);
    expect(
      new Set(snapshot.categories[0].entries.map((entry) => entry.id)).size,
    ).toBe(2);
  });

  it("rejects invalid token counts and represents missing/disabled thresholds as null", () => {
    expect(() =>
      normalizeClaudeContextUsage({ ...report, totalTokens: -1 }, metadata),
    ).toThrow();
    expect(() =>
      normalizeClaudeContextUsage({ ...report, rawMaxTokens: 0 }, metadata),
    ).toThrow();
    expect(
      normalizeClaudeContextUsage(
        { ...report, isAutoCompactEnabled: false },
        metadata,
      ).autoCompactAtTokens,
    ).toBeNull();
    expect(
      normalizeClaudeContextUsage(
        { ...report, autoCompactThreshold: undefined },
        metadata,
      ).autoCompactAtTokens,
    ).toBeNull();
  });
});

describe("Claude context usage capture", () => {
  it("discards a delayed read after new input invalidates it", async () => {
    const collector = new ClaudeContextUsageCollector();
    const pending = deferred<unknown>();
    const publish = vi.fn();
    const capture = collector.capture({
      read: () => pending.promise,
      isCurrent: () => true,
      publish,
      providerSessionId: "session-1",
    });
    collector.invalidate();
    pending.resolve(report);
    await capture;
    expect(publish).not.toHaveBeenCalled();
  });

  it("only publishes the newest read for a resident session", async () => {
    const collector = new ClaudeContextUsageCollector();
    const pending = deferred<unknown>();
    const publish = vi.fn();
    const args = {
      isCurrent: () => true,
      publish,
      providerSessionId: "session-1",
    };
    const first = collector.capture({ ...args, read: () => pending.promise });
    await collector.capture({
      ...args,
      read: async () => ({ ...report, totalTokens: 1_100 }),
    });
    pending.resolve(report);
    await first;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].usedTokens).toBe(1_100);
    await collector.capture({
      ...args,
      isCurrent: () => false,
      read: async () => report,
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("settles on timeout and contains unsupported SDK methods or malformed reports", async () => {
    vi.useFakeTimers();
    const collector = new ClaudeContextUsageCollector();
    const pending = deferred<unknown>();
    const publish = vi.fn();
    const args = {
      isCurrent: () => true,
      publish,
      providerSessionId: "session-1",
    };
    const capture = collector.capture({ ...args, read: () => pending.promise });
    await vi.advanceTimersByTimeAsync(5_000);
    await capture;
    pending.resolve(report);
    await collector.capture({
      ...args,
      read: async () => {
        throw new Error("Unsupported request");
      },
    });
    await collector.capture({
      ...args,
      read: async () => ({ categories: [] }),
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
