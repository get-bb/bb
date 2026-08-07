import type {
  ApprovalPendingInteractionResolution,
  CallerExecutionInputSource,
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  ThreadCommandRequestFingerprint,
  UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import { hashCanonicalJsonFingerprint } from "./canonical-json-fingerprint.js";

/**
 * Format version for the deterministic `message.send` request fingerprint.
 * Bump when the normalized intent shape or canonicalization rules change.
 */
export const MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Format version for deterministic `message.steer` fingerprints. Includes
 * `expectedTurnId` in addition to send intent fields.
 */
export const MESSAGE_STEER_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Format version for deterministic `thread.interrupt` fingerprints.
 */
export const THREAD_INTERRUPT_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Format version for deterministic `interaction.answer` fingerprints.
 */
export const INTERACTION_ANSWER_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Format version for deterministic `interaction.approve` fingerprints.
 */
export const INTERACTION_APPROVE_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Format version for deterministic `read.mark` fingerprints.
 */
export const READ_MARK_REQUEST_FINGERPRINT_FORMAT_VERSION = 1 as const;

/**
 * Client intent hashed for admission identity. Excludes actor, thread ID, and
 * request ID — those are separate admission identity fields. Computed before
 * plugin expansion or other volatile server context.
 */
export type MessageSendRequestFingerprintIntent = {
  readonly input: readonly PromptInput[];
  readonly model?: string;
  readonly serviceTier?: ServiceTier;
  readonly reasoningLevel?: ReasoningLevel;
  readonly permissionMode?: PermissionMode;
  readonly executionInputSources?: {
    readonly model?: CallerExecutionInputSource;
    readonly serviceTier?: CallerExecutionInputSource;
    readonly reasoningLevel?: CallerExecutionInputSource;
    readonly permissionMode?: CallerExecutionInputSource;
  };
  readonly senderThreadId?: string;
};

export type MessageSteerRequestFingerprintIntent =
  MessageSendRequestFingerprintIntent & {
    readonly expectedTurnId: string;
  };

export type ThreadInterruptRequestFingerprintIntent = {
  readonly expectedTurnId: string;
};

export type InteractionAnswerRequestFingerprintIntent = {
  readonly interactionId: string;
  readonly resolution: UserQuestionPendingInteractionResolution;
};

export type InteractionApproveRequestFingerprintIntent = {
  readonly interactionId: string;
  readonly resolution: ApprovalPendingInteractionResolution;
};

export type ReadMarkRequestFingerprintIntent = {
  /**
   * Exact event cursor from the Room `read.mark(requestId, eventCursor)`
   * command. Must be present in the fingerprint payload.
   */
  readonly eventCursor: string;
};

/**
 * Builds a versioned SHA-256 fingerprint over normalized `message.send` client
 * intent. Stable across object key insertion order and omitted vs explicit
 * undefined optional fields.
 */
export function fingerprintMessageSendRequest(
  intent: MessageSendRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  return hashCanonicalJsonFingerprint(
    {
      fingerprintFormatVersion: MESSAGE_SEND_REQUEST_FINGERPRINT_FORMAT_VERSION,
      input: intent.input,
      ...(intent.model !== undefined ? { model: intent.model } : {}),
      ...(intent.serviceTier !== undefined
        ? { serviceTier: intent.serviceTier }
        : {}),
      ...(intent.reasoningLevel !== undefined
        ? { reasoningLevel: intent.reasoningLevel }
        : {}),
      ...(intent.permissionMode !== undefined
        ? { permissionMode: intent.permissionMode }
        : {}),
      ...(intent.executionInputSources !== undefined
        ? { executionInputSources: intent.executionInputSources }
        : {}),
      ...(intent.senderThreadId !== undefined
        ? { senderThreadId: intent.senderThreadId }
        : {}),
    },
    "message.send",
  );
}

/**
 * Builds a versioned SHA-256 fingerprint over normalized exact-steer client
 * intent, including the required expected turn id.
 */
export function fingerprintMessageSteerRequest(
  intent: MessageSteerRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  if (intent.expectedTurnId.length === 0) {
    throw new Error(
      "exact-steer fingerprint requires a non-empty expectedTurnId",
    );
  }
  return hashCanonicalJsonFingerprint(
    {
      fingerprintFormatVersion: MESSAGE_STEER_REQUEST_FINGERPRINT_FORMAT_VERSION,
      expectedTurnId: intent.expectedTurnId,
      input: intent.input,
      ...(intent.model !== undefined ? { model: intent.model } : {}),
      ...(intent.serviceTier !== undefined
        ? { serviceTier: intent.serviceTier }
        : {}),
      ...(intent.reasoningLevel !== undefined
        ? { reasoningLevel: intent.reasoningLevel }
        : {}),
      ...(intent.permissionMode !== undefined
        ? { permissionMode: intent.permissionMode }
        : {}),
      ...(intent.executionInputSources !== undefined
        ? { executionInputSources: intent.executionInputSources }
        : {}),
      ...(intent.senderThreadId !== undefined
        ? { senderThreadId: intent.senderThreadId }
        : {}),
    },
    "message.steer",
  );
}

/**
 * Builds a versioned SHA-256 fingerprint over exact-interrupt client intent.
 */
export function fingerprintThreadInterruptRequest(
  intent: ThreadInterruptRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  if (intent.expectedTurnId.length === 0) {
    throw new Error(
      "thread.interrupt fingerprint requires a non-empty expectedTurnId",
    );
  }
  return hashCanonicalJsonFingerprint(
    {
      fingerprintFormatVersion:
        THREAD_INTERRUPT_REQUEST_FINGERPRINT_FORMAT_VERSION,
      expectedTurnId: intent.expectedTurnId,
    },
    "thread.interrupt",
  );
}

/**
 * Builds a versioned SHA-256 fingerprint over `interaction.answer` intent:
 * command kind/version + exact interactionId + user-answer resolution JSON.
 */
export function fingerprintInteractionAnswerRequest(
  intent: InteractionAnswerRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  if (intent.interactionId.length === 0) {
    throw new Error(
      "interaction.answer fingerprint requires a non-empty interactionId",
    );
  }
  return hashCanonicalJsonFingerprint(
    {
      commandKind: "interaction.answer",
      fingerprintFormatVersion:
        INTERACTION_ANSWER_REQUEST_FINGERPRINT_FORMAT_VERSION,
      interactionId: intent.interactionId,
      resolution: intent.resolution,
    },
    "interaction.answer",
  );
}

/**
 * Builds a versioned SHA-256 fingerprint over `interaction.approve` intent:
 * command kind/version + exact interactionId + approval resolution JSON.
 */
export function fingerprintInteractionApproveRequest(
  intent: InteractionApproveRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  if (intent.interactionId.length === 0) {
    throw new Error(
      "interaction.approve fingerprint requires a non-empty interactionId",
    );
  }
  return hashCanonicalJsonFingerprint(
    {
      commandKind: "interaction.approve",
      fingerprintFormatVersion:
        INTERACTION_APPROVE_REQUEST_FINGERPRINT_FORMAT_VERSION,
      interactionId: intent.interactionId,
      resolution: intent.resolution,
    },
    "interaction.approve",
  );
}

/**
 * Builds a versioned SHA-256 fingerprint over `read.mark` intent: command
 * kind/version + exact `eventCursor` (required by the Room command contract).
 */
export function fingerprintReadMarkRequest(
  intent: ReadMarkRequestFingerprintIntent,
): ThreadCommandRequestFingerprint {
  if (intent.eventCursor.length === 0) {
    throw new Error("read.mark fingerprint requires a non-empty eventCursor");
  }
  return hashCanonicalJsonFingerprint(
    {
      commandKind: "read.mark",
      fingerprintFormatVersion: READ_MARK_REQUEST_FINGERPRINT_FORMAT_VERSION,
      eventCursor: intent.eventCursor,
    },
    "read.mark",
  );
}
