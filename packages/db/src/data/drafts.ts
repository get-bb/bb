import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { DbQueryConnection } from "../connection.js";
import { drafts, draftSubmissionReceipts } from "../schema.js";

export type DraftRow = typeof drafts.$inferSelect;
export type DraftSubmissionReceiptRow =
  typeof draftSubmissionReceipts.$inferSelect;

interface DraftContents {
  projectId: string | null;
  payloadJson: string | null;
  searchText: string;
  hasInput: boolean;
}

export interface CreateDraftInput extends DraftContents {
  id: string;
  creationFingerprint: string;
}

export interface UpdateDraftInput extends DraftContents {
  id: string;
  expectedRevision: number;
}

export interface DeleteDraftInput {
  id: string;
  expectedRevision: number;
}

export interface ListDraftsInput {
  projectId?: string | null;
  query?: string;
  includeEmpty: boolean;
  limit: number;
  offset: number;
}

export interface DraftSubmissionIdentity {
  draftId: string;
  revision: number;
}

export interface CreateDraftSubmissionReceiptInput
  extends DraftSubmissionIdentity {
  threadId: string;
}

function liveDrafts(...conditions: (SQL | undefined)[]) {
  return and(
    ...conditions,
    isNull(drafts.deletedAt),
    isNull(drafts.submittedAt),
  );
}

export function getStoredDraft(
  db: DbQueryConnection,
  id: string,
): DraftRow | null {
  return db.select().from(drafts).where(eq(drafts.id, id)).get() ?? null;
}

export function getDraft(
  db: DbQueryConnection,
  id: string,
): DraftRow | null {
  return (
    db
      .select()
      .from(drafts)
      .where(liveDrafts(eq(drafts.id, id)))
      .get() ?? null
  );
}

export function createDraft(
  db: DbQueryConnection,
  input: CreateDraftInput,
): DraftRow {
  const now = Date.now();
  const created = db
    .insert(drafts)
    .values({
      ...input,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      submittedAt: null,
    })
    .onConflictDoNothing({ target: drafts.id })
    .returning()
    .get();
  if (created) return created;
  const existing = getStoredDraft(db, input.id);
  if (!existing) {
    throw new Error(`Draft ${input.id} disappeared after create`);
  }
  return existing;
}

export function listDrafts(
  db: DbQueryConnection,
  input: ListDraftsInput,
): DraftRow[] {
  return db
    .select()
    .from(drafts)
    .where(
      liveDrafts(
        input.projectId === undefined
          ? undefined
          : input.projectId === null
            ? isNull(drafts.projectId)
            : eq(drafts.projectId, input.projectId),
        input.includeEmpty ? undefined : eq(drafts.hasInput, true),
        input.query
          ? sql`instr(lower(${drafts.searchText}), lower(${input.query})) > 0`
          : undefined,
      ),
    )
    .orderBy(desc(drafts.updatedAt), desc(drafts.id))
    .limit(input.limit)
    .offset(input.offset)
    .all();
}

export function updateDraft(
  db: DbQueryConnection,
  input: UpdateDraftInput,
): DraftRow | null {
  return (
    db
      .update(drafts)
      .set({
        projectId: input.projectId,
        payloadJson: input.payloadJson,
        searchText: input.searchText,
        hasInput: input.hasInput,
        revision: sql`${drafts.revision} + 1`,
        updatedAt: Date.now(),
      })
      .where(
        liveDrafts(
          eq(drafts.id, input.id),
          eq(drafts.revision, input.expectedRevision),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function deleteDraft(
  db: DbQueryConnection,
  input: DeleteDraftInput,
): DraftRow | null {
  const now = Date.now();
  return (
    db
      .update(drafts)
      .set({
        payloadJson: null,
        searchText: "",
        hasInput: false,
        revision: sql`${drafts.revision} + 1`,
        deletedAt: now,
        updatedAt: now,
      })
      .where(
        liveDrafts(
          eq(drafts.id, input.id),
          eq(drafts.revision, input.expectedRevision),
        ),
      )
      .returning()
      .get() ?? null
  );
}

export function getDraftSubmissionReceipt(
  db: DbQueryConnection,
  input: DraftSubmissionIdentity,
): DraftSubmissionReceiptRow | null {
  return (
    db
      .select()
      .from(draftSubmissionReceipts)
      .where(
        and(
          eq(draftSubmissionReceipts.draftId, input.draftId),
          eq(draftSubmissionReceipts.revision, input.revision),
        ),
      )
      .get() ?? null
  );
}

export function createDraftSubmissionReceipt(
  db: DbQueryConnection,
  input: CreateDraftSubmissionReceiptInput,
): DraftSubmissionReceiptRow {
  const now = Date.now();
  const created = db
    .insert(draftSubmissionReceipts)
    .values({
      ...input,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        draftSubmissionReceipts.draftId,
        draftSubmissionReceipts.revision,
      ],
    })
    .returning()
    .get();
  if (created) return created;
  const existing = getDraftSubmissionReceipt(db, input);
  if (!existing) {
    throw new Error(
      `Draft submission ${input.draftId} disappeared after create`,
    );
  }
  return existing;
}

export function completeDraftSubmissionReceipt(
  db: DbQueryConnection,
  input: DraftSubmissionIdentity,
): DraftSubmissionReceiptRow | null {
  return db.transaction((tx) => {
    const now = Date.now();
    const completed = tx
      .update(draftSubmissionReceipts)
      .set({ status: "submitted", updatedAt: now })
      .where(
        and(
          eq(draftSubmissionReceipts.draftId, input.draftId),
          eq(draftSubmissionReceipts.revision, input.revision),
          eq(draftSubmissionReceipts.status, "pending"),
        ),
      )
      .returning()
      .get();
    if (!completed) return getDraftSubmissionReceipt(tx, input);
    tx.update(drafts)
      .set({
        payloadJson: null,
        searchText: "",
        hasInput: false,
        revision: sql`${drafts.revision} + 1`,
        submittedAt: now,
        updatedAt: now,
      })
      .where(
        liveDrafts(
          eq(drafts.id, input.draftId),
          eq(drafts.revision, input.revision),
        ),
      )
      .run();
    return completed;
  });
}

export function failDraftSubmissionReceipt(
  db: DbQueryConnection,
  input: DraftSubmissionIdentity,
): DraftSubmissionReceiptRow | null {
  return (
    db
      .update(draftSubmissionReceipts)
      .set({ status: "failed", updatedAt: Date.now() })
      .where(
        and(
          eq(draftSubmissionReceipts.draftId, input.draftId),
          eq(draftSubmissionReceipts.revision, input.revision),
          eq(draftSubmissionReceipts.status, "pending"),
        ),
      )
      .returning()
      .get() ?? getDraftSubmissionReceipt(db, input)
  );
}
