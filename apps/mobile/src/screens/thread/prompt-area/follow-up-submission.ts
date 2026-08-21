import {
  buildAutoFollowUpRequest,
  buildCreateQueuedFollowUpRequest,
  buildFollowUpShortcutRequest,
  shouldQueueFollowUpMessage,
  type CreateQueuedFollowUpRequest,
  type FollowUpExecutionSelection,
  type QueuedMessageForSend,
  type SendMessageMutationRequest,
  type SendQueuedMessageByIdRequest,
} from "@bb/client-core";
import type { PromptInput, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { ExistingThreadExecutionInputSources } from "@bb/server-contract";
import type { ComposerSubmitKind } from "@/composer/model";

/**
 * Pure policy behind the thread screen's follow-up composer (the mobile
 * counterpart of the submit wiring in apps/app ThreadDetailPromptArea.tsx):
 * which request a tap / long-press produces, how execution overrides are
 * attributed, and the placeholder + blocked copy.
 */

type FollowUpSubmitIntent = "send" | "queue" | "steer";

/**
 * Web: Enter sends (`queue-if-active`), Cmd+Enter steers; with the
 * `steerActiveThreadOnEnter` setting the two swap while the runtime is
 * active. The native composer reports `send` (idle), `queue` (active, tap)
 * or `steer` (active, long-press).
 */
export function resolveFollowUpSubmitIntent({
  kind,
  steerActiveThreadOnEnter,
}: {
  kind: ComposerSubmitKind;
  steerActiveThreadOnEnter: boolean;
}): FollowUpSubmitIntent {
  if (kind === "send") return "send";
  if (!steerActiveThreadOnEnter) return kind;
  return kind === "queue" ? "steer" : "queue";
}

type FollowUpSubmission =
  /** `POST /threads/:id/send` with `queue-if-active` (the server decides). */
  | { kind: "send"; request: SendMessageMutationRequest }
  /** `POST /threads/:id/queued-messages` while the runtime is busy. */
  | { kind: "queue"; request: CreateQueuedFollowUpRequest }
  /** `POST /threads/:id/send` with `steer-if-active` (interrupts the turn). */
  | { kind: "steer"; request: SendMessageMutationRequest }
  /** Empty draft + steer intent: send the queue head now instead. */
  | { kind: "send-queued-head"; request: SendQueuedMessageByIdRequest };

interface BuildFollowUpSubmissionArgs {
  intent: FollowUpSubmitIntent;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  threadId: string;
  input: PromptInput[];
  execution: FollowUpExecutionSelection;
  queuedMessages: readonly QueuedMessageForSend[];
}

export function buildFollowUpSubmission({
  intent,
  runtimeDisplayStatus,
  threadId,
  input,
  execution,
  queuedMessages,
}: BuildFollowUpSubmissionArgs): FollowUpSubmission | null {
  if (intent === "steer") {
    const shortcut = buildFollowUpShortcutRequest({
      execution,
      input,
      queuedMessages,
      threadId,
    });
    if (!shortcut) return null;
    return shortcut.kind === "draft"
      ? { kind: "steer", request: shortcut.request }
      : { kind: "send-queued-head", request: shortcut.request };
  }
  if (shouldQueueFollowUpMessage(runtimeDisplayStatus)) {
    const request = buildCreateQueuedFollowUpRequest({
      execution,
      input,
      threadId,
    });
    return request ? { kind: "queue", request } : null;
  }
  const request = buildAutoFollowUpRequest({ execution, input, threadId });
  return request ? { kind: "send", request } : null;
}

/** Toast copy for a failed submission of each kind. */
export function followUpSubmissionErrorMessage(
  kind: FollowUpSubmission["kind"],
): string {
  switch (kind) {
    case "queue":
      return "Failed to queue message";
    case "send-queued-head":
      return "Failed to send queued message";
    case "send":
    case "steer":
      return "Failed to send message";
  }
}

/**
 * Existing-thread execution attribution (web `buildExecutionInputSources`
 * with `scope: "component-local"`): once any execution control is touched
 * every field is sent as explicit, so the server never merges stale
 * last-run values with new picks; an unavailable-model recovery forces the
 * model alone.
 */
export function buildFollowUpExecutionInputSources({
  touched,
  forceExplicitModel,
  hasServiceTier,
}: {
  touched: boolean;
  forceExplicitModel: boolean;
  /** A service tier value is being sent (provider supports tiers). */
  hasServiceTier: boolean;
}): ExistingThreadExecutionInputSources {
  if (touched) {
    return {
      model: "explicit",
      reasoningLevel: "explicit",
      permissionMode: "explicit",
      ...(hasServiceTier ? { serviceTier: "explicit" } : {}),
    };
  }
  return forceExplicitModel ? { model: "explicit" } : {};
}

/**
 * Web `getCompactFollowUpPromptPlaceholder`: short copy for the one-line
 * native composer, with the stop request winning over the runtime status.
 */
export function followUpPlaceholder({
  runtimeDisplayStatus,
  isStopRequested,
  editing,
}: {
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  isStopRequested: boolean;
  editing: FollowUpEditTarget | null;
}): string {
  if (editing) {
    return editing.kind === "queued-message"
      ? "Edit queued message"
      : "Edit message";
  }
  if (isStopRequested) return "Stopping…";
  switch (runtimeDisplayStatus) {
    case "provisioning":
      return "Setting up…";
    case "starting":
      return "Starting…";
    case "stopping":
      return "Stopping…";
    case "waiting-for-host":
      return "Host disconnected";
    case "host-reconnecting":
      return "Reconnecting…";
    case "error":
      return "Follow up…";
    case "idle":
    case "active":
      return "Follow up…";
  }
}

/** What the composer is editing instead of drafting a new follow-up. */
export type FollowUpEditTarget =
  | {
      kind: "queued-message";
      queuedMessageId: string;
      /** `updatedAt` of the message when the edit began (conflict guard). */
      expectedUpdatedAt: number;
    }
  | {
      kind: "sent-message";
      rowId: string;
      operationId: string;
      /** The row's `sourceSeqStart`: the server refuses a stale target. */
      expectedRequestSequence: number;
    };

interface CanEditSentMessagesArgs {
  editMessagesExperiment: boolean;
  providerSupportsSessionRewind: boolean;
  archived: boolean;
  hasPendingInteraction: boolean;
  isEditing: boolean;
  isSubmitting: boolean;
  timelineEmptyAndLoading: boolean;
  queuedMessageCount: number;
  activeWorkflowCount: number;
  activeBackgroundAgentCount: number;
  activeBackgroundCommandCount: number;
}

/**
 * Web `canEditSentMessages` (ThreadDetailView): the edit affordance exists
 * only behind the experiment, for providers that can rewind a session, on a
 * live thread with nothing pending, queued, or running in the background.
 * The server repeats the full eligibility check.
 */
export function canEditSentMessages(args: CanEditSentMessagesArgs): boolean {
  return (
    args.editMessagesExperiment &&
    args.providerSupportsSessionRewind &&
    !args.archived &&
    !args.hasPendingInteraction &&
    !args.isEditing &&
    !args.isSubmitting &&
    !args.timelineEmptyAndLoading &&
    args.queuedMessageCount === 0 &&
    args.activeWorkflowCount === 0 &&
    args.activeBackgroundAgentCount === 0 &&
    args.activeBackgroundCommandCount === 0
  );
}
