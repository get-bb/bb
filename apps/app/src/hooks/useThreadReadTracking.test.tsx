// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadReadTracking } from "./useThreadReadTracking";

type MarkThreadReadMutation = Parameters<
  typeof useThreadReadTracking
>[0]["markThreadRead"];
type TestThread = {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
};

function makeMarkThreadRead() {
  return {
    mutateAsync: vi.fn<MarkThreadReadMutation["mutateAsync"]>(
      ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => reject(new Error("Aborted")),
            { once: true },
          );
        }),
    ),
  } satisfies MarkThreadReadMutation;
}

function setDocumentVisibilityState(
  visibilityState: DocumentVisibilityState,
): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
}

describe("useThreadReadTracking", () => {
  afterEach(() => {
    cleanup();
    setDocumentVisibilityState("visible");
  });

  it("does not mark read without a visible thread", () => {
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: undefined,
      }),
    );

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("marks an unread thread read after a mobile pageshow restore", () => {
    setDocumentVisibilityState("hidden");
    const markThreadRead = makeMarkThreadRead();

    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: {
          id: "thr_mobile_restore",
          lastReadAt: 10,
          latestAttentionAt: 20,
        },
      }),
    );

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      setDocumentVisibilityState("visible");
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_mobile_restore" }),
    );
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

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_side_chat" }),
    );

    rerender({ latestAttentionAt: 20 });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ latestAttentionAt: 30 });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("retries a failed read after pageshow while already visible", async () => {
    const markThreadRead = makeMarkThreadRead();
    markThreadRead.mutateAsync.mockRejectedValueOnce(new Error("Failed"));
    renderHook(() =>
      useThreadReadTracking({
        markThreadRead,
        thread: {
          id: "thr_side_chat",
          lastReadAt: 10,
          latestAttentionAt: 20,
        },
      }),
    );
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
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

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    rerender({ lastReadAt: null });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
  });

  it("does not undo marking the visible thread unread after tab refocus", () => {
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

    rerender({ lastReadAt: null });
    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();

    act(() => {
      setDocumentVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      setDocumentVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(markThreadRead.mutateAsync).not.toHaveBeenCalled();
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

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_side_chat" }),
    );
  });

  it("marks a previously auto-read thread read when reopened after manual unread", async () => {
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

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: 20, visible: true });
    rerender({ lastReadAt: null, visible: true });
    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(1);

    rerender({ lastReadAt: null, visible: false });
    await act(async () => {});
    rerender({ lastReadAt: null, visible: true });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending read when switching threads and retries when reopened", async () => {
    const markThreadRead = makeMarkThreadRead();
    type ThreadProps = { thread: TestThread };
    const { rerender } = renderHook(
      ({ thread }: ThreadProps) =>
        useThreadReadTracking({ markThreadRead, thread }),
      {
        initialProps: {
          thread: {
            id: "thr_first",
            lastReadAt: 10,
            latestAttentionAt: 20,
          },
        },
      },
    );

    const firstInput = markThreadRead.mutateAsync.mock.calls[0]?.[0];
    expect(firstInput?.signal?.aborted).toBe(false);

    rerender({
      thread: {
        id: "thr_second",
        lastReadAt: 20,
        latestAttentionAt: 20,
      },
    });

    expect(firstInput?.signal?.aborted).toBe(true);
    await act(async () => {});

    rerender({
      thread: {
        id: "thr_first",
        lastReadAt: 10,
        latestAttentionAt: 20,
      },
    });

    expect(markThreadRead.mutateAsync).toHaveBeenCalledTimes(2);
    expect(markThreadRead.mutateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thr_first" }),
    );
  });
});
