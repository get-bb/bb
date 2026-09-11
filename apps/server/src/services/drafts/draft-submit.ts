import { promptDraftToInput } from "@bb/client-core";
import {
  completeDraftSubmissionReceipt,
  deleteThread,
  failDraftSubmissionReceipt,
  getDraft,
  getDraftSubmissionReceipt,
  getThread,
  hasQueuedThreadMessages,
  type DbConnection,
  type DraftSubmissionReceiptRow,
} from "@bb/db";
import {
  createThreadRequestSchema,
  type Draft,
  type DraftSubmitResponse,
  type ThreadCreateOrigin,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
import { toThreadResponseFromThread } from "../threads/thread-runtime-display.js";
import { requireDraftRevision, toDraft } from "./draft-records.js";
import type { DraftSubmissionSource } from "./draft-thread-record.js";

interface SubmitDraftArgs extends DraftSubmissionSource {
  origin: ThreadCreateOrigin;
  originPluginId?: string;
}

const submissions = new WeakMap<
  DbConnection,
  Map<string, Promise<DraftSubmitResponse>>
>();

function remainingDraft(deps: Pick<AppDeps, "db">, id: string): Draft | null {
  const row = getDraft(deps.db, id);
  return row === null ? null : toDraft(row);
}

function failedSubmission(): never {
  throw new ApiError(
    409,
    "draft_submission_failed",
    "Submission did not complete. The draft was preserved. Save a new revision before submitting again.",
  );
}

function readSubmission(
  deps: AppDeps,
  receipt: DraftSubmissionReceiptRow,
): DraftSubmitResponse {
  if (receipt.status === "failed") return failedSubmission();
  const thread = getThread(deps.db, receipt.threadId);
  if (receipt.status === "pending") {
    if (
      thread === null ||
      (thread.status === "pending" &&
        !hasQueuedThreadMessages(deps.db, thread.id))
    ) {
      if (thread !== null) deleteThread(deps.db, deps.hub, thread.id);
      failDraftSubmissionReceipt(deps.db, receipt);
      return failedSubmission();
    }
    completeDraftSubmissionReceipt(deps.db, receipt);
    deps.hub.notifySystem(["drafts-changed"]);
  }
  if (thread === null || thread.deletedAt !== null) {
    throw new ApiError(
      410,
      "draft_submitted_thread_gone",
      "This draft revision was submitted, but its thread has since been deleted",
      { details: { threadId: receipt.threadId } },
    );
  }
  return {
    thread: toThreadResponseFromThread(deps, { thread }),
    draft: remainingDraft(deps, receipt.draftId),
  };
}

async function performSubmission(
  deps: AppDeps,
  args: SubmitDraftArgs,
): Promise<DraftSubmitResponse> {
  const receipt = getDraftSubmissionReceipt(deps.db, args);
  if (receipt !== null) return readSubmission(deps, receipt);
  const draft = requireDraftRevision(deps, args.draftId, args.revision);
  const { content } = draft;
  const { options } = content;
  const request = createThreadRequestSchema.safeParse({
    projectId: content.projectId,
    sectionId: content.sectionId,
    input: promptDraftToInput(content.prompt),
    origin: args.origin,
    originPluginId: args.originPluginId,
    environment: options.environment,
    providerId: options.providerId ?? undefined,
    model: options.model ?? undefined,
    reasoningLevel: options.reasoningLevel ?? undefined,
    serviceTier: options.serviceTier ?? undefined,
    permissionMode: options.permissionMode ?? undefined,
    title: options.title ?? undefined,
    parentThreadId: options.parentThreadId ?? undefined,
    sourceThreadId: options.sourceThreadId ?? undefined,
    sourceSeqEnd: options.sourceSeqEnd ?? undefined,
    originKind: options.originKind,
    sendAt: options.sendAt ?? undefined,
  });
  if (!request.success) {
    throw new ApiError(
      400,
      "draft_not_ready",
      "Choose a project, environment and prompt before submitting the draft",
      { details: request.error.issues },
    );
  }
  const thread = await createThreadFromRequest(deps, request.data, {
    draftSubmission: { draftId: args.draftId, revision: args.revision },
  });
  completeDraftSubmissionReceipt(deps.db, {
    draftId: args.draftId,
    revision: args.revision,
  });
  deps.hub.notifySystem(["drafts-changed"]);
  return {
    thread: toThreadResponseFromThread(deps, { thread }),
    draft: remainingDraft(deps, args.draftId),
  };
}

export async function submitDraft(
  deps: AppDeps,
  args: SubmitDraftArgs,
): Promise<DraftSubmitResponse> {
  let pending = submissions.get(deps.db);
  if (pending === undefined) {
    pending = new Map();
    submissions.set(deps.db, pending);
  }
  const key = `${args.draftId}:${args.revision}`;
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const submission = performSubmission(deps, args);
  pending.set(key, submission);
  try {
    return await submission;
  } finally {
    pending.delete(key);
  }
}
