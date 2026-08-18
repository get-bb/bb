import { randomUUID } from "node:crypto";

import {
  admitThreadCommand,
  getWorkTogetherRoomResourceReservation,
  threadCommandAdmissions,
  type AdmitThreadCommandOutcome,
} from "@bb/db";
import type {
  ActorStamp,
  ClientTurnRequestId,
  JsonObject,
  PersistedThreadCommandAdmission,
  Thread,
} from "@bb/domain";
import { and, eq, max } from "drizzle-orm";

import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { hashCanonicalJsonFingerprint } from "./canonical-json-fingerprint.js";
import { parseWorkResultSubmission } from "./work-result-submission.js";

export type AdmitResultPublishArgs = Readonly<{
  actor: ActorStamp;
  bindingId: string;
  payload: Readonly<{
    requestId: ClientTurnRequestId;
    submission: JsonObject;
  }>;
  thread: Thread;
}>;

export type AdmitResultPublishResult = Readonly<{
  kind: "accepted" | "replayed";
  admission: PersistedThreadCommandAdmission;
}>;

function identityConflict(): never {
  throw new ApiError(
    409,
    "thread_command_admission_conflict",
    "Thread command request identity conflicts with an existing admission",
  );
}

export function admitResultPublish(
  deps: Pick<AppDeps, "db">,
  args: AdmitResultPublishArgs,
): AdmitResultPublishResult {
  const reservation = getWorkTogetherRoomResourceReservation(
    deps.db,
    args.bindingId,
  );
  if (reservation === null || reservation.primaryThreadId !== args.thread.id) {
    throw new ApiError(404, "not_found", "Room result publication unavailable");
  }
  const submission = parseWorkResultSubmission(args.payload.submission, {
    workKind: reservation.workKind,
    environmentTemplate: reservation.environmentTemplate,
    repositorySnapshotId: reservation.repositorySnapshotId,
    objectFormat: reservation.objectFormat,
    baseRevision: reservation.baseRevision,
    generatedBranch: reservation.generatedBranch,
  });
  const requestFingerprint = hashCanonicalJsonFingerprint(
    submission,
    "result.publish",
  );
  const resultDigest = requestFingerprint.slice("sha256:".length);
  const nowMs = Date.now();
  const outcome: AdmitThreadCommandOutcome = admitThreadCommand({
    actor: args.actor,
    commandKind: "result.publish",
    db: deps.db,
    nowMs,
    requestFingerprint,
    requestId: args.payload.requestId,
    threadId: args.thread.id,
    execute: ({ tx }) => {
      const resultRevision =
        (tx
          .select({ value: max(threadCommandAdmissions.resultRevision) })
          .from(threadCommandAdmissions)
          .where(
            and(
              eq(threadCommandAdmissions.threadId, args.thread.id),
              eq(threadCommandAdmissions.commandKind, "result.publish"),
            ),
          )
          .get()?.value ?? 0) + 1;
      return {
        disposition: "result-published",
        resultId: randomUUID(),
        resultRevision,
        resultDigest,
        submission,
      };
    },
  });
  if (outcome.kind === "identity-conflict") identityConflict();
  return { kind: outcome.kind, admission: outcome.admission };
}
