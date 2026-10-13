// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Thread } from "@bb/domain";
import {
  makeProviderInfo,
  makeThread as makeThreadFixture,
} from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_EXECUTION_OPTIONS_QUERY_KEY } from "@/hooks/queries/query-keys";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { useForkThreadFromMessage } from "./useForkThreadFromMessage";

const mocks = vi.hoisted(() => ({
  defaultExecutionOptions: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      defaultExecutionOptions: (...args: unknown[]) =>
        mocks.defaultExecutionOptions(...args),
      spawn: (...args: unknown[]) => mocks.spawn(...args),
    },
  },
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    environmentId: "env_source",
    id: "thr_source",
    projectId: "proj_source",
    ...overrides,
  });
}

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData([SYSTEM_EXECUTION_OPTIONS_QUERY_KEY], {
    providers: [makeProviderInfo({ id: "codex" })],
  });
  mocks.defaultExecutionOptions.mockResolvedValue({
    model: "gpt-5",
    permissionMode: "accept-edits",
    reasoningLevel: "high",
    serviceTier: "fast",
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("useForkThreadFromMessage", () => {
  it("creates an idle fork at the target sequence and opens it", async () => {
    mocks.spawn.mockResolvedValue(
      makeThreadResponse({
        id: "thr_fork",
        projectId: "proj_source",
        originKind: "fork",
        sourceThreadId: "thr_source",
      }),
    );
    const navigateInPane = vi.fn();
    const { result } = renderHook(
      () =>
        useForkThreadFromMessage({
          navigateInPane,
          sourceThread: makeThread({ sectionId: "sec_managers", pinnedAt: 1 }),
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current({ sourceSeqEnd: 12 });
    });

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn.mock.calls[0]?.[0]).toMatchObject({
      environment: { type: "reuse", environmentId: "env_source" },
      input: [],
      model: "gpt-5",
      origin: "app",
      originKind: "fork",
      permissionMode: "accept-edits",
      pinned: true,
      projectId: "proj_source",
      providerId: "codex",
      reasoningLevel: "high",
      sectionId: "sec_managers",
      serviceTier: "fast",
      sourceSeqEnd: 12,
      sourceThreadId: "thr_source",
      startedOnBehalfOf: null,
    });
    expect(navigateInPane).toHaveBeenCalledWith({
      projectId: "proj_source",
      threadId: "thr_fork",
    });
  });

  it("stays on the source thread when the fork is rejected", async () => {
    mocks.spawn.mockRejectedValue(new Error("fork_source_session_unavailable"));
    const navigateInPane = vi.fn();
    const { result } = renderHook(
      () =>
        useForkThreadFromMessage({
          navigateInPane,
          sourceThread: makeThread(),
        }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current({ sourceSeqEnd: 4 });
    });

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(navigateInPane).not.toHaveBeenCalled();
  });

  it("keeps one handler identity across thread refetches and forks the latest thread", async () => {
    mocks.spawn.mockResolvedValue(makeThreadResponse({ id: "thr_fork" }));
    const navigateInPane = vi.fn();
    const { result, rerender } = renderHook(
      ({ sourceThread }: { sourceThread: Thread | null }) =>
        useForkThreadFromMessage({ navigateInPane, sourceThread }),
      { initialProps: { sourceThread: makeThread() }, wrapper: Wrapper },
    );
    const first = result.current;

    rerender({ sourceThread: makeThread({ sectionId: "sec_moved" }) });
    expect(result.current).toBe(first);

    await act(async () => {
      await first({ sourceSeqEnd: 3 });
    });
    expect(mocks.spawn.mock.calls[0]?.[0]).toMatchObject({
      sectionId: "sec_moved",
    });
  });
});
