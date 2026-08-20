import { describe, expect, it } from "vitest";
import {
  buildUnreadDividerPlacement,
  reduceUnreadDividerSnapshot,
  resolveUnreadDividerState,
  type UnreadDividerSnapshot,
} from "./unread-divider";

describe("unread divider policy", () => {
  it("places the divider before the first row for a never-read thread and after the cutoff otherwise", () => {
    expect(
      buildUnreadDividerPlacement({
        id: "t",
        lastReadAt: null,
        latestAttentionAt: 10,
      }),
    ).toEqual({ kind: "before-first" });
    expect(
      buildUnreadDividerPlacement({
        id: "t",
        lastReadAt: 5,
        latestAttentionAt: 10,
      }),
    ).toEqual({ kind: "after-cutoff", cutoffAt: 5 });
    expect(
      buildUnreadDividerPlacement({
        id: "t",
        lastReadAt: 10,
        latestAttentionAt: 10,
      }),
    ).toBeNull();
  });

  it("auto-scrolls only on the first snapshot of an unread thread and keeps the divider after the open marks it read", () => {
    const unread = { id: "t", lastReadAt: 5, latestAttentionAt: 10 };
    const first = reduceUnreadDividerSnapshot(null, unread);
    expect(first).toEqual<UnreadDividerSnapshot>({
      attentionAt: 10,
      autoScroll: true,
      placement: { kind: "after-cutoff", cutoffAt: 5 },
      threadId: "t",
    });
    expect(resolveUnreadDividerState(first, unread)).toEqual({
      autoScroll: true,
      placement: { kind: "after-cutoff", cutoffAt: 5 },
    });

    // Opening the thread marks it read (lastReadAt catches up, same
    // attention): the snapshot is held, so the divider stays under the reader.
    const read = { ...unread, lastReadAt: 10 };
    const held = reduceUnreadDividerSnapshot(first, read);
    expect(held).toBe(first);
    expect(resolveUnreadDividerState(held, read)).toEqual({
      autoScroll: true,
      placement: { kind: "after-cutoff", cutoffAt: 5 },
    });
  });

  it("re-snapshots without auto-scroll when new attention arrives while open", () => {
    const first = reduceUnreadDividerSnapshot(null, {
      id: "t",
      lastReadAt: 10,
      latestAttentionAt: 10,
    });
    expect(first.placement).toBeNull();
    const newAttention = { id: "t", lastReadAt: 10, latestAttentionAt: 20 };
    const next = reduceUnreadDividerSnapshot(first, newAttention);
    expect(next).toEqual<UnreadDividerSnapshot>({
      attentionAt: 20,
      autoScroll: false,
      placement: { kind: "after-cutoff", cutoffAt: 10 },
      threadId: "t",
    });
    // A live thread that has moved past the snapshot and is read again
    // shows nothing (the snapshot is stale).
    expect(
      resolveUnreadDividerState(first, { ...newAttention, lastReadAt: 20 }),
    ).toEqual({ autoScroll: false, placement: null });
  });

  it("moves the divider to the top on a manual mark-unread but keeps the scroll decision", () => {
    const read = { id: "t", lastReadAt: 10, latestAttentionAt: 10 };
    const first = reduceUnreadDividerSnapshot(null, read);
    const manual = reduceUnreadDividerSnapshot(first, {
      ...read,
      lastReadAt: null,
    });
    expect(manual.placement).toEqual({ kind: "before-first" });
    expect(manual.autoScroll).toBe(false);
  });

  it("is idempotent for an unchanged never-read thread (safe to reduce every render)", () => {
    const unread = { id: "t", lastReadAt: null, latestAttentionAt: 10 };
    const first = reduceUnreadDividerSnapshot(null, unread);
    expect(first.placement).toEqual({ kind: "before-first" });
    expect(first.autoScroll).toBe(true);
    const again = reduceUnreadDividerSnapshot(first, unread);
    expect(again).toBe(first);
  });

  it("starts over for another thread", () => {
    const first = reduceUnreadDividerSnapshot(null, {
      id: "a",
      lastReadAt: null,
      latestAttentionAt: 1,
    });
    const other = { id: "b", lastReadAt: null, latestAttentionAt: 1 };
    const next = reduceUnreadDividerSnapshot(first, other);
    expect(next.threadId).toBe("b");
    expect(next.autoScroll).toBe(true);
    expect(resolveUnreadDividerState(first, other).placement).toBeNull();
  });
});
