// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRefetchAfterFirstLoad } from "./useRefetchAfterFirstLoad";

describe("useRefetchAfterFirstLoad", () => {
  it("holds a refresh asked for before the first list arrives and ignores that list for sign-in outcomes", () => {
    const refetch = vi.fn();
    const { result, rerender } = renderHook(
      (props: { loaded: boolean; settledAt: number }) =>
        useRefetchAfterFirstLoad({ ...props, refetch }),
      { initialProps: { loaded: false, settledAt: 0 } },
    );

    act(() => result.current.refetch({ cancelRefetch: true }));
    expect(refetch).not.toHaveBeenCalled();

    const firstListAt = Date.now();
    rerender({ loaded: true, settledAt: firstListAt });
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: true });
    expect(result.current.settledAt).toBe(0);

    rerender({ loaded: true, settledAt: firstListAt + 1_000 });
    expect(result.current.settledAt).toBe(firstListAt + 1_000);
  });

  it("refreshes right away once the first list has arrived", () => {
    const refetch = vi.fn();
    const { result } = renderHook(() =>
      useRefetchAfterFirstLoad({ loaded: true, settledAt: 5, refetch }),
    );

    act(() => result.current.refetch({ cancelRefetch: false }));

    expect(refetch).toHaveBeenCalledExactlyOnceWith({ cancelRefetch: false });
    expect(result.current.settledAt).toBe(5);
  });
});
