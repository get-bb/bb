import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PendingInteractionCreate,
  PendingInteractionResolution,
} from "@bb/domain";
import type { HostDaemonInteractiveRequestResponse } from "@bb/host-daemon-contract";
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError,
  USER_QUESTION_DEADLINE_MS,
} from "./interactive-request-registry.js";

interface Deferred<TValue> {
  promise: Promise<TValue>;
  reject: (error: Error) => void;
  resolve: (value: TValue) => void;
}

interface CreateRegistryArgs {
  registerRequest: (
    request: PendingInteractionCreate,
  ) => Promise<HostDaemonInteractiveRequestResponse>;
  onTimeout?: (request: PendingInteractionCreate) => void;
}

interface CreateCommandApprovalRequestArgs {
  providerRequestId?: string;
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolveValue: (value: TValue) => void = () => {};
  let rejectValue: (error: Error) => void = () => {};
  const promise = new Promise<TValue>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return {
    promise,
    reject: rejectValue,
    resolve: resolveValue,
  };
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

function createUserQuestionRequest(): PendingInteractionCreate {
  return {
    threadId: "thr_registry_question",
    turnId: "turn_registry_question",
    providerId: "claude-code",
    providerThreadId: "provider-thread-registry-question",
    providerRequestId: "request-registry-question",
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "question-registry",
          prompt: "Should I proceed?",
          shortLabel: "Proceed?",
          multiSelect: false,
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
          allowFreeText: false,
        },
      ],
    },
  };
}

function createUserQuestionResolution(): PendingInteractionResolution {
  return {
    kind: "user_answer",
    answers: {
      "Should I proceed?": { selected: ["yes"] },
    },
  };
}

function createRegistry(args: CreateRegistryArgs): InteractiveRequestRegistry {
  return new InteractiveRequestRegistry({
    registerRequest: args.registerRequest,
    onTimeout: args.onTimeout,
  });
}

describe("InteractiveRequestRegistry", () => {
  it("registers a provider request and resolves it from an interactive.resolve command", async () => {
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
    registry.resolve({
      interactionId: "pint_registry",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    });

    await expect(pending).resolves.toEqual(resolution);
  });

  it("deduplicates registration retries for the same live provider request", async () => {
    const request = createCommandApprovalRequest();
    const registration = createDeferred<HostDaemonInteractiveRequestResponse>();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a user question no client answers within the deadline", async () => {
    vi.useFakeTimers();
    const request = createUserQuestionRequest();
    const timedOutRequests: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry_question",
        status: "pending",
      }),
      onTimeout: (timedOutRequest) => {
        timedOutRequests.push(timedOutRequest);
      },
    });

    const pending = registry.registerAndWait(request);
    vi.advanceTimersByTime(USER_QUESTION_DEADLINE_MS);

    await expect(pending).rejects.toMatchObject({
      code: "interactive_request_timeout",
      name: "InteractiveRequestRegistryError",
    });
    expect(timedOutRequests).toEqual([request]);
  });

  it("does not apply the deadline to approval requests", async () => {
    vi.useFakeTimers();
    const request = createCommandApprovalRequest();
    const timedOutRequests: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry",
        status: "pending",
      }),
      onTimeout: (timedOutRequest) => {
        timedOutRequests.push(timedOutRequest);
      },
    });

    const pending = registry.registerAndWait(request);
    vi.advanceTimersByTime(USER_QUESTION_DEADLINE_MS * 2);

    // Still awaiting the user's decision.
    await expect(
      Promise.race([
        pending.then(() => "resolved", () => "rejected"),
        Promise.resolve("still-pending"),
      ]),
    ).resolves.toBe("still-pending");
    expect(timedOutRequests).toEqual([]);
  });

  it("clears the deadline when a user question is answered in time", async () => {
    vi.useFakeTimers();
    const request = createUserQuestionRequest();
    const resolution = createUserQuestionResolution();
    const timedOutRequests: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "created",
        interactionId: "pint_registry_question",
        status: "pending",
      }),
      onTimeout: (timedOutRequest) => {
        timedOutRequests.push(timedOutRequest);
      },
    });

    const pending = registry.registerAndWait(request);
    registry.resolve({
      interactionId: "pint_registry_question",
      providerId: request.providerId,
      providerRequestId: request.providerRequestId,
      providerThreadId: request.providerThreadId,
      resolution,
      threadId: request.threadId,
    });
    await expect(pending).resolves.toEqual(resolution);

    vi.advanceTimersByTime(USER_QUESTION_DEADLINE_MS * 2);
    expect(timedOutRequests).toEqual([]);
  });

  it("does not time out a user question whose registration failed", async () => {
    vi.useFakeTimers();
    const request = createUserQuestionRequest();
    const timedOutRequests: PendingInteractionCreate[] = [];
    const registry = createRegistry({
      registerRequest: async () => ({
        outcome: "rejected",
        reason: "Thread is already awaiting user interaction",
      }),
      onTimeout: (timedOutRequest) => {
        timedOutRequests.push(timedOutRequest);
      },
    });

    await expect(registry.registerAndWait(request)).rejects.toMatchObject({
      code: "interactive_request_rejected",
    });
    vi.advanceTimersByTime(USER_QUESTION_DEADLINE_MS * 2);
    expect(timedOutRequests).toEqual([]);
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
