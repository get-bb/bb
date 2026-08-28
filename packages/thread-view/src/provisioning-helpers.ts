import { jsonObjectSchema, type ProvisioningTranscriptEntry } from "@bb/domain";
import type {
  EventProjectionOperationMessage,
  EventProjectionProvisioningMetadata,
  EventProjectionProvisioningTranscriptEntry,
} from "./event-projection-types.js";

export function readProvisioningTranscript(
  entries: ProvisioningTranscriptEntry[] | undefined,
): EventProjectionProvisioningTranscriptEntry[] | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;

  const result: EventProjectionProvisioningTranscriptEntry[] = [];
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) continue;

    const text = entry.text.trim();
    if (!text) continue;

    if (entry.type === "step") {
      const resultEntry: EventProjectionProvisioningTranscriptEntry = {
        type: "step",
        key,
        text,
        status: entry.status ?? "started",
      };
      if (entry.startedAt !== undefined)
        resultEntry.startedAt = entry.startedAt;
      if (entry.metadata) {
        const metadata = jsonObjectSchema.safeParse(entry.metadata);
        if (metadata.success) resultEntry.metadata = metadata.data;
      }
      result.push(resultEntry);
    } else if (entry.type === "output") {
      const resultEntry: EventProjectionProvisioningTranscriptEntry = {
        type: "output",
        key,
        text,
      };
      if (entry.startedAt !== undefined)
        resultEntry.startedAt = entry.startedAt;
      if (entry.metadata) {
        const metadata = jsonObjectSchema.safeParse(entry.metadata);
        if (metadata.success) resultEntry.metadata = metadata.data;
      }
      result.push(resultEntry);
    }
  }

  return result.length > 0 ? result : undefined;
}

export function provisioningKey(
  message: EventProjectionOperationMessage,
): string {
  return message.provisioning?.provisioningId ?? message.id;
}

export function provisioningTitleForStatus(
  status: EventProjectionOperationMessage["status"],
): string {
  switch (status) {
    case "completed":
      return "Provisioned thread";
    case "error":
      return "Provisioning thread failed";
    case "interrupted":
      return "Provisioning thread interrupted";
    case "pending":
    case undefined:
      return "Provisioning thread";
  }
}

function mergeProvisioningTranscript(
  existing: EventProjectionProvisioningTranscriptEntry[] | undefined,
  incoming: EventProjectionProvisioningTranscriptEntry[] | undefined,
): EventProjectionProvisioningTranscriptEntry[] | undefined {
  if (!incoming) {
    return existing?.map((entry) => ({ ...entry }));
  }
  if (!existing) {
    return incoming.map((entry) => ({ ...entry }));
  }

  return [
    ...existing.map((entry) => ({ ...entry })),
    ...incoming.map((entry) => ({ ...entry })),
  ];
}

export function mergeProvisioningMetadata(
  existing: EventProjectionProvisioningMetadata | undefined,
  incoming: EventProjectionProvisioningMetadata | undefined,
): EventProjectionProvisioningMetadata | undefined {
  if (!incoming) {
    return existing ? { ...existing } : undefined;
  }
  if (!existing) {
    const result = { ...incoming };
    if (incoming.transcript) {
      result.transcript = mergeProvisioningTranscript(
        undefined,
        incoming.transcript,
      );
    }
    return result;
  }

  const transcript = mergeProvisioningTranscript(
    existing.transcript,
    incoming.transcript,
  );
  const result: EventProjectionProvisioningMetadata = {
    environmentId: incoming.environmentId ?? existing.environmentId,
    provisioningId: incoming.provisioningId,
  };
  if (transcript) result.transcript = transcript;
  return result;
}
