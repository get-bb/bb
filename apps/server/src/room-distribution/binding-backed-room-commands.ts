import { getThreadCommandAdmission } from "@bb/db";
import {
  approvalPendingInteractionResolutionSchema,
  clientTurnRequestIdSchema,
  isApprovalPendingInteractionPayload,
  isUserQuestionPendingInteractionPayload,
  userQuestionPendingInteractionResolutionSchema,
  type ApprovalPendingInteractionResolution,
  type ClientTurnRequestId,
  type PersistedThreadCommandAdmission,
  type Principal,
  type Thread,
  type UserQuestionPendingInteractionResolution,
} from "@bb/domain";

import { ApiError } from "../errors.js";
import { actorStampFromPrincipal } from "../services/actor-stamp.js";
import { admitQueueIfActiveSendMessage } from "../services/threads/admitted-send.js";
import { admitExactInterrupt } from "../services/threads/admitted-interrupt.js";
import {
  admitInteractionAnswer,
  admitInteractionApprove,
} from "../services/threads/admitted-interaction-resolution.js";
import { admitReadMark } from "../services/threads/admitted-read-mark.js";
import { admitExactSteerMessage } from "../services/threads/admitted-steer.js";
import {
  fingerprintInteractionAnswerRequest,
  fingerprintInteractionApproveRequest,
  fingerprintMessageSendRequest,
  fingerprintMessageSteerRequest,
  fingerprintReadMarkRequest,
  fingerprintThreadInterruptRequest,
} from "../services/threads/message-send-fingerprint.js";
import { threadCommandAdmissionReceiptFromPersisted } from "../services/threads/thread-command-receipt.js";
import type { AppDeps } from "../types.js";
import type { WorkTogetherRoomCommandAuthorityPortV1 } from "./work-together-room-command-authority.js";
import {
  RoomDistributionUnavailableError,
  type RoomDistributionCommandResultV1,
  type RoomJsonObject,
  type RoomJsonValue,
} from "./room-distribution-port.js";

const MAX_COMMAND_TEXT_BYTES = 65_536;
const MAX_INTERACTION_PAYLOAD_BYTES = 64 * 1024;
const MAX_TURN_ID_CODE_POINTS = 256;
/** Opaque Room cursor grammar shared with child-stream selector validation. */
const ROOM_EVENT_CURSOR_PATTERN = /^[A-Za-z0-9._~:%+-]{1,512}$/u;
const PENDING_INTERACTION_ID_PATTERN =
  /^pint_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/;
const FORBIDDEN_IDENTITY_KEY_TOKENS = new Set([
  "actor",
  "actorid",
  "author",
  "authorid",
  "principal",
  "principalid",
  "userid",
  "user",
]);

type RoomMessageSendCommand = Readonly<{
  kind: "message.send";
  requestId: ClientTurnRequestId;
  text: string;
}>;

type RoomMessageSteerCommand = Readonly<{
  expectedTurnId: string;
  kind: "message.steer";
  requestId: ClientTurnRequestId;
  text: string;
}>;

type RoomThreadInterruptCommand = Readonly<{
  expectedTurnId: string;
  kind: "thread.interrupt";
  requestId: ClientTurnRequestId;
}>;

type RoomInteractionAnswerCommand = Readonly<{
  interactionId: string;
  kind: "interaction.answer";
  requestId: ClientTurnRequestId;
  resolution: UserQuestionPendingInteractionResolution;
}>;

type RoomInteractionApproveCommand = Readonly<{
  interactionId: string;
  kind: "interaction.approve";
  requestId: ClientTurnRequestId;
  resolution: ApprovalPendingInteractionResolution;
}>;

type RoomReadMarkCommand = Readonly<{
  eventCursor: string;
  kind: "read.mark";
  requestId: ClientTurnRequestId;
}>;

type SupportedRoomCommand =
  | RoomMessageSendCommand
  | RoomMessageSteerCommand
  | RoomThreadInterruptCommand
  | RoomInteractionAnswerCommand
  | RoomInteractionApproveCommand
  | RoomReadMarkCommand;

type RoomCommandScope = Readonly<{
  bindingId: string;
  principal: Principal;
  taskId: string;
  thread: Thread;
  workspaceId: string;
}>;

type RoomCommandAuthority = Awaited<
  ReturnType<WorkTogetherRoomCommandAuthorityPortV1["read"]>
>;

function unavailable(): never {
  throw new RoomDistributionUnavailableError("not_found");
}

function exactKeys(
  value: RoomJsonObject,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function rejectForbiddenIdentityKeys(value: unknown, depth = 0): void {
  if (depth > 32) unavailable();
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectForbiddenIdentityKeys(item, depth + 1);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const token = key.toLowerCase().replaceAll(/[-_]/gu, "");
    if (FORBIDDEN_IDENTITY_KEY_TOKENS.has(token)) {
      unavailable();
    }
    rejectForbiddenIdentityKeys(item, depth + 1);
  }
}

function commandText(value: RoomJsonValue | undefined): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.normalize("NFC") !== value ||
    Buffer.byteLength(value, "utf8") > MAX_COMMAND_TEXT_BYTES ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    unavailable();
  }
  return value;
}

function requestId(value: RoomJsonValue | undefined): ClientTurnRequestId {
  const parsed = clientTurnRequestIdSchema.safeParse(value);
  if (!parsed.success) unavailable();
  return parsed.data;
}

function expectedTurnId(value: RoomJsonValue | undefined): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.normalize("NFC") !== value ||
    [...value].length > MAX_TURN_ID_CODE_POINTS ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    unavailable();
  }
  return value;
}

function interactionId(value: RoomJsonValue | undefined): string {
  if (
    typeof value !== "string" ||
    !PENDING_INTERACTION_ID_PATTERN.test(value)
  ) {
    unavailable();
  }
  return value;
}

function eventCursor(value: RoomJsonValue | undefined): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !ROOM_EVENT_CURSOR_PATTERN.test(value)
  ) {
    unavailable();
  }
  return value;
}

function boundJsonPayload(value: RoomJsonValue | undefined): unknown {
  if (value === undefined) unavailable();
  rejectForbiddenIdentityKeys(value);
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    unavailable();
  }
  if (
    encoded === undefined ||
    Buffer.byteLength(encoded, "utf8") > MAX_INTERACTION_PAYLOAD_BYTES
  ) {
    unavailable();
  }
  return value;
}

function userAnswerResolution(
  value: RoomJsonValue | undefined,
): UserQuestionPendingInteractionResolution {
  const payload = boundJsonPayload(value);
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "kind" in payload &&
    (payload as { kind: unknown }).kind === "user_answer"
  ) {
    const parsed =
      userQuestionPendingInteractionResolutionSchema.safeParse(payload);
    if (!parsed.success) unavailable();
    return parsed.data;
  }
  const parsed = userQuestionPendingInteractionResolutionSchema.safeParse({
    kind: "user_answer",
    answers: payload,
  });
  if (!parsed.success) unavailable();
  return parsed.data;
}

function approvalResolution(
  value: RoomJsonValue | undefined,
): ApprovalPendingInteractionResolution {
  const payload = boundJsonPayload(value);
  const parsed = approvalPendingInteractionResolutionSchema.safeParse(payload);
  if (!parsed.success) unavailable();
  return parsed.data;
}

function decodeCommand(command: RoomJsonObject): SupportedRoomCommand {
  switch (command.kind) {
    case "message.send":
      if (!exactKeys(command, ["kind", "requestId", "text"])) unavailable();
      return Object.freeze({
        kind: "message.send",
        requestId: requestId(command.requestId),
        text: commandText(command.text),
      });
    case "message.steer":
      if (
        !exactKeys(command, ["expectedTurnId", "kind", "requestId", "text"])
      ) {
        unavailable();
      }
      return Object.freeze({
        expectedTurnId: expectedTurnId(command.expectedTurnId),
        kind: "message.steer",
        requestId: requestId(command.requestId),
        text: commandText(command.text),
      });
    case "thread.interrupt":
      if (!exactKeys(command, ["expectedTurnId", "kind", "requestId"])) {
        unavailable();
      }
      return Object.freeze({
        expectedTurnId: expectedTurnId(command.expectedTurnId),
        kind: "thread.interrupt",
        requestId: requestId(command.requestId),
      });
    case "interaction.answer":
      if (
        !exactKeys(command, ["interactionId", "kind", "requestId", "value"])
      ) {
        unavailable();
      }
      return Object.freeze({
        interactionId: interactionId(command.interactionId),
        kind: "interaction.answer",
        requestId: requestId(command.requestId),
        resolution: userAnswerResolution(command.value),
      });
    case "interaction.approve":
      if (
        !exactKeys(command, [
          "interactionId",
          "kind",
          "requestId",
          "resolution",
        ])
      ) {
        unavailable();
      }
      return Object.freeze({
        interactionId: interactionId(command.interactionId),
        kind: "interaction.approve",
        requestId: requestId(command.requestId),
        resolution: approvalResolution(command.resolution),
      });
    case "read.mark":
      if (!exactKeys(command, ["eventCursor", "kind", "requestId"])) {
        unavailable();
      }
      return Object.freeze({
        eventCursor: eventCursor(command.eventCursor),
        kind: "read.mark",
        requestId: requestId(command.requestId),
      });
    default:
      unavailable();
  }
}

function receiptResult(
  result: ReturnType<
    typeof threadCommandAdmissionReceiptFromPersisted
  >["result"],
): RoomJsonObject {
  switch (result.disposition) {
    case "started":
    case "queued":
    case "steered":
    case "interrupted":
    case "answered":
    case "approved":
    case "marked":
      return { disposition: result.disposition };
  }
}

function commandReceipt(
  result: Readonly<{
    admission: PersistedThreadCommandAdmission;
    kind: "accepted" | "replayed";
  }>,
): RoomJsonObject {
  const receipt = threadCommandAdmissionReceiptFromPersisted({
    admission: result.admission,
    kind: result.kind,
  });
  return {
    schemaVersion: 1,
    outcome: receipt.kind === "accepted" ? "accepted" : "already-accepted",
    requestId: receipt.requestId,
    commandKind: receipt.commandKind,
    admissionSequence: receipt.admissionSequence,
    result: receiptResult(receipt.result),
    createdAt: receipt.createdAt,
    completedAt: receipt.completedAt,
  };
}

function commandKind(command: SupportedRoomCommand) {
  return command.kind;
}

function commandFingerprint(command: SupportedRoomCommand) {
  switch (command.kind) {
    case "message.send":
      return fingerprintMessageSendRequest({
        input: [{ type: "text", text: command.text, mentions: [] }],
      });
    case "message.steer":
      return fingerprintMessageSteerRequest({
        expectedTurnId: command.expectedTurnId,
        input: [{ type: "text", text: command.text, mentions: [] }],
      });
    case "thread.interrupt":
      return fingerprintThreadInterruptRequest({
        expectedTurnId: command.expectedTurnId,
      });
    case "interaction.answer":
      return fingerprintInteractionAnswerRequest({
        interactionId: command.interactionId,
        resolution: command.resolution,
      });
    case "interaction.approve":
      return fingerprintInteractionApproveRequest({
        interactionId: command.interactionId,
        resolution: command.resolution,
      });
    case "read.mark":
      return fingerprintReadMarkRequest({
        eventCursor: command.eventCursor,
      });
  }
}

function exactRecoveredAdmission(
  deps: AppDeps,
  scope: RoomCommandScope,
  command: SupportedRoomCommand,
): PersistedThreadCommandAdmission | null {
  const admission = getThreadCommandAdmission(deps.db, {
    threadId: scope.thread.id,
    requestId: command.requestId,
  });
  if (
    admission === null ||
    admission.commandKind !== commandKind(command) ||
    admission.requestFingerprint !== commandFingerprint(command) ||
    admission.actor.principalId !== scope.principal.id ||
    admission.actor.principalKind !== scope.principal.kind
  ) {
    return null;
  }
  return admission;
}

function rejectedReceipt(
  command: SupportedRoomCommand,
  reason: string,
): RoomDistributionCommandResultV1 {
  return Object.freeze({
    status: 200,
    body: {
      schemaVersion: 1,
      outcome: "rejected",
      requestId: command.requestId,
      commandKind: command.kind,
      reason,
    },
  });
}

function rejectionReason(error: ApiError): string {
  switch (error.body.code) {
    case "thread_command_admission_conflict":
      return "request_identity_conflict";
    case "expected_turn_mismatch":
      return "turn_mismatch";
    case "awaiting_user_interaction":
      return "awaiting_interaction";
    case "pending_interaction_conflict":
      return "interaction_conflict";
    default:
      return "unavailable";
  }
}

function canAnswerInteraction(authority: RoomCommandAuthority): boolean {
  return authority.role === "owner" || authority.role === "member";
}

function canApproveInteraction(authority: RoomCommandAuthority): boolean {
  return authority.role === "owner";
}

function hasPendingUserQuestion(deps: AppDeps, threadId: string): boolean {
  return deps.pendingInteractions
    .listPendingThreadInteractions(threadId)
    .some(
      (interaction) =>
        interaction.status === "pending" &&
        isUserQuestionPendingInteractionPayload(interaction.payload),
    );
}

function hasPendingApproval(deps: AppDeps, threadId: string): boolean {
  return deps.pendingInteractions
    .listPendingThreadInteractions(threadId)
    .some(
      (interaction) =>
        interaction.status === "pending" &&
        isApprovalPendingInteractionPayload(interaction.payload),
    );
}

function commandAvailable(
  deps: AppDeps,
  command: SupportedRoomCommand,
  scope: RoomCommandScope,
  authority: RoomCommandAuthority,
): boolean {
  switch (command.kind) {
    case "message.send":
      return scope.thread.status === "idle" || scope.thread.status === "active";
    case "message.steer":
      return scope.thread.status === "active";
    case "thread.interrupt":
      return (
        (scope.thread.status === "active" ||
          scope.thread.status === "starting") &&
        (authority.role === "owner" || authority.isTaskAssignee)
      );
    case "interaction.answer":
      return (
        canAnswerInteraction(authority) &&
        hasPendingUserQuestion(deps, scope.thread.id)
      );
    case "interaction.approve":
      return (
        canApproveInteraction(authority) &&
        hasPendingApproval(deps, scope.thread.id)
      );
    case "read.mark":
      return true;
  }
}

function statusCapabilities(
  status: Thread["status"],
  authority: RoomCommandAuthority,
): string[] {
  switch (status) {
    case "idle":
      return ["message.send"];
    case "starting":
      return authority.role === "owner" || authority.isTaskAssignee
        ? ["thread.interrupt"]
        : [];
    case "active":
      return [
        "message.send",
        "message.steer",
        ...(authority.role === "owner" || authority.isTaskAssignee
          ? ["thread.interrupt"]
          : []),
      ];
    default:
      return [];
  }
}

/**
 * Closed Room mutation adapter. It owns strict decoding, current WT authority
 * reads, Principal attribution, capability parity, and BB admission receipts.
 */
export function createBindingBackedRoomCommandHandler(
  deps: AppDeps,
  authorityPort: WorkTogetherRoomCommandAuthorityPortV1,
) {
  async function currentAuthority(scope: RoomCommandScope) {
    return authorityPort.read({
      bindingId: scope.bindingId,
      workspaceId: scope.workspaceId,
      taskId: scope.taskId,
      principal: scope.principal,
    });
  }

  return Object.freeze({
    async capabilities(scope: RoomCommandScope): Promise<string[]> {
      const authority = await currentAuthority(scope);
      const capabilities = statusCapabilities(scope.thread.status, authority);
      if (
        canAnswerInteraction(authority) &&
        hasPendingUserQuestion(deps, scope.thread.id)
      ) {
        capabilities.push("interaction.answer");
      }
      if (
        canApproveInteraction(authority) &&
        hasPendingApproval(deps, scope.thread.id)
      ) {
        capabilities.push("interaction.approve");
      }
      capabilities.push("read.mark");
      return capabilities;
    },

    async execute(
      scope: RoomCommandScope,
      rawCommand: RoomJsonObject,
    ): Promise<RoomDistributionCommandResultV1> {
      const command = decodeCommand(rawCommand);
      // Exact replay / identity conflict are decided from the durable ledger
      // before capability availability, so a resolved interaction or post-
      // interrupt thread status cannot suppress already-accepted receipts.
      const existingAdmission = getThreadCommandAdmission(deps.db, {
        threadId: scope.thread.id,
        requestId: command.requestId,
      });
      if (existingAdmission !== null) {
        if (
          existingAdmission.commandKind === commandKind(command) &&
          existingAdmission.requestFingerprint ===
            commandFingerprint(command) &&
          existingAdmission.actor.principalId === scope.principal.id &&
          existingAdmission.actor.principalKind === scope.principal.kind
        ) {
          return Object.freeze({
            status: 200,
            body: commandReceipt({
              admission: existingAdmission,
              kind: "replayed",
            }),
          });
        }
        return rejectedReceipt(command, "request_identity_conflict");
      }
      const authority = await currentAuthority(scope);
      if (!commandAvailable(deps, command, scope, authority)) unavailable();
      const actor = actorStampFromPrincipal(scope.principal);
      let result;
      try {
        switch (command.kind) {
          case "message.send":
            result = await admitQueueIfActiveSendMessage(deps, {
              actor,
              payload: {
                input: [{ type: "text", text: command.text, mentions: [] }],
                mode: "queue-if-active",
              },
              requestId: command.requestId,
              thread: scope.thread,
            });
            break;
          case "message.steer":
            result = await admitExactSteerMessage(deps, {
              actor,
              payload: {
                expectedTurnId: command.expectedTurnId,
                input: [{ type: "text", text: command.text, mentions: [] }],
                requestId: command.requestId,
              },
              thread: scope.thread,
            });
            break;
          case "thread.interrupt":
            result = await admitExactInterrupt(deps, {
              actor,
              payload: {
                expectedTurnId: command.expectedTurnId,
                requestId: command.requestId,
              },
              thread: scope.thread,
            });
            break;
          case "interaction.answer":
            result = await admitInteractionAnswer(deps, {
              actor,
              payload: {
                interactionId: command.interactionId,
                requestId: command.requestId,
                resolution: command.resolution,
              },
              thread: scope.thread,
            });
            break;
          case "interaction.approve":
            result = await admitInteractionApprove(deps, {
              actor,
              payload: {
                interactionId: command.interactionId,
                requestId: command.requestId,
                resolution: command.resolution,
              },
              thread: scope.thread,
            });
            break;
          case "read.mark":
            result = await admitReadMark(deps, {
              actor,
              payload: {
                eventCursor: command.eventCursor,
                requestId: command.requestId,
              },
              thread: scope.thread,
            });
            break;
        }
      } catch (error) {
        const recovered = exactRecoveredAdmission(deps, scope, command);
        if (recovered !== null) {
          return Object.freeze({
            status: 200,
            body: commandReceipt({ admission: recovered, kind: "replayed" }),
          });
        }
        if (error instanceof ApiError) {
          return rejectedReceipt(command, rejectionReason(error));
        }
        deps.logger.warn(
          { err: error, commandKind: command.kind },
          "Room command outcome is indeterminate",
        );
        return Object.freeze({
          status: 200,
          body: {
            schemaVersion: 1,
            outcome: "indeterminate",
            requestId: command.requestId,
            commandKind: command.kind,
          },
        });
      }
      return Object.freeze({
        status: result.kind === "accepted" ? 202 : 200,
        body: commandReceipt(result),
      });
    },
  });
}
