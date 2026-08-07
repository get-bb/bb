import { getThreadCommandAdmission } from "@bb/db";
import {
  clientTurnRequestIdSchema,
  type ClientTurnRequestId,
  type PersistedThreadCommandAdmission,
  type Principal,
  type Thread,
} from "@bb/domain";

import { ApiError } from "../errors.js";
import { actorStampFromPrincipal } from "../services/actor-stamp.js";
import { admitQueueIfActiveSendMessage } from "../services/threads/admitted-send.js";
import { admitExactInterrupt } from "../services/threads/admitted-interrupt.js";
import { admitExactSteerMessage } from "../services/threads/admitted-steer.js";
import {
  fingerprintMessageSendRequest,
  fingerprintMessageSteerRequest,
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
const MAX_TURN_ID_CODE_POINTS = 256;

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

type SupportedRoomCommand =
  | RoomMessageSendCommand
  | RoomMessageSteerCommand
  | RoomThreadInterruptCommand;

type RoomCommandScope = Readonly<{
  bindingId: string;
  principal: Principal;
  taskId: string;
  thread: Thread;
  workspaceId: string;
}>;

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
    default:
      return "unavailable";
  }
}

function commandAvailable(
  command: SupportedRoomCommand,
  scope: RoomCommandScope,
  authority: Awaited<
    ReturnType<WorkTogetherRoomCommandAuthorityPortV1["read"]>
  >,
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
      switch (scope.thread.status) {
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
    },

    async execute(
      scope: RoomCommandScope,
      rawCommand: RoomJsonObject,
    ): Promise<RoomDistributionCommandResultV1> {
      const command = decodeCommand(rawCommand);
      const authority = await currentAuthority(scope);
      if (!commandAvailable(command, scope, authority)) unavailable();
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
