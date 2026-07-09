// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadReadTracking } from "./useThreadReadTracking";

type MarkThreadReadMutation = Parameters<
  typeof useThreadReadTracking
>[0]["markThreadRead"];
type MutateOptions = Parameters<MarkThreadReadMutation["mutate"]>[1];
type TestThread = {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
};

function makeMarkThreadRead() {
  return {
    mutate: vi.fn<MarkThreadReadMutation["mutate"]>(),
  } satisfies MarkThreadReadMutation;
}

describe("useThreadReadTracking", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not mark read without a visible thread", () => {
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: undefined,
      }),
    );

    expect(markThreadRead.mutate).not.toHaveBeenCalled();
  });

  it("marks an unread thread once per attention timestamp", () => {
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(
      ({ latestAttentionAt }: { latestAttentionAt: number }) =>
        useThreadReadTracking({
          markThreadRead,
          thread: {
            id: "thr_side_chat",
            lastReadAt: 10,
            latestAttentionAt,
          },
        }),
      { initialProps: { latestAttentionAt: 20 } },
    );

    expect(markThreadRead.mutate).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutate).toHaveBeenLastCalledWith(
      "thr_side_chat",
      expect.objectContaining({ onError: expect.any(Function) }),
    );

    rerender({ latestAttentionAt: 20 });
    expect(markThreadRead.mutate).toHaveBeenCalledTimes(1);

    rerender({ latestAttentionAt: 30 });
    expect(markThreadRead.mutate).toHaveBeenCalledTimes(2);
  });

  it("allows retrying a failed read marker", () => {
    const markThreadRead = makeMarkThreadRead();
    const { rerender } = renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: {
          id: "thr_side_chat",
          lastReadAt: 10,
          latestAttentionAt: 20,
        },
      }),
    );
    const options: MutateOptions | undefined =
      markThreadRead.mutate.mock.calls[0]?.[1];

    options?.onError?.();
    rerender();

    expect(markThreadRead.mutate).toHaveBeenCalledTimes(2);
  });

  it("does not immediately undo marking the visible thread unread", () => {
    const markThreadRead = makeMarkThreadRead();
    type VisibleThreadProps = { lastReadAt: number | null };
    const initialProps: VisibleThreadProps = { lastReadAt: 20 };
    const { rerender } = renderHook(
      ({ lastReadAt }: VisibleThreadProps) =>
        useThreadReadTracking({
          markThreadRead,
          thread: {
            id: "thr_side_chat",
            lastReadAt,
            latestAttentionAt: 20,
          },
        }),
      { initialProps },
    );

    expect(markThreadRead.mutate).not.toHaveBeenCalled();

    rerender({ lastReadAt: null });

    expect(markThreadRead.mutate).not.toHaveBeenCalled();
  });

  it("marks a manually unread thread read when it is opened again", () => {
    const markThreadRead = makeMarkThreadRead();
    const unreadThread: TestThread = {
      id: "thr_side_chat",
      lastReadAt: null,
      latestAttentionAt: 20,
    };
    type ThreadProps = { thread: TestThread | undefined };
    const initialProps: ThreadProps = { thread: undefined };
    const { rerender } = renderHook(
      ({ thread }: ThreadProps) =>
        useThreadReadTracking({
          markThreadRead,
          thread,
        }),
      { initialProps },
    );

    rerender({ thread: unreadThread });

    expect(markThreadRead.mutate).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutate).toHaveBeenLastCalledWith(
      "thr_side_chat",
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("marks a previously auto-read thread read when reopened after manual unread", () => {
    const markThreadRead = makeMarkThreadRead();
    type ReopenThreadProps = {
      lastReadAt: number | null;
      visible: boolean;
    };
    const initialProps: ReopenThreadProps = {
      lastReadAt: 10,
      visible: true,
    };
    const { rerender } = renderHook(
      ({ lastReadAt, visible }: ReopenThreadProps) =>
        useThreadReadTracking({
          markThreadRead,
          thread: visible
            ? {
                id: "thr_side_chat",
                lastReadAt,
                latestAttentionAt: 20,
              }
            : undefined,
        }),
      { initialProps },
    );

    expect(markThreadRead.mutate).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: 20, visible: true });
    rerender({ lastReadAt: null, visible: true });
    expect(markThreadRead.mutate).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: null, visible: false });
    rerender({ lastReadAt: null, visible: true });

    expect(markThreadRead.mutate).toHaveBeenCalledTimes(2);
  });
});
