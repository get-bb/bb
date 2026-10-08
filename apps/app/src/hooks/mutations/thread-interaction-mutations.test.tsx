// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeEnvironment, makeHost } from "@bb/test-helpers/domain-fixtures";
import { HttpError } from "@/lib/api";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import type { PendingInteraction } from "@bb/domain";
import {
  hostsQueryKey,
  threadPendingInteractionsQueryKey,
} from "../queries/query-keys";
import { useResolveThreadPendingInteraction } from "./thread-interaction-mutations";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { get: vi.fn() },
    hosts: { list: vi.fn() },
    threads: { get: vi.fn(), interactions: { resolve: vi.fn() } },
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

  it("shows the server's resolving interaction before the pending list refetches", async () => {
    const approval: PendingInteraction = {
      id: "pint_plan",
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
    const other: PendingInteraction = { ...approval, id: "pint_other" };
    const resolution = {
      decision: "allow_once" as const,
      grantedPermissions: null,
    };
    vi.mocked(sdk.threads.get).mockReturnValue(new Promise(() => {}));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData(threadPendingInteractionsQueryKey("thr_1"), [
      approval,
      other,
    ]);
    const { result } = renderHook(
      () => useResolveThreadPendingInteraction("thr_1"),
      { wrapper },
    );
    const resolve = (status: PendingInteraction["status"]) =>
      act(async () => {
        vi.mocked(sdk.threads.interactions.resolve).mockResolvedValueOnce({
          ...approval,
          status,
          resolution,
        });
        await result.current.mutateAsync({
          threadId: "thr_1",
          interactionId: "pint_plan",
          resolution,
        });
      });

    await resolve("resolving");
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("thr_1")),
    ).toEqual([{ ...approval, status: "resolving", resolution }, other]);

    await resolve("resolved");
    expect(
      queryClient.getQueryData(threadPendingInteractionsQueryKey("thr_1")),
    ).toEqual([other]);
  });
});
