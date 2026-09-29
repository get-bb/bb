// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { PendingInteraction } from "@bb/domain";
import type { ThreadPendingInteractionsResponse } from "@bb/server-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import { makeEnvironment, makeHost } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/api";
import { BbHttpError, sdk } from "@/lib/sdk";
import { wsManager } from "@/lib/ws";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import {
  sidebarNavigationQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
  hostsQueryKey,
} from "../queries/query-keys";
import { useResolveThreadPendingInteraction } from "./thread-interaction-mutations";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      environments: { get: vi.fn() },
      hosts: { list: vi.fn() },
      threads: {
        get: vi.fn(),
        interactions: { resolve: vi.fn() },
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: {
    getConnectionState: vi.fn(() => "connected"),
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: vi.fn(),
  useHostListRealtimeSubscription: vi.fn(),
  useThreadDetailRealtimeSubscription: vi.fn(),
}));

const hostOfflineError = new HttpError({
  status: 502,
  code: "host_unavailable",
  message: "Host is not connected",
  body: {
    code: "host_unavailable",
    message: "Host is not connected",
    details: {
      destroyedAt: null,
      hostStatus: "disconnected",
      reason: "disconnected",
      suspendedAt: null,
    },
  },
});

const approval: PendingInteraction = {
  id: "pint_1",
  threadId: "thr_1",
  turnId: "turn_1",
  providerId: "claude-code",
  providerThreadId: "pt_1",
  providerRequestId: "req_1",
  status: "pending",
  statusReason: null,
  createdAt: 1,
  resolvedAt: null,
  resolution: null,
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ["allow_once", "deny"],
    subject: {
      kind: "plan",
      itemId: "plan-1",
      plan: "# Plan",
      planFilePath: null,
    },
  },
};

const allowOnce = { decision: "allow_once", grantedPermissions: null } as const;

function setup() {
  const harness = createQueryClientTestHarness();
  harness.queryClient.setQueryData<ThreadPendingInteractionsResponse>(
    threadPendingInteractionsQueryKey("thr_1"),
    [approval],
  );
  const hook = renderHook(() => useResolveThreadPendingInteraction("thr_1"), {
    wrapper: harness.wrapper,
  });
  return { ...harness, hook };
}

function cachedInteraction(
  queryClient: ReturnType<typeof setup>["queryClient"],
): PendingInteraction | undefined {
  return queryClient.getQueryData<ThreadPendingInteractionsResponse>(
    threadPendingInteractionsQueryKey("thr_1"),
  )?.[0];
}

beforeEach(() => {
  vi.mocked(wsManager.getConnectionState).mockReturnValue("connected");
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("useResolveThreadPendingInteraction", () => {
  it("drops a host-offline answer error once the thread's host reconnects", async () => {
    const thread = {
      ...makeThreadResponse(),
      id: "thr_1",
      environmentId: "env_1",
    };
    const offlineHost = makeHost({ id: "host_1", status: "disconnected" });
    vi.mocked(sdk.threads.get).mockResolvedValue(thread);
    vi.mocked(sdk.environments.get).mockResolvedValue(
      makeEnvironment({ id: "env_1", hostId: "host_1" }),
    );
    vi.mocked(sdk.hosts.list).mockResolvedValue([offlineHost]);
    vi.mocked(sdk.threads.interactions.resolve).mockRejectedValue(
      hostOfflineError,
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useResolveThreadPendingInteraction("thr_1"),
      { wrapper },
    );
    await waitFor(() => expect(sdk.hosts.list).toHaveBeenCalled());

    await act(async () => {
      await result.current
        .mutateAsync({
          threadId: "thr_1",
          interactionId: "pint_1",
          resolution: { kind: "user_answer", answers: {} },
        })
        .catch(() => {});
    });
    await waitFor(() => expect(result.current.error).toBe(hostOfflineError));

    act(() => {
      queryClient.setQueryData(hostsQueryKey(), [
        { ...offlineHost, status: "connected" },
      ]);
    });
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("shows the interaction as resolving with the chosen decision before the server answers", async () => {
    const response = createDeferredPromise<PendingInteraction>();
    vi.mocked(sdk.threads.interactions.resolve).mockReturnValue(
      response.promise,
    );
    const { hook, queryClient } = setup();

    act(() => {
      hook.result.current.mutate({
        threadId: "thr_1",
        interactionId: "pint_1",
        resolution: allowOnce,
      });
    });

    await waitFor(() => {
      expect(cachedInteraction(queryClient)).toMatchObject({
        status: "resolving",
        resolution: allowOnce,
      });
    });

    await act(async () => {
      response.resolve({
        ...approval,
        status: "resolved",
        resolution: allowOnce,
      });
      await response.promise;
    });
    await waitFor(() => {
      expect(cachedInteraction(queryClient)).toBeUndefined();
    });
  });

  it("restores the previous interaction when the request fails", async () => {
    vi.mocked(sdk.threads.interactions.resolve).mockRejectedValue(
      new Error("offline"),
    );
    const { hook, queryClient } = setup();

    await act(async () => {
      await hook.result.current
        .mutateAsync({
          threadId: "thr_1",
          interactionId: "pint_1",
          resolution: allowOnce,
        })
        .catch(() => {});
    });

    expect(cachedInteraction(queryClient)).toEqual(approval);
  });

  it("refetches the interactions after a conflict", async () => {
    vi.mocked(sdk.threads.interactions.resolve).mockRejectedValue(
      new BbHttpError({
        body: null,
        code: "conflict",
        message: "Interaction already resolved",
        status: 409,
      }),
    );
    const { hook, queryClient } = setup();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await hook.result.current
        .mutateAsync({
          threadId: "thr_1",
          interactionId: "pint_1",
          resolution: allowOnce,
        })
        .catch(() => {});
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      { queryKey: threadPendingInteractionsQueryKey("thr_1") },
      { cancelRefetch: false },
    );
  });

  it("leaves timeline, thread and list refreshes to realtime while connected", async () => {
    vi.mocked(sdk.threads.interactions.resolve).mockResolvedValue({
      ...approval,
      status: "resolving",
      resolution: allowOnce,
    });
    const { hook, queryClient } = setup();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await hook.result.current.mutateAsync({
        threadId: "thr_1",
        interactionId: "pint_1",
        resolution: allowOnce,
      });
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      ([filters]) => filters?.queryKey,
    );
    expect(invalidatedKeys).toEqual([
      threadPendingInteractionsQueryKey("thr_1"),
    ]);
    expect(invalidatedKeys).not.toContainEqual(threadTimelineQueryKey("thr_1"));
    expect(invalidatedKeys).not.toContainEqual(threadQueryKey("thr_1"));
    expect(invalidatedKeys).not.toContainEqual(sidebarNavigationQueryKey());
    expect(cachedInteraction(queryClient)).toMatchObject({
      status: "resolving",
    });
  });

  it("falls back to broad invalidation while realtime is disconnected", async () => {
    vi.mocked(wsManager.getConnectionState).mockReturnValue("reconnecting");
    vi.mocked(sdk.threads.interactions.resolve).mockResolvedValue({
      ...approval,
      status: "resolved",
      resolution: allowOnce,
    });
    const { hook, queryClient } = setup();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await hook.result.current.mutateAsync({
        threadId: "thr_1",
        interactionId: "pint_1",
        resolution: allowOnce,
      });
    });

    expect(
      invalidateSpy.mock.calls.map(([filters]) => filters?.queryKey),
    ).toContainEqual(threadQueryKey("thr_1"));
  });
});
