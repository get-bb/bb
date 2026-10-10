import { MutationObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { HttpError } from "@/lib/api";
import { createAppQueryClient } from "@/lib/query-client";
import { sdk } from "@/lib/sdk";
import type { PendingInteraction } from "@bb/domain";
import { threadPendingInteractionsQueryKey } from "../queries/query-keys";
import {
  resolveThreadPendingInteractionMutationOptions,
  visibleResolveInteractionError,
} from "./thread-interaction-mutations";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: { interactions: { resolve: vi.fn() } },
  },
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
  vi.clearAllMocks();
});

describe("useResolveThreadPendingInteraction", () => {
  it("drops a host-offline answer error once the thread's host reconnects", () => {
    const offlineHost = makeHost({ id: "host_1", status: "disconnected" });

    expect(
      visibleResolveInteractionError({
        error: hostOfflineError,
        hostId: "host_1",
        hosts: [offlineHost],
      }),
    ).toBe(hostOfflineError);
    expect(
      visibleResolveInteractionError({
        error: hostOfflineError,
        hostId: "host_1",
        hosts: [{ ...offlineHost, status: "connected" }],
      }),
    ).toBeNull();
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
    const queryClient = createAppQueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: Infinity, retry: false },
      },
      showMutationErrorToasts: false,
    });
    queryClient.setQueryData(threadPendingInteractionsQueryKey("thr_1"), [
      approval,
      other,
    ]);
    const mutation = new MutationObserver(
      queryClient,
      resolveThreadPendingInteractionMutationOptions(queryClient),
    );
    const resolve = (status: PendingInteraction["status"]) => {
      vi.mocked(sdk.threads.interactions.resolve).mockResolvedValueOnce({
        ...approval,
        status,
        resolution,
      });
      return mutation.mutate({
        threadId: "thr_1",
        interactionId: "pint_plan",
        resolution,
      });
    };

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
