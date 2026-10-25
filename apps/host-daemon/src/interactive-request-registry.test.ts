import { describe, expect, it } from "vitest";
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
  onRevalidationFailure?: (failure: {
    error: Error;
    request: PendingInteractionCreate;
  }) => void;
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
    ...(args.onRevalidationFailure
      ? { onRevalidationFailure: args.onRevalidationFailure }
      : {}),
    registerRequest: args.registerRequest,
  });
}

function createScriptedRegisterRequest(
  responses: Array<HostDaemonInteractiveRequestResponse | Error>,
): CreateRegistryArgs["registerRequest"] {
  let index = 0;
  return async () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!response) {
      throw new Error("Expected a scripted registration response");
    }
    if (response instanceof Error) {
      throw response;
    }
    return response;
  };
}

function createResolveCommand(
  request: PendingInteractionCreate,
  interactionId: string,
) {
  return {
    interactionId,
    providerId: request.providerId,
    providerRequestId: request.providerRequestId,
    providerThreadId: request.providerThreadId,
    resolution: createCommandApprovalResolution(),
    threadId: request.threadId,
  };
}

describe("InteractiveRequestRegistry", () => {
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

    const first = registry.registerAndWait(request);
    const second = registry.registerAndWait(request);

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

    const pending = registry.registerAndWait(request);
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

    await expect(registry.registerAndWait(request)).rejects.toMatchObject({
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

    const pending = registry.registerAndWait(request);
    registry.interruptThreads({
      providerId: request.providerId,
      reason: "Provider exited",
      threadIds: [request.threadId],
    });

    await expect(pending).rejects.toThrow("Provider exited");
  });

  it("rejects a provider wait the server settled while the daemon was away", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: createScriptedRegisterRequest([
        {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        },
        {
          outcome: "rejected",
          reason: `Provider request ${request.providerRequestId} was already handled and cannot be reused`,
        },
      ]),
    });

    const pending = registry.registerAndWait(request);
    await Promise.resolve();
    const rejection = expect(pending).rejects.toMatchObject({
      code: "interactive_request_rejected",
      message: `Provider request ${request.providerRequestId} was already handled and cannot be reused`,
    });
    await registry.revalidateRegisteredRequests();

    await rejection;
    expect(() =>
      registry.resolve(createResolveCommand(request, "pint_registry")),
    ).toThrowError(InteractiveRequestRegistryError);
  });

  it("keeps a provider wait the server still holds open after a reconnect", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: createScriptedRegisterRequest([
        {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        },
        {
          outcome: "existing",
          interactionId: "pint_registry",
          status: "pending",
        },
      ]),
    });

    const pending = registry.registerAndWait(request);
    await Promise.resolve();
    await registry.revalidateRegisteredRequests();
    registry.resolve(createResolveCommand(request, "pint_registry"));

    await expect(pending).resolves.toEqual(createCommandApprovalResolution());
  });

  it("keeps a provider wait when rechecking it with the server fails", async () => {
    const request = createCommandApprovalRequest();
    const failures: Array<{ error: Error; request: PendingInteractionCreate }> =
      [];
    const registry = createRegistry({
      onRevalidationFailure: (failure) => {
        failures.push(failure);
      },
      registerRequest: createScriptedRegisterRequest([
        {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        },
        new Error("Server unavailable"),
      ]),
    });

    const pending = registry.registerAndWait(request);
    await Promise.resolve();
    await registry.revalidateRegisteredRequests();
    registry.resolve(createResolveCommand(request, "pint_registry"));

    await expect(pending).resolves.toEqual(createCommandApprovalResolution());
    expect(failures).toEqual([
      { error: new Error("Server unavailable"), request },
    ]);
  });

  it("adopts the interaction a server recreates for a provider wait", async () => {
    const request = createCommandApprovalRequest();
    const registry = createRegistry({
      registerRequest: createScriptedRegisterRequest([
        {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        },
        {
          outcome: "created",
          interactionId: "pint_recreated",
          status: "pending",
        },
      ]),
    });

    const pending = registry.registerAndWait(request);
    await Promise.resolve();
    await registry.revalidateRegisteredRequests();

    expect(() =>
      registry.resolve(createResolveCommand(request, "pint_registry")),
    ).toThrowError(InteractiveRequestRegistryError);
    registry.resolve(createResolveCommand(request, "pint_recreated"));
    await expect(pending).resolves.toEqual(createCommandApprovalResolution());
  });

  it("rechecks a provider wait whose first registration was in flight during a reconnect", async () => {
    const request = createCommandApprovalRequest();
    const firstRegistration =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    const settledReason = `Provider request ${request.providerRequestId} was already handled and cannot be reused`;
    const registrations: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async (registeredRequest) => {
        registrations.push(registeredRequest);
        if (registrations.length === 1) {
          return firstRegistration.promise;
        }
        return { outcome: "rejected", reason: settledReason };
      },
    });

    const pending = registry.registerAndWait(request);
    await registry.revalidateRegisteredRequests();
    expect(registrations).toEqual([request]);

    const rejection = expect(pending).rejects.toMatchObject({
      code: "interactive_request_rejected",
      message: settledReason,
    });
    firstRegistration.resolve({
      outcome: "created",
      interactionId: "pint_registry",
      status: "pending",
    });

    await rejection;
    expect(registrations).toEqual([request, request]);
  });

  it("does not recheck a provider wait registered after the last reconnect", async () => {
    const request = createCommandApprovalRequest();
    const registrations: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async (registeredRequest) => {
        registrations.push(registeredRequest);
        return {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        };
      },
    });

    await registry.revalidateRegisteredRequests();
    const pending = registry.registerAndWait(request);
    await Promise.resolve();
    await Promise.resolve();
    registry.resolve(createResolveCommand(request, "pint_registry"));

    await expect(pending).resolves.toEqual(createCommandApprovalResolution());
    expect(registrations).toEqual([request]);
  });
});
