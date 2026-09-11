import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeDraftSubmissionReceipt,
  createConnection,
  createDraft,
  createDraftSubmissionReceipt,
  createProject,
  createThread,
  deleteDraft,
  drafts,
  failDraftSubmissionReceipt,
  getDraft,
  getDraftSubmissionReceipt,
  getStoredDraft,
  listDrafts,
  migrate,
  noopNotifier,
  projects,
  threads,
  updateDraft,
  upsertHost,
  type CreateDraftInput,
  type DbConnection,
} from "../../src/index.js";

function draftInput(
  overrides: Partial<CreateDraftInput> = {},
): CreateDraftInput {
  return {
    id: "draft_one",
    projectId: "project_missing",
    payloadJson: '{"text":"Remember this"}',
    creationFingerprint: "initial-payload-fingerprint",
    searchText: "Remember this",
    hasInput: true,
    ...overrides,
  };
}

function createProjectFixture(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, {
    name: "Draft storage host",
    type: "persistent",
  });
  return createProject(db, noopNotifier, {
    name: "Draft storage project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/draft-storage" },
  }).project;
}

const listInput = { includeEmpty: false, limit: 50, offset: 0 };

describe("draft resources", () => {
  let db: DbConnection;

  beforeEach(() => {
    db = createConnection(":memory:");
    migrate(db);
  });

  afterEach(() => {
    db.$client.close();
  });

  it("replays stable-ID creation without overwriting contents or identity", () => {
    const initial = createDraft(db, draftInput());
    const changed = updateDraft(db, {
      ...draftInput({ payloadJson: '{"text":"A newer edit"}' }),
      expectedRevision: initial.revision,
    });
    expect(changed?.revision).toBe(2);
    expect(
      createDraft(
        db,
        draftInput({
          payloadJson: '{"text":"A conflicting create"}',
          creationFingerprint: "different-fingerprint",
        }),
      ),
    ).toEqual(changed);
    expect(getStoredDraft(db, initial.id)?.creationFingerprint).toBe(
      initial.creationFingerprint,
    );
  });

  it("preserves blank identities while excluding them from the saved list", () => {
    const blank = createDraft(
      db,
      draftInput({
        projectId: null,
        payloadJson: '{"text":"","providerId":"chosen-provider"}',
        searchText: "",
        hasInput: false,
      }),
    );
    expect(getDraft(db, blank.id)).toEqual(blank);
    expect(listDrafts(db, listInput)).toEqual([]);
    expect(listDrafts(db, { ...listInput, includeEmpty: true })).toEqual([
      blank,
    ]);
  });

  it("rejects stale update and delete snapshots and never resurrects a tombstone", () => {
    const initial = createDraft(db, draftInput());
    const otherClient = getDraft(db, initial.id);
    expect(otherClient).not.toBeNull();
    const changed = updateDraft(db, {
      ...draftInput({ payloadJson: '{"text":"Winning edit"}' }),
      expectedRevision: initial.revision,
    });
    expect(changed?.revision).toBe(2);
    expect(
      updateDraft(db, {
        ...draftInput({ payloadJson: '{"text":"Stale edit"}' }),
        expectedRevision: otherClient!.revision,
      }),
    ).toBeNull();
    expect(
      deleteDraft(db, {
        id: initial.id,
        expectedRevision: otherClient!.revision,
      }),
    ).toBeNull();
    expect(getDraft(db, initial.id)).toEqual(changed);

    const deleted = deleteDraft(db, {
      id: initial.id,
      expectedRevision: changed!.revision,
    });
    expect(deleted).toMatchObject({
      revision: 3,
      payloadJson: null,
      searchText: "",
      hasInput: false,
      deletedAt: expect.any(Number),
      creationFingerprint: initial.creationFingerprint,
    });
    expect(getDraft(db, initial.id)).toBeNull();
    expect(listDrafts(db, { ...listInput, includeEmpty: true })).toEqual([]);
    expect(createDraft(db, draftInput())).toEqual(deleted);
    expect(
      updateDraft(db, {
        ...draftInput(),
        expectedRevision: changed!.revision,
      }),
    ).toBeNull();
    expect(
      updateDraft(db, {
        ...draftInput(),
        expectedRevision: deleted!.revision,
      }),
    ).toBeNull();
    expect(
      deleteDraft(db, { id: initial.id, expectedRevision: deleted!.revision }),
    ).toBeNull();
    expect(getStoredDraft(db, initial.id)).toEqual(deleted);
  });

  it("filters literal queries and destinations before ordering and pagination", () => {
    for (const input of [
      draftInput({
        id: "draft_a",
        projectId: "project_a",
        searchText: "100% _Alpha",
      }),
      draftInput({
        id: "draft_b",
        projectId: "project_a",
        searchText: "100% _Beta",
      }),
      draftInput({
        id: "draft_c",
        projectId: "project_a",
        searchText: "100 percent",
      }),
      draftInput({
        id: "draft_d",
        projectId: "project_b",
        searchText: "100% _Alpha",
      }),
      draftInput({
        id: "draft_e",
        projectId: null,
        searchText: "100% _Alpha",
      }),
      draftInput({
        id: "draft_empty",
        projectId: "project_a",
        hasInput: false,
      }),
      draftInput({
        id: "draft_deleted",
        projectId: "project_a",
        searchText: "100% _Alpha",
      }),
      draftInput({
        id: "draft_submitted",
        projectId: "project_a",
        searchText: "100% _Alpha",
      }),
    ]) {
      createDraft(db, input);
    }
    deleteDraft(db, { id: "draft_deleted", expectedRevision: 1 });
    createDraftSubmissionReceipt(db, {
      draftId: "draft_submitted",
      revision: 1,
      threadId: "thread_submitted",
    });
    completeDraftSubmissionReceipt(db, {
      draftId: "draft_submitted",
      revision: 1,
    });
    db.update(drafts).set({ updatedAt: 100 }).run();
    db.update(drafts)
      .set({ updatedAt: 200 })
      .where(eq(drafts.id, "draft_a"))
      .run();

    const filtered = { ...listInput, projectId: "project_a", query: "100% _" };
    expect(listDrafts(db, filtered).map((row) => row.id)).toEqual([
      "draft_a",
      "draft_b",
    ]);
    expect(
      listDrafts(db, { ...filtered, limit: 1, offset: 1 }).map((row) => row.id),
    ).toEqual(["draft_b"]);
    expect(
      listDrafts(db, { ...listInput, projectId: null }).map((row) => row.id),
    ).toEqual(["draft_e"]);
    expect(
      listDrafts(db, { ...listInput, query: "ALPHA" }).map((row) => row.id),
    ).toEqual(["draft_a", "draft_e", "draft_d"]);
  });

  it("retains a draft's destination and contents when its project is removed", () => {
    const project = createProjectFixture(db);
    const draft = createDraft(db, draftInput({ projectId: project.id }));
    db.delete(projects).where(eq(projects.id, project.id)).run();
    expect(getDraft(db, draft.id)).toEqual(draft);
  });

  it("preserves receipt identity even if the created thread is later removed", () => {
    const project = createProjectFixture(db);
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const draft = createDraft(db, draftInput({ projectId: project.id }));
    const identity = { draftId: draft.id, revision: draft.revision };
    const receipt = createDraftSubmissionReceipt(db, {
      ...identity,
      threadId: thread.id,
    });
    expect(
      createDraftSubmissionReceipt(db, {
        ...identity,
        threadId: "thread_retry",
      }),
    ).toEqual(receipt);
    db.delete(threads).where(eq(threads.id, thread.id)).run();
    expect(getDraftSubmissionReceipt(db, identity)).toEqual(receipt);
  });

  it("rolls receipt creation back with its enclosing transaction", () => {
    const draft = createDraft(db, draftInput());
    const identity = { draftId: draft.id, revision: draft.revision };
    expect(() =>
      db.transaction((tx) => {
        createDraftSubmissionReceipt(tx, {
          ...identity,
          threadId: "thread_one",
        });
        throw new Error("Thread creation failed");
      }),
    ).toThrow("Thread creation failed");
    expect(getDraftSubmissionReceipt(db, identity)).toBeNull();
    expect(getDraft(db, draft.id)).toEqual(draft);
  });

  it("consumes matching contents once and prevents subsequent stale writes", () => {
    const draft = createDraft(db, draftInput());
    const identity = { draftId: draft.id, revision: draft.revision };
    createDraftSubmissionReceipt(db, { ...identity, threadId: "thread_one" });
    const receipt = completeDraftSubmissionReceipt(db, identity);
    expect(receipt?.status).toBe("submitted");
    expect(getDraft(db, draft.id)).toBeNull();
    const consumed = getStoredDraft(db, draft.id);
    expect(consumed).toMatchObject({
      revision: 2,
      payloadJson: null,
      searchText: "",
      hasInput: false,
      submittedAt: expect.any(Number),
    });
    expect(completeDraftSubmissionReceipt(db, identity)).toEqual(receipt);
    expect(failDraftSubmissionReceipt(db, identity)).toEqual(receipt);
    expect(createDraft(db, draftInput())).toEqual(consumed);
    expect(
      updateDraft(db, { ...draftInput(), expectedRevision: draft.revision }),
    ).toBeNull();
    expect(getStoredDraft(db, draft.id)).toEqual(consumed);
  });

  it("completes an older receipt while keeping newer edits live", () => {
    const draft = createDraft(db, draftInput());
    const identity = { draftId: draft.id, revision: draft.revision };
    createDraftSubmissionReceipt(db, { ...identity, threadId: "thread_one" });
    const newer = updateDraft(db, {
      ...draftInput({ payloadJson: '{"text":"Keep my next thought"}' }),
      expectedRevision: draft.revision,
    });
    expect(completeDraftSubmissionReceipt(db, identity)?.status).toBe(
      "submitted",
    );
    expect(getDraft(db, draft.id)).toEqual(newer);
    expect(listDrafts(db, listInput)).toEqual([newer]);
    completeDraftSubmissionReceipt(db, identity);
    expect(getDraft(db, draft.id)).toEqual(newer);
  });

  it("does not change a deleted draft when an older submission completes", () => {
    const draft = createDraft(db, draftInput());
    const identity = { draftId: draft.id, revision: draft.revision };
    createDraftSubmissionReceipt(db, { ...identity, threadId: "thread_one" });
    const deleted = deleteDraft(db, {
      id: draft.id,
      expectedRevision: draft.revision,
    });
    expect(completeDraftSubmissionReceipt(db, identity)?.status).toBe(
      "submitted",
    );
    expect(getStoredDraft(db, draft.id)).toEqual(deleted);
  });

  it("leaves failed contents intact and keeps terminal receipts immutable", () => {
    const draft = createDraft(db, draftInput());
    const identity = { draftId: draft.id, revision: draft.revision };
    createDraftSubmissionReceipt(db, { ...identity, threadId: "thread_one" });
    const failed = failDraftSubmissionReceipt(db, identity);
    expect(failed?.status).toBe("failed");
    expect(completeDraftSubmissionReceipt(db, identity)).toEqual(failed);
    expect(getDraft(db, draft.id)).toEqual(draft);
    expect(
      createDraftSubmissionReceipt(db, {
        ...identity,
        threadId: "thread_retry",
      }),
    ).toEqual(failed);
    const next = updateDraft(db, {
      ...draftInput(),
      expectedRevision: draft.revision,
    });
    expect(
      createDraftSubmissionReceipt(db, {
        draftId: draft.id,
        revision: next!.revision,
        threadId: "thread_next_revision",
      }),
    ).toMatchObject({ status: "pending", threadId: "thread_next_revision" });
  });
});
