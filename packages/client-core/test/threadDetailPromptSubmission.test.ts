import {
  createStandaloneBuiltinCompactCommandInput,
  type ApprovalPendingInteractionPayload,
  type PendingInteraction,
  type PromptInput,
  type ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildAutoFollowUpRequest,
  buildFollowUpShortcutRequest,
  buildFollowUpSubmitMode,
  canSubmitFollowUpShortcut,
  classifyFollowUpPendingInteractions,
  resolveDefaultExecutionOptionsState,
  shouldQueueFollowUpMessage,
} from "../src/prompt/threadDetailPromptSubmission.js";

const textInput: PromptInput[] = [
  { type: "text", text: "Follow up", mentions: [] },
];

describe("threadDetailPromptSubmission", () => {
  it("prioritizes current prompt input over queued messages for the follow-up shortcut", () => {
    expect(
      buildFollowUpShortcutRequest({
        execution: null,
        input: textInput,
        queuedMessages: [{ id: "queued-1" }, { id: "queued-2" }],
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "draft",
      request: {
        id: "thread-1",
        input: textInput,
        mode: "steer-if-active",
      },
    });
  });

  it("steers with the selected execution options", () => {
    expect(
      buildFollowUpShortcutRequest({
        execution: {
          model: "gpt-5.6-luna",
          permissionMode: "full",
          reasoningLevel: "low",
          serviceTier: "fast",
          supportsServiceTier: false,
          executionInputSources: {
            model: "explicit",
            reasoningLevel: "explicit",
            permissionMode: "explicit",
          },
        },
        input: textInput,
        queuedMessages: [{ id: "queued-1" }],
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "draft",
      request: {
        id: "thread-1",
        input: textInput,
        mode: "steer-if-active",
        model: "gpt-5.6-luna",
        permissionMode: "full",
        reasoningLevel: "low",
        executionInputSources: {
          model: "explicit",
          reasoningLevel: "explicit",
          permissionMode: "explicit",
        },
      },
    });
  });

  it("uses only the next queued message for an empty follow-up shortcut", () => {
    expect(
      buildFollowUpShortcutRequest({
        execution: null,
        input: [],
        queuedMessages: [{ id: "queued-1" }, { id: "queued-2" }],
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "queued",
      request: {
        id: "thread-1",
        mode: "steer",
        queuedMessageId: "queued-1",
      },
    });
  });

  it("does not build an empty follow-up shortcut without queued messages", () => {
    expect(
      buildFollowUpShortcutRequest({
        execution: null,
        input: [],
        queuedMessages: [],
        threadId: "thread-1",
      }),
    ).toBeNull();
  });

  it("builds auto follow-up requests with selected execution options", () => {
    expect(
      buildAutoFollowUpRequest({
        compactFirst: false,
        declinePendingApprovals: false,
        execution: {
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
          supportsServiceTier: true,
          executionInputSources: {},
        },
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "queue-if-active",
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
      executionInputSources: {},
    });
  });

  it.each([
    [textInput, true],
    [createStandaloneBuiltinCompactCommandInput(), false],
  ])(
    "asks to compact first only for a message to send after compacting %#",
    (input, expected) => {
      const request = buildAutoFollowUpRequest({
        compactFirst: true,
        declinePendingApprovals: false,
        execution: null,
        input,
        threadId: "thread-1",
      });
      expect(request?.compactFirst === true).toBe(expected);
    },
  );

  it("omits execution overrides when building auto follow-up requests without concrete defaults", () => {
    expect(
      buildAutoFollowUpRequest({
        compactFirst: false,
        declinePendingApprovals: false,
        execution: null,
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "queue-if-active",
    });
  });

  it("omits unsupported service tier from auto follow-up requests", () => {
    expect(
      buildAutoFollowUpRequest({
        compactFirst: false,
        declinePendingApprovals: false,
        execution: {
          model: "gpt-5",
          permissionMode: "accept-edits",
          reasoningLevel: "high",
          serviceTier: "fast",
          supportsServiceTier: false,
          executionInputSources: {
            model: "explicit",
            reasoningLevel: "explicit",
            permissionMode: "explicit",
          },
        },
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "queue-if-active",
      model: "gpt-5",
      permissionMode: "accept-edits",
      reasoningLevel: "high",
      executionInputSources: {
        model: "explicit",
        reasoningLevel: "explicit",
        permissionMode: "explicit",
      },
    });
  });

  it("treats default execution options errors as unavailable rather than loading", () => {
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: true,
        hasResolvedDefaultExecutionOptions: true,
        isError: false,
      }),
    ).toBe("available");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: false,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: false,
        isError: true,
      }),
    ).toBe("unavailable");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: true,
        isError: false,
      }),
    ).toBe("unavailable");
  });

  it("gates the follow-up shortcut by runtime state and pending work", () => {
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: false,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    for (const runtimeDisplayStatus of ["provisioning", "starting"] as const) {
      expect(
        canSubmitFollowUpShortcut({
          hasPromptDraftInput: true,
          isFollowUpSubmitting: false,
          isQueueMutationPending: false,
          queuedMessageCount: 0,
          runtimeDisplayStatus,
          submitModeKind: "queue",
        }),
      ).toBe(true);
    }
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: false,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "idle",
        submitModeKind: "ready",
      }),
    ).toBe(true);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "waiting-for-host",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: false,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "waiting-for-host",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: true,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: true,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "idle",
        submitModeKind: "ready",
      }),
    ).toBe(false);

    const queueableStatuses: ThreadRuntimeDisplayStatus[] = [
      "active",
      "provisioning",
      "starting",
      "waiting-for-host",
    ];
    const immediateStatuses: ThreadRuntimeDisplayStatus[] = ["error", "idle"];

    for (const status of queueableStatuses) {
      expect(shouldQueueFollowUpMessage(status)).toBe(true);
    }
    for (const status of immediateStatuses) {
      expect(shouldQueueFollowUpMessage(status)).toBe(false);
    }
  });

  it("offers queue mode while a thread is starting", () => {
    const onStop = () => undefined;
    const queueableStatuses: ThreadRuntimeDisplayStatus[] = [
      "provisioning",
      "starting",
      "waiting-for-host",
    ];

    for (const runtimeDisplayStatus of queueableStatuses) {
      expect(
        buildFollowUpSubmitMode({
          pendingInteractions: "none",
          isDefaultExecutionOptionsLoading: true,
          isStopRequested: false,
          onStop,
          runtimeDisplayStatus,
        }),
      ).toEqual({ kind: "queue", onStop, declinesPendingApprovals: false });
    }
  });

  it("offers a stop-free queue mode while a stop is in flight, and keeps pending interactions blocked", () => {
    const onStop = () => undefined;
    expect(
      buildFollowUpSubmitMode({
        pendingInteractions: "none",
        isDefaultExecutionOptionsLoading: false,
        isStopRequested: true,
        onStop,
        runtimeDisplayStatus: "starting",
      }),
    ).toEqual({ kind: "queue-while-stopping" });
    expect(
      buildFollowUpSubmitMode({
        pendingInteractions: "blocking",
        isDefaultExecutionOptionsLoading: false,
        isStopRequested: false,
        onStop,
        runtimeDisplayStatus: "starting",
      }),
    ).toEqual({ kind: "blocked", reason: "pending-interaction" });
  });

  it("lets the user send while only approvals are pending, declining them", () => {
    const onStop = () => undefined;
    expect(
      buildFollowUpSubmitMode({
        pendingInteractions: "approvals",
        isDefaultExecutionOptionsLoading: false,
        isStopRequested: false,
        onStop,
        runtimeDisplayStatus: "active",
      }),
    ).toEqual({ kind: "queue", onStop, declinesPendingApprovals: true });
  });
});

describe("buildAutoFollowUpRequest with declinePendingApprovals", () => {
  it("steers the message into the waiting turn and asks the server to decline", () => {
    expect(
      buildAutoFollowUpRequest({
        compactFirst: true,
        declinePendingApprovals: true,
        execution: null,
        input: [{ type: "text", text: "Do this instead", mentions: [] }],
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: [{ type: "text", text: "Do this instead", mentions: [] }],
      mode: "steer-if-active",
      declinePendingApprovals: true,
    });
  });
});

const interactionBase = {
  threadId: "thread-1",
  turnId: "turn-1",
  providerId: "codex",
  providerThreadId: "provider-thread-1",
  providerRequestId: "request-1",
  origin: {
    kind: "provider",
    providerId: "codex",
    providerThreadId: "provider-thread-1",
    providerRequestId: "request-1",
  },
  resolution: null,
  statusReason: null,
  createdAt: 1,
  resolvedAt: null,
} as const;

function interaction(
  payload: ApprovalPendingInteractionPayload,
  status: PendingInteraction["status"] = "pending",
): PendingInteraction {
  return {
    ...interactionBase,
    id: `interaction-${payload.subject.kind}-${status}`,
    payload,
    status,
  };
}

function questionInteraction(): PendingInteraction {
  return {
    ...interactionBase,
    id: "interaction-question",
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "q1",
          prompt: "Which branch?",
          multiSelect: false,
          allowFreeText: true,
          required: true,
        },
      ],
    },
    status: "pending",
  };
}

function approval(
  subject: ApprovalPendingInteractionPayload["subject"],
  availableDecisions: ApprovalPendingInteractionPayload["availableDecisions"] = [
    "allow_once",
    "deny",
  ],
): ApprovalPendingInteractionPayload {
  return { kind: "approval", subject, reason: null, availableDecisions };
}

const commandApproval = approval({
  kind: "command",
  itemId: "item-1",
  command: "git push",
  cwd: "/tmp/project",
  actions: [],
  sessionGrant: null,
});
const planApproval = approval({
  kind: "plan",
  itemId: "item-plan",
  plan: "1. Push",
  planFilePath: null,
});
describe("classifyFollowUpPendingInteractions", () => {
  it.each<[string, PendingInteraction[], string]>([
    ["no interactions", [], "none"],
    ["a command approval", [interaction(commandApproval)], "approvals"],
    ["a plan approval", [interaction(planApproval)], "approvals"],
    [
      "an approval next to a question",
      [interaction(commandApproval), questionInteraction()],
      "blocking",
    ],
    [
      "an approval that offers no deny",
      [interaction(approval(commandApproval.subject, ["allow_once"]))],
      "blocking",
    ],
    [
      "only an approval that is already resolving",
      [interaction(commandApproval, "resolving")],
      "blocking",
    ],
    [
      "a pending approval next to a resolving one",
      [interaction(commandApproval), interaction(planApproval, "resolving")],
      "approvals",
    ],
  ])("classifies %s", (_, interactions, expected) => {
    expect(classifyFollowUpPendingInteractions(interactions)).toBe(expected);
  });
});

function clearCommandInput(): PromptInput[] {
  return createStandaloneBuiltinCompactCommandInput().map((item) =>
    item.type === "text"
      ? {
          ...item,
          text: "/clear",
          mentions: item.mentions.map((mention) => ({
            ...mention,
            end: "/clear".length,
            resource: { ...mention.resource, name: "clear" },
          })),
        }
      : item,
  );
}

describe("buildAutoFollowUpRequest with a built-in command", () => {
  it.each([
    ["/compact", createStandaloneBuiltinCompactCommandInput()],
    ["/clear", clearCommandInput()],
  ])("does not ask the server to decline for %s", (_, input) => {
    const request = buildAutoFollowUpRequest({
      compactFirst: false,
      declinePendingApprovals: true,
      execution: null,
      input,
      threadId: "thread-1",
    });
    expect(request).toMatchObject({ mode: "queue-if-active" });
    expect(request).not.toHaveProperty("declinePendingApprovals");
  });
});
