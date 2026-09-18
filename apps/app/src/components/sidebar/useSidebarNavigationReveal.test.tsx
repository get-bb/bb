// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSidebarNavigationReveal } from "./useSidebarNavigationReveal";

afterEach(cleanup);

function createWrapper() {
  const store = createStore();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/threads/first"]}>
          {children}
        </MemoryRouter>
      </Provider>
    );
  };
}

describe("useSidebarNavigationReveal", () => {
  it("preserves a manual collapse across data refreshes and sidebar remounts", () => {
    const wrapper = createWrapper();
    const initialReveal = vi.fn();
    const refreshedReveal = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ reveal }) => useSidebarNavigationReveal(true, reveal),
      { wrapper, initialProps: { reveal: initialReveal } },
    );
    expect(initialReveal).toHaveBeenCalledOnce();

    rerender({ reveal: refreshedReveal });
    expect(refreshedReveal).not.toHaveBeenCalled();

    unmount();
    renderHook(() => useSidebarNavigationReveal(true, refreshedReveal), {
      wrapper,
    });
    expect(refreshedReveal).not.toHaveBeenCalled();
  });

  it("reveals again on thread navigation, including history and the same destination", () => {
    const reveal = vi.fn();
    const { result } = renderHook(
      () => {
        useSidebarNavigationReveal(true, reveal);
        return useNavigate();
      },
      { wrapper: createWrapper() },
    );
    expect(reveal).toHaveBeenCalledTimes(1);

    act(() => result.current("/threads/second"));
    expect(reveal).toHaveBeenCalledTimes(2);

    act(() => result.current(-1));
    expect(reveal).toHaveBeenCalledTimes(3);

    act(() => result.current("/threads/first"));
    expect(reveal).toHaveBeenCalledTimes(4);
  });

  it("waits for preferences and thread data before consuming navigation", () => {
    const reveal = vi.fn();
    const { result, rerender } = renderHook(
      ({ ready }) => {
        useSidebarNavigationReveal(ready, reveal);
        return useNavigate();
      },
      { wrapper: createWrapper(), initialProps: { ready: false } },
    );
    act(() => result.current("/threads/second"));
    expect(reveal).not.toHaveBeenCalled();

    rerender({ ready: true });
    expect(reveal).toHaveBeenCalledOnce();

    rerender({ ready: false });
    rerender({ ready: true });
    expect(reveal).toHaveBeenCalledOnce();
  });
});
