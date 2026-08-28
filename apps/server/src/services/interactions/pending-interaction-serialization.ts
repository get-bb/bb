import {
  jsonValueSchema,
  pendingInteractionSchema,
  type JsonValue,
  type PendingInteraction,
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
): JsonValue {
  const value = field === "payload" ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return jsonValueSchema.parse(JSON.parse(value));
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

export function toPendingInteraction(
  row: PendingInteractionRow,
): PendingInteraction {
  let payload: JsonValue;
  try {
    payload = parseStoredPendingInteractionJson(row, "payload");
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "payload");
  }

  let resolution: JsonValue | null;
  try {
    resolution =
      row.resolution === null
        ? null
        : parseStoredPendingInteractionJson(row, "resolution");
  } catch (error) {
    if (error instanceof PendingInteractionSerializationError) {
      throw error;
    }
    throw new PendingInteractionSerializationError(row.id, "resolution");
  }

  try {
    const data = {
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      status: row.status,
      payload,
      resolution,
      statusReason: row.statusReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt,
    };
    if (row.originKind === "provider") {
      return pendingInteractionSchema.parse({
        ...data,
        providerId: row.providerId,
        providerThreadId: row.providerThreadId,
        providerRequestId: row.providerRequestId,
        origin: {
          kind: "provider",
          providerId: row.providerId,
          providerThreadId: row.providerThreadId,
          providerRequestId: row.providerRequestId,
        },
      });
    }
    return pendingInteractionSchema.parse({
      ...data,
      origin: {
        kind: "plugin",
        pluginId: row.pluginId,
        rendererId: row.rendererId,
      },
    });
  } catch {
    throw new PendingInteractionSerializationError(row.id, "payload");
  }
}
