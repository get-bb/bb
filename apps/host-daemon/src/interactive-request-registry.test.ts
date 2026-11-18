import { describe, expect, it, vi } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@bb/domain";
import type { HostDaemonInteractiveRequestResponse } from "@bb/host-daemon-contract";
import { createDeferredPromise } from "@bb/test-helpers";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
} from "./interactive-request-registry.js";

interface CreateRegistryArgs {
  onRequestWithdrawn?: (request: PendingInteractionCreate) => void;
  registerRequest: (
    request: PendingInteractionCreate,
  ) => Promise<HostDaemonInteractiveRequestResponse>;
}

interface CreateCommandApprovalRequestArgs {
  providerRequestId?: string;
}

function createCommandApprovalRequest(
  args: CreateCommandApprovalRequestArgs = {},
): PendingInteractionCreate {
  return {
    threadId: "thr_registry",
    turnId: "turn_registry",
    providerId: "codex",
    providerThreadId: "provider-thread-registry",
    providerRequestId: args.providerRequestId ?? "request-registry",
    payload: {
      kind: "approval",
      subject: {
        kind: "command",
        itemId: "item-registry",
        command: "git push",
        cwd: "/tmp/project",
        actions: [],
        sessionGrant: null,
      },
      reason: "Needs approval",
      availableDecisions: ["allow_once", "deny"],
    },
  };
}

function createCommandApprovalResolution(): PendingInteractionResolution {
  return {
    decision: "allow_once",
    grantedPermissions: null,
  };
}

function createRegistry(args: CreateRegistryArgs): InteractiveRequestRegistry {
  return new InteractiveRequestRegistry({
    onRequestWithdrawn: args.onRequestWithdrawn ?? (() => {}),
    registerRequest: args.registerRequest,
  });
}

describe("InteractiveRequestRegistry", () => {
  it("ends a wait whose registration is still in flight without an unhandled rejection", async () => {
    const request = createCommandApprovalRequest();
    const registration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const registry = createRegistry({
      registerRequest: () => registration.promise,
    });
    const pending = registry.registerAndWait(
      request,
      new AbortController().signal,
    );

    registry.endRequests(
      [
        {
          threadId: request.threadId,
          providerId: request.providerId,
          providerThreadId: request.providerThreadId,
          providerRequestId: request.providerRequestId,
        },
      ],
      "closed on the server",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    registration.resolve({
      outcome: "created",
      interactionId: "pint_in_flight",
      status: "pending",
    });

    await expect(pending).rejects.toMatchObject({
      code: "interactive_request_ended",
    });
    expect(registry.listOpenRequests()).toEqual([]);
  });

  it("reports open waits and ends the ones the server closed", async () => {
    const request = createCommandApprovalRequest();
    const other = createCommandApprovalRequest({
      providerRequestId: "request-still-open",
    });
    const registry = createRegistry({
      registerRequest: async (registered) => ({
        outcome: "created",
        interactionId: `pint_${registered.providerRequestId}`,
        status: "pending",
      }),
    });
    const ended = registry.registerAndWait(
      request,
      new AbortController().signal,
    );
    const stillOpen = registry.registerAndWait(
      other,
      new AbortController().signal,
    );
    const key = {
      threadId: request.threadId,
      providerId: request.providerId,
      providerThreadId: request.providerThreadId,
      providerRequestId: request.providerRequestId,
    };
    await Promise.resolve();

    expect(registry.listOpenRequests()).toEqual([
      key,
      { ...key, providerRequestId: "request-still-open" },
    ]);

    registry.endRequests([key], "closed on the server");

    await expect(ended).rejects.toMatchObject({
      code: "interactive_request_ended",
      message: "closed on the server",
    });
    expect(registry.listOpenRequests()).toEqual([
      { ...key, providerRequestId: "request-still-open" },
    ]);
    registry.resolve({
      ...key,
      providerRequestId: "request-still-open",
      interactionId: "pint_request-still-open",
      resolution: createCommandApprovalResolution(),
    });
    await expect(stillOpen).resolves.toEqual(createCommandApprovalResolution());
  });

  it("deduplicates registration retries for the same live provider request", async () => {
    const request = createCommandApprovalRequest();
    const registration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const registrations: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async (registeredRequest) => {
        registrations.push(registeredRequest);
        return registration.promise;
      },
    });

    const first = registry.registerAndWait(
      request,
      new AbortController().signal,
    );
    const second = registry.registerAndWait(
      request,
      new AbortController().signal,
    );

    expect(registrations).toEqual([request]);
    registration.resolve({
      outcome: "created",
      interactionId: "pint_registry",
      status: "pending",
    });

    const resolution = createCommandApprovalResolution();
    registry.resolve({
      interactionId: "pint_registry",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    });

    await expect(first).resolves.toEqual(resolution);
    await expect(second).resolves.toEqual(resolution);
  });

  it("ignores duplicate delivery after a command acknowledgement is retried", async () => {
    const request = createCommandApprovalRequest();
    const resolution = createCommandApprovalResolution();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    const pending = registry.registerAndWait(
      request,
      new AbortController().signal,
    );
    const command = {
      interactionId: "pint_registry",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    };
    registry.resolve(command);
    registry.resolve(command);

    await expect(pending).resolves.toEqual(resolution);
  });

  it("rejects stale resolve commands that have no live provider request", () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    expect(() =>
      registry.resolve({
        interactionId: "pint_registry",
        providerId: request.providerId,
        providerRequestId: request.providerRequestId,
        providerThreadId: request.providerThreadId,
        resolution: createCommandApprovalResolution(),
        threadId: request.threadId,
      }),
    ).toThrowError(InteractiveRequestRegistryError);
  });

  it("rejects provider waits when server registration is rejected", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "rejected",
        reason: "Thread is already awaiting user interaction",
      }),
    });

    await expect(
      registry.registerAndWait(request, new AbortController().signal),
    ).rejects.toMatchObject({
      code: "interactive_request_rejected",
      message: "Thread is already awaiting user interaction",
      name: "InteractiveRequestRegistryError",
    });
  });

  it("rejects provider waits when the provider exits", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
    });

    const pending = registry.registerAndWait(
      request,
      new AbortController().signal,
    );
    registry.interruptThreads({
      providerId: request.providerId,
      reason: "Provider exited",
      threadIds: [request.threadId],
    });

    await expect(pending).rejects.toThrow("Provider exited");
  });

  it("closes a request the provider withdraws only after the server registered it", async () => {
    const request = createCommandApprovalRequest();
    const registration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const withdrawn: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      onRequestWithdrawn: (closed) => withdrawn.push(closed),
      registerRequest: () => registration.promise,
    });
    const provider = new AbortController();
    const pending = registry.registerAndWait(request, provider.signal);

    provider.abort();
    await expect(pending).rejects.toMatchObject({
      code: "interactive_request_withdrawn",
    });
    expect(registry.listOpenRequests()).toEqual([]);
    expect(withdrawn).toEqual([]);

    registration.resolve({
      outcome: "created",
      interactionId: "pint_withdrawn",
      status: "pending",
    });
    await vi.waitFor(() => expect(withdrawn).toEqual([request]));
    expect(() =>
      registry.resolve({
        interactionId: "pint_withdrawn",
        providerId: request.providerId,
        providerRequestId: request.providerRequestId,
        providerThreadId: request.providerThreadId,
        resolution: createCommandApprovalResolution(),
        threadId: request.threadId,
      }),
    ).toThrowError(InteractiveRequestRegistryError);
  });

  it("does not report a withdrawal for a request the server never registered", async () => {
    const request = createCommandApprovalRequest();
    const withdrawn: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      onRequestWithdrawn: (closed) => withdrawn.push(closed),
      registerRequest: async () => ({
        outcome: "rejected",
        reason: "Thread is already awaiting user interaction",
      }),
    });
    const provider = new AbortController();
    const pending = registry.registerAndWait(request, provider.signal);
    provider.abort();

    await expect(pending).rejects.toMatchObject({
      code: "interactive_request_withdrawn",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(withdrawn).toEqual([]);
  });

  it("ignores a withdrawal after the answer reached the provider", async () => {
    const request = createCommandApprovalRequest();
    const withdrawn: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      onRequestWithdrawn: (closed) => withdrawn.push(closed),
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_answered",
        status: "pending",
      }),
    });
    const provider = new AbortController();
    const pending = registry.registerAndWait(request, provider.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    registry.resolve({
      interactionId: "pint_answered",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution: createCommandApprovalResolution(),
      threadId: request.threadId,
    });
    provider.abort();

    await expect(pending).resolves.toEqual(createCommandApprovalResolution());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(withdrawn).toEqual([]);
  });
});
