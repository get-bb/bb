// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useThreadReadTracking } from "./useThreadReadTracking";

type MarkThreadReadMutation = Parameters<
  typeof useThreadReadTracking
>[0]["markThreadRead"];
type MutateOptions = Parameters<MarkThreadReadMutation["mutate"]>[1];

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
});
