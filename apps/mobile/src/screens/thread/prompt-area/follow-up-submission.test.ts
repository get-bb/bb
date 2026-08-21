import type { PromptInput } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildFollowUpExecutionInputSources,
  buildFollowUpSubmission,
  canEditSentMessages,
  followUpPlaceholder,
  resolveFollowUpSubmitIntent,
} from "./follow-up-submission";

const INPUT: PromptInput[] = [{ type: "text", text: "hello", mentions: [] }];
const EXECUTION = {
  model: "fake-model",
  permissionMode: "auto" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "fast" as const,
  supportsServiceTier: true,
  executionInputSources: { model: "explicit" as const },
};

describe("resolveFollowUpSubmitIntent", () => {
  it("keeps tap = queue / long-press = steer by default and swaps them with steerActiveThreadOnEnter", () => {
    expect(
      resolveFollowUpSubmitIntent({
        kind: "queue",
        steerActiveThreadOnEnter: false,
      }),
    ).toBe("queue");
    expect(
      resolveFollowUpSubmitIntent({
        kind: "steer",
        steerActiveThreadOnEnter: false,
      }),
    ).toBe("steer");
    expect(
      resolveFollowUpSubmitIntent({
        kind: "queue",
        steerActiveThreadOnEnter: true,
      }),
    ).toBe("steer");
    expect(
      resolveFollowUpSubmitIntent({
        kind: "steer",
        steerActiveThreadOnEnter: true,
      }),
    ).toBe("queue");
    // An idle thread has nothing to steer; the setting does not apply.
    expect(
      resolveFollowUpSubmitIntent({
        kind: "send",
        steerActiveThreadOnEnter: true,
      }),
    ).toBe("send");
  });
});

describe("buildFollowUpSubmission", () => {
  it("sends queue-if-active with the execution overrides when the runtime is idle", () => {
    expect(
      buildFollowUpSubmission({
        intent: "send",
        runtimeDisplayStatus: "idle",
        threadId: "t1",
        input: INPUT,
        execution: EXECUTION,
        queuedMessages: [],
      }),
    ).toEqual({
      kind: "send",
      request: {
        id: "t1",
        input: INPUT,
        mode: "queue-if-active",
        model: "fake-model",
        serviceTier: "fast",
        reasoningLevel: "medium",
        permissionMode: "auto",
        executionInputSources: { model: "explicit" },
      },
    });
  });

  it("creates a queued message while the runtime is busy, dropping an unsupported tier", () => {
    const submission = buildFollowUpSubmission({
      intent: "queue",
      runtimeDisplayStatus: "active",
      threadId: "t1",
      input: INPUT,
      execution: { ...EXECUTION, supportsServiceTier: false },
      queuedMessages: [],
    });
    expect(submission?.kind).toBe("queue");
    expect(submission?.request).toEqual({
      id: "t1",
      input: INPUT,
      model: "fake-model",
      reasoningLevel: "medium",
      permissionMode: "auto",
      executionInputSources: { model: "explicit" },
    });
    // A "send" intent on a provisioning thread also queues (web handleSend).
    expect(
      buildFollowUpSubmission({
        intent: "send",
        runtimeDisplayStatus: "provisioning",
        threadId: "t1",
        input: INPUT,
        execution: null,
        queuedMessages: [],
      }),
    ).toEqual({ kind: "queue", request: { id: "t1", input: INPUT } });
  });

  it("steers with the draft, or sends the queue head when the draft is empty", () => {
    expect(
      buildFollowUpSubmission({
        intent: "steer",
        runtimeDisplayStatus: "active",
        threadId: "t1",
        input: INPUT,
        execution: EXECUTION,
        queuedMessages: [{ id: "q1" }],
      }),
    ).toEqual({
      kind: "steer",
      // get-bb/bb#1860: the steer carries the picker selection like a send.
      request: {
        id: "t1",
        input: INPUT,
        mode: "steer-if-active",
        model: "fake-model",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: "fast",
        executionInputSources: { model: "explicit" },
      },
    });
    expect(
      buildFollowUpSubmission({
        intent: "steer",
        runtimeDisplayStatus: "active",
        threadId: "t1",
        input: [],
        execution: EXECUTION,
        queuedMessages: [{ id: "q1" }, { id: "q2" }],
      }),
    ).toEqual({
      kind: "send-queued-head",
      request: { id: "t1", mode: "auto", queuedMessageId: "q1" },
    });
    expect(
      buildFollowUpSubmission({
        intent: "steer",
        runtimeDisplayStatus: "active",
        threadId: "t1",
        input: [],
        execution: EXECUTION,
        queuedMessages: [],
      }),
    ).toBeNull();
  });

  it("returns null for an empty draft", () => {
    expect(
      buildFollowUpSubmission({
        intent: "send",
        runtimeDisplayStatus: "idle",
        threadId: "t1",
        input: [],
        execution: EXECUTION,
        queuedMessages: [],
      }),
    ).toBeNull();
  });
});

describe("buildFollowUpExecutionInputSources", () => {
  it("marks every field explicit once any control was touched", () => {
    expect(
      buildFollowUpExecutionInputSources({
        touched: true,
        forceExplicitModel: false,
        hasServiceTier: true,
      }),
    ).toEqual({
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      serviceTier: "explicit",
    });
    expect(
      buildFollowUpExecutionInputSources({
        touched: true,
        forceExplicitModel: false,
        hasServiceTier: false,
      }),
    ).not.toHaveProperty("serviceTier");
  });

  it("sends nothing untouched, except the model after an unavailable-model recovery", () => {
    expect(
      buildFollowUpExecutionInputSources({
        touched: false,
        forceExplicitModel: false,
        hasServiceTier: true,
      }),
    ).toEqual({});
    expect(
      buildFollowUpExecutionInputSources({
        touched: false,
        forceExplicitModel: true,
        hasServiceTier: true,
      }),
    ).toEqual({ model: "explicit" });
  });
});

describe("followUpPlaceholder", () => {
  it("prefers the edit target, then the stop request, then the runtime status", () => {
    expect(
      followUpPlaceholder({
        runtimeDisplayStatus: "active",
        isStopRequested: true,
        editing: {
          kind: "queued-message",
          queuedMessageId: "q1",
          expectedUpdatedAt: 1,
        },
      }),
    ).toBe("Edit queued message");
    expect(
      followUpPlaceholder({
        runtimeDisplayStatus: "active",
        isStopRequested: true,
        editing: null,
      }),
    ).toBe("Stopping…");
    expect(
      followUpPlaceholder({
        runtimeDisplayStatus: "host-reconnecting",
        isStopRequested: false,
        editing: null,
      }),
    ).toBe("Reconnecting…");
  });
});

describe("canEditSentMessages", () => {
  const base = {
    editMessagesExperiment: true,
    providerSupportsSessionRewind: true,
    archived: false,
    hasPendingInteraction: false,
    isEditing: false,
    isSubmitting: false,
    timelineEmptyAndLoading: false,
    queuedMessageCount: 0,
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount: 0,
  };

  it("requires the experiment, a rewindable provider, and a quiet live thread", () => {
    expect(canEditSentMessages(base)).toBe(true);
    expect(
      canEditSentMessages({ ...base, editMessagesExperiment: false }),
    ).toBe(false);
    expect(
      canEditSentMessages({ ...base, providerSupportsSessionRewind: false }),
    ).toBe(false);
    expect(canEditSentMessages({ ...base, queuedMessageCount: 1 })).toBe(false);
    expect(canEditSentMessages({ ...base, hasPendingInteraction: true })).toBe(
      false,
    );
    expect(
      canEditSentMessages({ ...base, activeBackgroundCommandCount: 2 }),
    ).toBe(false);
  });
});
