// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useCommandSuggestions } from "./useCommandSuggestions";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    projects: {
      commands: vi.fn(),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useProjectDetailRealtimeSubscription: vi.fn(),
}));

const BASE_ARGS = {
  projectId: "project-1",
  providerId: "codex",
  commandScope: "thread" as const,
  skillsTriggers: ["/"] as const,
  activeTrigger: null,
  environmentId: "env-1",
  query: null,
};

beforeEach(() => {
  vi.mocked(sdk.projects.commands).mockResolvedValue({ commands: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useCommandSuggestions catalog prefetch", () => {
  it("warms the command catalog when the composer gains focus", async () => {
    const { wrapper } = createQueryClientTestHarness();

    const { result, rerender } = renderHook(
      (props: { composerFocused: boolean }) =>
        useCommandSuggestions({ ...BASE_ARGS, ...props }),
      { wrapper, initialProps: { composerFocused: false } },
    );
    expect(sdk.projects.commands).not.toHaveBeenCalled();

    rerender({ composerFocused: true });
    await waitFor(() => {
      expect(sdk.projects.commands).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(sdk.projects.commands).mock.calls[0]?.[0]).toEqual({
      projectId: "project-1",
      provider: "codex",
      environmentId: "env-1",
      signal: expect.any(AbortSignal),
    });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("skips the prefetch for a composer left before the delay", async () => {
    const { wrapper } = createQueryClientTestHarness();

    const { rerender } = renderHook(
      (props: { environmentId: string }) =>
        useCommandSuggestions({
          ...BASE_ARGS,
          ...props,
          composerFocused: true,
        }),
      { wrapper, initialProps: { environmentId: "env-1" } },
    );
    rerender({ environmentId: "env-2" });

    await waitFor(() => {
      expect(sdk.projects.commands).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(sdk.projects.commands).mock.calls[0]?.[0]).toMatchObject({
      environmentId: "env-2",
    });
  });

  it("still fetches on the first trigger without any focus signal", async () => {
    const { wrapper } = createQueryClientTestHarness();

    renderHook(
      () =>
        useCommandSuggestions({
          ...BASE_ARGS,
          activeTrigger: "/",
          query: "",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(sdk.projects.commands).toHaveBeenCalledTimes(1);
    });
  });

  it("offers only skills for the explicit dollar trigger", async () => {
    vi.mocked(sdk.projects.commands).mockResolvedValue({
      commands: [
        {
          name: "writing-for-agents",
          source: "skill",
          origin: "user",
          description: "Write agent instructions",
          argumentHint: null,
        },
        {
          name: "plan",
          source: "command",
          origin: "builtin",
          description: "Plan work",
          argumentHint: null,
        },
      ],
    });
    const { wrapper } = createQueryClientTestHarness();

    const { result } = renderHook(
      () =>
        useCommandSuggestions({
          ...BASE_ARGS,
          activeTrigger: "$",
          skillsTriggers: ["/", "$"] as const,
          query: "",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(
        result.current.suggestions.map((suggestion) => suggestion.name),
      ).toEqual(["writing-for-agents"]);
    });
  });
});
