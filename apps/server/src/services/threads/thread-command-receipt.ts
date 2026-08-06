import type { PersistedThreadCommandAdmission } from "@bb/domain";
import {
  threadCommandAdmissionReceiptBodySchema,
  threadCommandAdmissionReceiptSchema,
  type ThreadCommandAdmissionReceipt,
  type ThreadCommandAdmissionReceiptBody,
} from "@bb/server-contract";

/**
 * Maps a durable ledger admission into the browser-safe public receipt body.
 * Omits the normalized fingerprint.
 */
export function threadCommandAdmissionReceiptBodyFromPersisted(
  admission: PersistedThreadCommandAdmission,
): ThreadCommandAdmissionReceiptBody {
  return threadCommandAdmissionReceiptBodySchema.parse({
    requestId: admission.requestId,
    commandKind: admission.commandKind,
    admissionSequence: admission.admissionSequence,
    result: admission.result,
    createdAt: admission.createdAt,
    completedAt: admission.completedAt,
  });
}

/**
 * Maps a durable ledger admission into a POST receipt with accepted/replayed.
 */
export function threadCommandAdmissionReceiptFromPersisted(args: {
  admission: PersistedThreadCommandAdmission;
  kind: "accepted" | "replayed";
}): ThreadCommandAdmissionReceipt {
  return threadCommandAdmissionReceiptSchema.parse({
    kind: args.kind,
    ...threadCommandAdmissionReceiptBodyFromPersisted(args.admission),
  });
}
