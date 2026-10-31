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
    registerRequest: args.registerRequest,
  });
}

describe("InteractiveRequestRegistry", () => {
  it.each(["response", "failure"] as const)(
    "reconciles an in-flight registration without a late %s affecting its replacement",
    async (completion) => {
      const request = createCommandApprovalRequest();
      const initial =
        createDeferredPromise<HostDaemonInteractiveRequestResponse>();
      let registrations = 0;
      const registry = createRegistry({
        registerRequest: async () => {
          registrations += 1;
          if (registrations === 1) return initial.promise;
          if (registrations === 2)
            return { outcome: "rejected", reason: "Already ended" };
          return {
            outcome: "created",
            interactionId: "pint_registry",
            status: "pending",
          };
        },
      });
      const pending = registry.registerAndWait(request);
      const rejected = expect(pending).rejects.toThrow("Already ended");
      await registry.reconcilePendingRequests();
      await rejected;
      const replacement = registry.registerAndWait(request);
      if (completion === "failure")
        initial.reject(new Error("Late network failure"));
      else
        initial.resolve({
          outcome: "created",
          interactionId: "old_interaction",
          status: "pending",
        });
      await new Promise<void>((resolve) => setImmediate(resolve));
      const resolution = createCommandApprovalResolution();
      registry.resolve({
        ...request,
        interactionId: "pint_registry",
        resolution,
      });
      await expect(replacement).resolves.toEqual(resolution);
    },
  );

  it.each(["pending", "resolving"] as const)(
    "keeps a %s request deliverable after reconciliation",
    async (status) => {
      const request = createCommandApprovalRequest();
      let registrations = 0;
      const registry = createRegistry({
        registerRequest: async () => ({
          outcome: registrations++ === 0 ? "created" : "existing",
          interactionId: "pint_registry",
          status,
        }),
      });
      const pending = registry.registerAndWait(request);
      await registry.reconcilePendingRequests();
      const resolution = createCommandApprovalResolution();
      registry.resolve({
        ...request,
        interactionId: "pint_registry",
        resolution,
      });
      await expect(pending).resolves.toEqual(resolution);
      expect(registrations).toBe(2);
    },
  );

  it("keeps a provider wait deliverable after a transient reconciliation failure", async () => {
    const request = createCommandApprovalRequest();
    let registrations = 0;
    const registry = createRegistry({
      registerRequest: async () => {
        if (registrations++ > 0) {
          throw new Error("Temporary connection failure");
        }
        return {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        };
      },
    });
    const pending = registry.registerAndWait(request);
    await expect(registry.reconcilePendingRequests()).rejects.toThrow(
      "Temporary connection failure",
    );
    const resolution = createCommandApprovalResolution();
    registry.resolve({
      ...request,
      interactionId: "pint_registry",
      resolution,
    });
    await expect(pending).resolves.toEqual(resolution);
  });

  it("does not let a late reconciliation reject a replacement wait", async () => {
    const request = createCommandApprovalRequest();
    const recheck =
      createDeferredPromise<HostDaemonInteractiveRequestResponse>();
    let registrations = 0;
    const registry = createRegistry({
      registerRequest: async () => {
        if (++registrations === 2) return recheck.promise;
        return {
          outcome: "created",
          interactionId: "pint_registry",
          status: "pending",
        };
      },
    });
    const first = registry.registerAndWait(request);
    const firstRejection = expect(first).rejects.toThrow("Provider exited");
    const reconciliation = registry.reconcilePendingRequests();
    registry.interruptThreads({
      providerId: request.providerId,
      threadIds: [request.threadId],
      reason: "Provider exited",
    });
    await firstRejection;
    const replacement = registry.registerAndWait(request);
    recheck.resolve({ outcome: "rejected", reason: "Old request ended" });
    await reconciliation;
    const resolution = createCommandApprovalResolution();
    registry.resolve({
      ...request,
      interactionId: "pint_registry",
      resolution,
    });
    await expect(replacement).resolves.toEqual(resolution);
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
});
