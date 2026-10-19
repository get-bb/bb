import {
  pendingInteractionSchema,
  type PendingInteraction,
  type ServerApprovalPendingInteraction,
} from "@bb/domain";
import type { PendingInteractionRow } from "@bb/db";
import { ApiError } from "../../errors.js";

export class PendingInteractionSerializationError extends ApiError {
  readonly interactionId: string;
  readonly field: "payload" | "resolution";

  constructor(interactionId: string, field: "payload" | "resolution") {
    super(
      500,
      "internal_error",
      `Stored pending interaction ${field} is invalid`,
    );
    this.interactionId = interactionId;
    this.field = field;
  }
}

function parseStoredPendingInteractionJson(
  row: PendingInteractionRow,
  field: "payload" | "resolution",
): unknown {
  const value = field === "payload" ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

function splitServerPayload(payload: unknown): {
  payload: unknown;
  request: unknown;
} {
  if (payload === null || typeof payload !== "object") {
    return { payload, request: undefined };
  }
  const { request, ...approvalPayload } = payload as Record<string, unknown>;
  return { payload: approvalPayload, request };
}

export function serializeServerApprovalPayload(
  interaction: Pick<ServerApprovalPendingInteraction, "payload" | "request">,
): string {
  return JSON.stringify({
    ...interaction.payload,
    request: interaction.request,
  });
}

function serverApprovalFields(storedPayload: unknown): {
  origin: { kind: "server" };
  payload: unknown;
  request: unknown;
} {
  return {
    origin: { kind: "server" },
    ...splitServerPayload(storedPayload),
  };
}

function nonServerOrigin(row: PendingInteractionRow) {
  return row.originKind === "provider"
    ? {
        kind: "provider",
        providerId: row.providerId,
        providerThreadId: row.providerThreadId,
        providerRequestId: row.providerRequestId,
      }
    : {
        kind: "plugin",
        pluginId: row.pluginId,
        rendererId: row.rendererId,
      };
}

export function toPendingInteraction(
  row: PendingInteractionRow,
): PendingInteraction {
  const storedPayload = parseStoredPendingInteractionJson(row, "payload");
  const resolution =
    row.resolution === null
      ? null
      : parseStoredPendingInteractionJson(row, "resolution");
  const originFields =
    row.originKind === "server"
      ? serverApprovalFields(storedPayload)
      : { origin: nonServerOrigin(row), payload: storedPayload };

  try {
    return pendingInteractionSchema.parse({
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      ...(row.originKind === "provider"
        ? {
            providerId: row.providerId,
            providerThreadId: row.providerThreadId,
            providerRequestId: row.providerRequestId,
          }
        : {}),
      ...originFields,
      status: row.status,
      resolution,
      statusReason: row.statusReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt,
    });
  } catch {
    throw new PendingInteractionSerializationError(row.id, "payload");
  }
}
