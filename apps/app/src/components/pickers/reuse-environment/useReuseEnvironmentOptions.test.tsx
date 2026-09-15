// @vitest-environment jsdom

import { cleanup, renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReuseEnvironmentOptions } from "./useReuseEnvironmentOptions";

const state = vi.hoisted(() => ({
  data: undefined,
  isError: false,
  isPending: true,
  refetch: vi.fn(),
}));
const query = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/queries/project-queries", () => ({
  useProjectWorktrees: query,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.isError = false;
  state.isPending = true;
});

describe("useReuseEnvironmentOptions", () => {
  it("waits for navigation before discovering and keeps loading options accessible", () => {
    query.mockReturnValue(state);
    const { result, rerender } = renderHook(
      ({ settled }) =>
        useReuseEnvironmentOptions({
          projectId: "proj_test",
          threads: undefined,
          navigationSettled: settled,
          hosts: [],
        }),
      { initialProps: { settled: false } },
    );
    expect(query).toHaveBeenLastCalledWith("proj_test", { enabled: false });
    expect(result.current).toMatchObject({ loading: true, disabled: false });
    rerender({ settled: true });
    expect(query).toHaveBeenLastCalledWith("proj_test", { enabled: true });
    expect(result.current.loading).toBe(true);
    state.isPending = false;
    rerender({ settled: true });
    expect(result.current).toMatchObject({ loading: false, disabled: true });
  });

  it("keeps failed discovery accessible for retry instead of disabling an empty picker", () => {
    state.isPending = false;
    state.isError = true;
    query.mockReturnValue(state);
    const { result } = renderHook(() =>
      useReuseEnvironmentOptions({
        projectId: "proj_test",
        threads: [],
        navigationSettled: true,
        hosts: [],
      }),
    );
    expect(result.current).toMatchObject({
      loading: false,
      disabled: false,
      hasFailures: true,
    });
    expect(result.current.failures).toEqual([
      { hostId: "", hostName: null, message: "Worktree discovery failed" },
    ]);
    act(() => result.current.retry());
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
