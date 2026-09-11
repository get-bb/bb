import { createHash, randomUUID } from "node:crypto";
import { createDraft, getDraft, getStoredDraft, type DraftRow } from "@bb/db";
import {
  draftContentSchema,
  type Draft,
  type DraftContent,
  type DraftCreateResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

export function toDraft(row: DraftRow): Draft {
  if (row.payloadJson === null) {
    throw new ApiError(410, "draft_gone", "Draft was deleted or submitted");
  }
  const payload: unknown = JSON.parse(row.payloadJson);
  return {
    id: row.id,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    content: draftContentSchema.parse(payload),
  };
}

export function requireDraft(deps: Pick<AppDeps, "db">, id: string): Draft {
  const row = getDraft(deps.db, id);
  if (row !== null) return toDraft(row);
  if (getStoredDraft(deps.db, id) !== null) {
    throw new ApiError(410, "draft_gone", "Draft was deleted or submitted");
  }
  throw new ApiError(404, "draft_not_found", "Draft not found");
}

export function draftStorageFields(content: DraftContent) {
  const { prompt } = content;
  return {
    projectId: content.projectId,
    payloadJson: JSON.stringify(content),
    searchText: [
      prompt.text,
      ...prompt.attachments.map((attachment) => attachment.name),
    ].join("\n"),
    hasInput:
      prompt.text.length > 0 ||
      prompt.mentions.length > 0 ||
      prompt.attachments.length > 0,
  };
}

export function requireDraftRevision(
  deps: Pick<AppDeps, "db">,
  id: string,
  expectedRevision: number,
): Draft {
  const current = requireDraft(deps, id);
  if (current.revision !== expectedRevision) {
    throw new ApiError(
      409,
      "draft_revision_conflict",
      "Draft changed. Read the current revision before saving or submitting.",
      { details: { draft: current } },
    );
  }
  return current;
}

export function createDraftResource(
  deps: Pick<AppDeps, "db" | "hub">,
  args: { id?: string; content: DraftContent },
): DraftCreateResponse {
  const fields = draftStorageFields(args.content);
  const creationFingerprint = createHash("sha256")
    .update(fields.payloadJson)
    .digest("hex");
  const row = createDraft(deps.db, {
    id: args.id ?? `drf_${randomUUID()}`,
    ...fields,
    creationFingerprint,
  });
  if (row.creationFingerprint !== creationFingerprint) {
    throw new ApiError(
      409,
      "draft_identity_conflict",
      "This draft ID already belongs to a different creation request",
    );
  }
  deps.hub.notifySystem(["drafts-changed"]);
  return {
    id: row.id,
    draft:
      row.deletedAt === null && row.submittedAt === null ? toDraft(row) : null,
  };
}
