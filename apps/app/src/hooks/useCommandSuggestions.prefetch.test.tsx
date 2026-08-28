// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useCommandSuggestions } from "./useCommandSuggestions";

let commandsMock: ReturnType<typeof vi.spyOn>;

function mockPointer(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: coarse && query === POINTER_COARSE_QUERY,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const BASE_ARGS = {
  projectId: "project-1",
  providerId: "codex",
  commandScope: "thread" as const,
  skillsTrigger: "/" as const,
  environmentId: "env-1",
  query: null,
};

beforeEach(() => {
  commandsMock = vi
    .spyOn(sdk.projects, "commands")
    .mockResolvedValue({ commands: [] });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useCommandSuggestions catalog prefetch", () => {
  it("warms the command catalog when a coarse-pointer composer gains focus", async () => {
    mockPointer(true);
    const { wrapper } = createQueryClientTestHarness();

    const { result, rerender } = renderHook(
      (props: { composerFocused: boolean }) =>
        useCommandSuggestions({ ...BASE_ARGS, ...props }),
      { wrapper, initialProps: { composerFocused: false } },
    );
    expect(commandsMock).not.toHaveBeenCalled();

    rerender({ composerFocused: true });
    await waitFor(() => {
      expect(commandsMock).toHaveBeenCalledTimes(1);
    });
    expect(commandsMock.mock.calls[0]?.[0]).toEqual({
      projectId: "project-1",
      provider: "codex",
      environmentId: "env-1",
      signal: expect.any(AbortSignal),
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("does not add a request for fine-pointer composers, which autofocus on mount", () => {
    mockPointer(false);
    const { wrapper } = createQueryClientTestHarness();

    renderHook(
      () => useCommandSuggestions({ ...BASE_ARGS, composerFocused: true }),
      { wrapper },
    );

    expect(commandsMock).not.toHaveBeenCalled();
  });

  it("still fetches on the first trigger without any focus signal", async () => {
    mockPointer(true);
    const { wrapper } = createQueryClientTestHarness();

    renderHook(() => useCommandSuggestions({ ...BASE_ARGS, query: "" }), {
      wrapper,
    });

    await waitFor(() => {
      expect(commandsMock).toHaveBeenCalledTimes(1);
    });
  });
});
