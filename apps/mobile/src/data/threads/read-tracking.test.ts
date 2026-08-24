import { describe, expect, it, vi } from "vitest";
import {
  createThreadReadTracker,
  type ThreadReadTrackerCallbacks,
} from "./read-tracking";

function setup() {
  const calls: { threadId: string; callbacks: ThreadReadTrackerCallbacks }[] =
    [];
  const markRead = vi.fn(
    (threadId: string, callbacks: ThreadReadTrackerCallbacks) => {
      calls.push({ threadId, callbacks });
    },
  );
  const tracker = createThreadReadTracker();
  const update = (
    thread:
      | { id: string; lastReadAt: number | null; latestAttentionAt: number }
      | undefined,
    isVisible = true,
  ) => tracker.update({ thread, isVisible, markRead });
  return { calls, markRead, update };
}

describe("createThreadReadTracker", () => {
  it("marks an unread thread on open, once, and again only when new attention arrives", () => {
    const { calls, update } = setup();
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      true,
    );
    // Re-render with the same state while the receipt is in flight: no duplicate.
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      false,
    );
    calls[0].callbacks.onSettled();
    // Server confirmed: read now.
    expect(update({ id: "t", lastReadAt: 5, latestAttentionAt: 5 })).toBe(
      false,
    );
    // New attention while open and visible.
    expect(update({ id: "t", lastReadAt: 5, latestAttentionAt: 9 })).toBe(true);
    expect(calls.map((call) => call.threadId)).toEqual(["t", "t"]);
  });

  it("does not mark while hidden, then marks when the app comes back to the foreground", () => {
    const { calls, update } = setup();
    expect(
      update({ id: "t", lastReadAt: null, latestAttentionAt: 5 }, false),
    ).toBe(false);
    expect(calls).toHaveLength(0);
    expect(
      update({ id: "t", lastReadAt: null, latestAttentionAt: 5 }, true),
    ).toBe(true);
    calls[0].callbacks.onSettled();
    // Background → foreground with the thread still unread re-sends the receipt.
    update({ id: "t", lastReadAt: null, latestAttentionAt: 5 }, false);
    expect(
      update({ id: "t", lastReadAt: null, latestAttentionAt: 5 }, true),
    ).toBe(true);
  });

  it("does not undo a manual mark-unread while the thread stays open, but does on new attention or reopen", () => {
    const { calls, update } = setup();
    update({ id: "t", lastReadAt: 5, latestAttentionAt: 5 });
    // User marks it unread by hand: read → unread with the same attention.
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      false,
    );
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      false,
    );
    expect(calls).toHaveLength(0);
    // New attention lifts the suppression.
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 6 })).toBe(
      true,
    );
    calls[0].callbacks.onSettled();
    // Manual unread again, then switch away and back: reopen marks read.
    update({ id: "t", lastReadAt: 6, latestAttentionAt: 6 });
    update({ id: "t", lastReadAt: null, latestAttentionAt: 6 });
    update({ id: "other", lastReadAt: 1, latestAttentionAt: 1 });
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 6 })).toBe(
      true,
    );
  });

  it("retries a failed receipt on the next update but not while one is pending", () => {
    const { calls, update } = setup();
    update({ id: "t", lastReadAt: null, latestAttentionAt: 5 });
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      false,
    );
    calls[0].callbacks.onError();
    calls[0].callbacks.onSettled();
    expect(update({ id: "t", lastReadAt: null, latestAttentionAt: 5 })).toBe(
      true,
    );
    expect(calls).toHaveLength(2);
  });

  it("switching threads marks the newly opened one and forgets the old one's state", () => {
    const { calls, update } = setup();
    update({ id: "a", lastReadAt: null, latestAttentionAt: 1 });
    expect(update({ id: "b", lastReadAt: null, latestAttentionAt: 1 })).toBe(
      true,
    );
    expect(update(undefined)).toBe(false);
    expect(calls.map((call) => call.threadId)).toEqual(["a", "b"]);
  });
});
