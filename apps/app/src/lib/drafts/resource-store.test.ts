import { afterEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  draftContentSchema,
  type Draft,
  type DraftContent,
  type DraftCreateResponse,
  type DraftSubmitResponse,
} from "@bb/server-contract";
import { makeThreadWithRuntime } from "@bb/test-helpers/domain-fixtures";
import { HttpError } from "../api";
import { DraftResourceStore } from "./resource-store";
import { draftResourceQueryKey, type DraftResourceApi } from "./resource-api";
import {
  DRAFT_RECOVERY_PREFIX,
  readDraftRecoveries,
  type DraftRecoveryStorage,
} from "./recovery";
import {
  importLegacyNewThreadDraft,
  LEGACY_DRAFT_IMPORT_PREFIX,
  LEGACY_NEW_THREAD_DRAFT_KEY,
} from "./legacy-import";

class RecoveryStorage implements DraftRecoveryStorage {
  values = new Map<string, string>();
  failWrites = false;
  failRemoves = false;
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemoves) throw new Error("storage unavailable");
    this.values.delete(key);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function createServer() {
  const records = new Map<string, Draft>();
  const originals = new Map<string, string>();
  const receipts = new Map<string, DraftSubmitResponse>();
  const creates: Array<{ id: string; content: DraftContent }> = [];
  const updates: Array<{
    id: string;
    revision: number;
    content: DraftContent;
  }> = [];
  const api: DraftResourceApi = {
    async get(id) {
      return records.get(id) ?? null;
    },
    async create(id, content) {
      creates.push({ id, content });
      const fingerprint = JSON.stringify(content);
      if (originals.has(id)) {
        if (originals.get(id) !== fingerprint)
          throw new HttpError({
            status: 409,
            code: "draft_create_conflict",
            message: "Different create",
          });
        return { id, draft: records.get(id) ?? null };
      }
      originals.set(id, fingerprint);
      const draft = { id, content, revision: 1, createdAt: 1, updatedAt: 1 };
      records.set(id, draft);
      return { id, draft };
    },
    async update(id, revision, content) {
      updates.push({ id, revision, content });
      const current = records.get(id);
      if (!current)
        throw new HttpError({ status: 404, message: "Missing draft" });
      if (current.revision !== revision)
        throw new HttpError({
          status: 409,
          code: "draft_revision_conflict",
          message: "Changed draft",
        });
      const next = {
        ...current,
        content,
        revision: revision + 1,
        updatedAt: revision + 1,
      };
      records.set(id, next);
      return next;
    },
    async delete(id, revision) {
      const current = records.get(id);
      if (!current)
        throw new HttpError({ status: 404, message: "Missing draft" });
      if (current.revision !== revision)
        throw new HttpError({
          status: 409,
          code: "draft_revision_conflict",
          message: "Changed draft",
        });
      records.delete(id);
    },
    async submit(id, revision) {
      const key = `${id}:${revision}`;
      const existing = receipts.get(key);
      if (existing) return existing;
      const current = records.get(id);
      if (!current || current.revision !== revision)
        throw new HttpError({
          status: 409,
          code: "draft_revision_conflict",
          message: "Changed draft",
        });
      records.delete(id);
      const response = {
        thread: makeThreadWithRuntime({ id: `thr_${receipts.size}` }),
        draft: null,
      };
      receipts.set(key, response);
      return response;
    },
  };
  return { api, records, originals, receipts, creates, updates };
}

const stores: DraftResourceStore[] = [];
const clients: QueryClient[] = [];

function fixture(server = createServer(), storage = new RecoveryStorage()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(queryClient);
  const store = new DraftResourceStore(
    queryClient,
    server.api,
    storage,
    60_000,
  );
  stores.push(store);
  return { store, queryClient, storage, server };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  for (const client of clients.splice(0)) client.clear();
});

const initial = () =>
  draftContentSchema.parse({
    projectId: "proj_one",
    sectionId: "section_one",
    prompt: {
      text: "First draft",
      mentions: [
        {
          start: 0,
          end: 5,
          resource: {
            kind: "plugin",
            pluginId: "plugin-one",
            itemId: "item-one",
            label: "First",
          },
        },
      ],
      attachments: [
        {
          type: "localFile",
          path: "uploads/a.txt",
          name: "a.txt",
          sizeBytes: 12,
        },
      ],
    },
    options: { model: "model-one", environment: { type: "project-default" } },
  });

describe("draft resource recovery", () => {
  it("reports a failed initialization checkpoint and retries it without replacing the original contents", () => {
    const { store, storage } = fixture();
    const id = "drf_migrated_identity";
    storage.failWrites = true;
    expect(store.initialize(id, initial())).toBe(false);
    expect(readDraftRecoveries(storage, id).records).toHaveLength(0);
    storage.failWrites = false;
    expect(
      store.initialize(id, { prompt: { text: "Different retry seed" } }),
    ).toBe(true);
    expect(readDraftRecoveries(storage, id).records[0]?.value.content).toEqual(
      initial(),
    );
  });

  it("exposes independent IDs immediately and stores all contents and choices before create", async () => {
    const { store, storage, server } = fixture();
    const first = store.create(initial());
    const second = store.create({
      projectId: "proj_two",
      prompt: { text: "Second draft" },
      options: { model: "model-two" },
    });
    expect(first).not.toBe(second);
    expect(store.getRecoverableSnapshot().map((draft) => draft.id)).toEqual([
      first,
      second,
    ]);
    expect(
      readDraftRecoveries(storage, first).records[0]?.value.content,
    ).toEqual(initial());
    await store.flush(first);
    expect(server.records.get(first)?.content).toEqual(initial());
    expect(store.getSnapshot(second).content?.options.model).toBe("model-two");
    expect(readDraftRecoveries(storage, first).records).toHaveLength(0);
  });

  it("retries the immutable initial create after a lost acknowledgment and saves newer edits", async () => {
    const { store, server } = fixture();
    const originalCreate = server.api.create;
    let fail = true;
    server.api.create = async (id, content) => {
      const response = await originalCreate(id, content);
      if (fail) {
        fail = false;
        throw new Error("response lost");
      }
      return response;
    };
    const id = store.create(initial());
    await expect(store.flush(id)).rejects.toThrow("response lost");
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Newer text" },
      options: { ...content.options, model: "new-model" },
    }));
    await store.retry(id);
    expect(server.creates).toEqual([
      { id, content: initial() },
      { id, content: initial() },
    ]);
    expect(server.records.get(id)?.content.prompt.text).toBe("Newer text");
    expect(server.records.get(id)?.content.options.model).toBe("new-model");
    expect(store.getSnapshot(id).status).toBe("saved");
  });

  it("keeps edits made during create and serializes updates for one identity", async () => {
    const { store, server } = fixture();
    const started = deferred<void>();
    const finish = deferred<DraftCreateResponse>();
    const originalCreate = server.api.create;
    server.api.create = async (id, content) => {
      const response = await originalCreate(id, content);
      started.resolve();
      await finish.promise;
      return response;
    };
    const id = store.create(initial());
    const first = store.flush(id);
    await started.promise;
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "During create" },
    }));
    const second = store.flush(id);
    finish.resolve({ id, draft: null });
    await Promise.all([first, second]);
    expect(server.creates).toHaveLength(1);
    expect(server.updates).toHaveLength(1);
    expect(server.records.get(id)?.content.prompt.text).toBe("During create");
  });

  it("retains a failed update through reload and clears recovery only after acknowledgment", async () => {
    const { store, server, storage } = fixture();
    const id = store.create(initial());
    await store.flush(id);
    const update = server.api.update;
    server.api.update = async () => {
      throw new Error("offline");
    };
    store.edit(id, (content) => ({
      ...content,
      projectId: "proj_two",
      prompt: { ...content.prompt, text: "Pending text" },
    }));
    await expect(store.flush(id)).rejects.toThrow("offline");
    store.dispose();
    server.api.update = update;
    const reopened = fixture(server, storage);
    await reopened.store.load(id);
    expect(reopened.store.getSnapshot(id).content?.prompt.text).toBe(
      "Pending text",
    );
    await reopened.store.flush(id);
    expect(server.records.get(id)?.content.projectId).toBe("proj_two");
    expect(readDraftRecoveries(storage, id).records).toHaveLength(0);
  });

  it("preserves both CAS-racing edits and requires an explicit copy or remote reload", async () => {
    const first = fixture();
    const id = first.store.create(initial());
    await first.store.flush(id);
    const second = fixture(first.server, new RecoveryStorage());
    await second.store.load(id);
    first.store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "First client edits" },
    }));
    second.store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Second client edits" },
    }));
    await second.store.flush(id);
    await expect(first.store.flush(id)).rejects.toMatchObject({
      code: "draft_revision_conflict",
    });
    expect(first.store.getSnapshot(id).status).toBe("conflict");
    expect(first.store.getSnapshot(id).content?.prompt.text).toBe(
      "First client edits",
    );
    const copy = first.store.saveLocalAsCopy(id);
    await first.store.flush(copy);
    expect(first.server.records.get(copy)?.content.prompt.text).toBe(
      "First client edits",
    );
    await first.store.reloadRemote(id);
    expect(first.store.getSnapshot(id).content?.prompt.text).toBe(
      "Second client edits",
    );
  });

  it("does not overwrite a newer server revision noticed by a pending editor", async () => {
    const { store, server, queryClient } = fixture();
    const id = store.create(initial());
    await store.flush(id);
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Unsaved local" },
    }));
    const remote = await server.api.update(
      id,
      1,
      draftContentSchema.parse({ prompt: { text: "Remote" } }),
    );
    queryClient.setQueryData(draftResourceQueryKey(id), remote);
    expect(store.getSnapshot(id).status).toBe("conflict");
    await expect(store.flush(id)).rejects.toThrow("recovery");
    expect(server.records.get(id)?.content.prompt.text).toBe("Remote");
  });

  it("cancels a stale detail read before publishing an acknowledged update", async () => {
    const { store, server, queryClient } = fixture();
    const id = store.create(initial());
    await store.flush(id);
    const stale = server.records.get(id)!;
    const finish = deferred<Draft | null>();
    const loading = queryClient
      .fetchQuery({
        queryKey: draftResourceQueryKey(id),
        queryFn: () => finish.promise,
        staleTime: 0,
      })
      .catch(() => null);
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Acknowledged latest" },
    }));
    await store.flush(id);
    finish.resolve(stale);
    await loading;
    expect(store.getSnapshot(id).content?.prompt.text).toBe(
      "Acknowledged latest",
    );
    expect(
      queryClient.getQueryData<Draft>(draftResourceQueryKey(id))?.revision,
    ).toBe(2);
  });

  it("retains malformed records and the last durable buffer when quota is exhausted", async () => {
    const storage = new RecoveryStorage();
    const malformedKey = `${DRAFT_RECOVERY_PREFIX}drf_malformed:old`;
    storage.setItem(malformedKey, "{broken");
    const { store } = fixture(createServer(), storage);
    const id = store.create(initial());
    const before = readDraftRecoveries(storage, id).records[0]?.raw;
    storage.failWrites = true;
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Memory survives" },
    }));
    expect(store.getSnapshot(id).persistenceError).not.toBeNull();
    expect(store.getSnapshot(id).content?.prompt.text).toBe("Memory survives");
    expect(readDraftRecoveries(storage, id).records[0]?.raw).toBe(before);
    expect(storage.getItem(malformedKey)).toBe("{broken");
    storage.failWrites = false;
    await store.retry(id);
    expect(store.getSnapshot(id).persistenceError).toBeNull();
    expect(storage.getItem(malformedKey)).toBe("{broken");
  });

  it("opens a remotely deleted draft blank and keeps its unsaved contents recoverable", async () => {
    const { store, server } = fixture();
    const id = store.create(initial());
    await store.flush(id);
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Must recover" },
    }));
    await server.api.delete(id, 1);
    await store.load(id);
    expect(store.getSnapshot(id).status).toBe("deleted");
    expect(store.getSnapshot(id).content?.prompt.text).toBe("");
    expect(store.getSnapshot(id).recoveryCopies[0]?.prompt.text).toBe(
      "Must recover",
    );
    await expect(store.flush(id)).rejects.toThrow();
    expect(server.creates).toHaveLength(1);
  });

  it("waits for an in-flight write before deletion and cannot resurrect that identity", async () => {
    const { store, server } = fixture();
    const id = store.create(initial());
    await store.flush(id);
    const update = server.api.update;
    const started = deferred<void>();
    const finish = deferred<void>();
    server.api.update = async (...args) => {
      started.resolve();
      await finish.promise;
      return update(...args);
    };
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Pending update" },
    }));
    const saving = store.flush(id);
    await started.promise;
    const deleting = store.delete(id);
    expect(store.getSnapshot(id).content?.prompt.text).toBe("");
    finish.resolve();
    await saving;
    await deleting;
    await expect(store.flush(id)).rejects.toThrow();
    expect(server.records.has(id)).toBe(false);
    expect(store.getSnapshot(id).status).toBe("deleted");
  });

  it("reuses a consumed create tombstone instead of resurrecting a lost initial acknowledgment", async () => {
    const { store, server } = fixture();
    const create = server.api.create;
    let first = true;
    server.api.create = async (id, content) => {
      const response = await create(id, content);
      if (first) {
        first = false;
        await server.api.delete(id, 1);
        throw new Error("lost response");
      }
      return response;
    };
    const id = store.create(initial());
    await expect(store.flush(id)).rejects.toThrow("lost response");
    await expect(store.retry(id)).rejects.toThrow("consumed or deleted");
    expect(store.getSnapshot(id).status).toBe("deleted");
    expect(store.getSnapshot(id).recoveryCopies[0]).toEqual(initial());
    expect(server.records.size).toBe(0);
  });
});

describe("draft submission recovery", () => {
  it("releases a definite submission conflict so the saved remote version can be accepted", async () => {
    const { store, server, storage } = fixture();
    const id = store.create(initial());
    const submit = server.api.submit;
    const started = deferred<void>();
    const finish = deferred<void>();
    server.api.submit = async (...args) => {
      started.resolve();
      await finish.promise;
      return submit(...args);
    };
    const pending = store.submit(id);
    await started.promise;
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Local edit during submit" },
    }));
    const remote = await server.api.update(
      id,
      1,
      draftContentSchema.parse({
        prompt: { text: "Saved elsewhere before submission" },
      }),
    );
    finish.resolve();
    await expect(pending).rejects.toMatchObject({
      status: 409,
      code: "draft_revision_conflict",
    });
    expect(server.receipts.size).toBe(0);
    expect(store.getSnapshot(id).status).toBe("conflict");
    expect(store.getSnapshot(id).content?.prompt.text).toBe(
      "Local edit during submit",
    );
    expect(
      readDraftRecoveries(storage, id).records[0]?.value.submission,
    ).toBeNull();
    await store.reloadRemote(id);
    expect(store.getSnapshot(id).status).toBe("saved");
    expect(store.getSnapshot(id).content).toEqual(remote.content);
    expect(readDraftRecoveries(storage, id).records).toHaveLength(0);
  });

  it("moves edits typed during consumption into an explicitly returned fresh identity", async () => {
    const { store, server } = fixture();
    const id = store.create(initial());
    const submit = server.api.submit;
    const started = deferred<void>();
    const finish = deferred<void>();
    server.api.submit = async (...args) => {
      started.resolve();
      await finish.promise;
      return submit(...args);
    };
    const submitting = store.submit(id);
    await started.promise;
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "New work during submit" },
      sectionId: "section_two",
    }));
    finish.resolve();
    const result = await submitting;
    expect(result.recoveryDraftId).not.toBeNull();
    const recovered = result.recoveryDraftId!;
    expect(recovered).not.toBe(id);
    expect(store.getSnapshot(id).content?.prompt.text).toBe("");
    expect(store.getSnapshot(recovered).content?.prompt.text).toBe(
      "New work during submit",
    );
    await store.flush(recovered);
    expect(server.records.get(recovered)?.content.sectionId).toBe(
      "section_two",
    );
    expect(server.receipts.size).toBe(1);
  });

  it("retries the exact submitted revision after reload and a lost successful response", async () => {
    const { store, server, storage } = fixture();
    const submit = server.api.submit;
    const revisions: number[] = [];
    let fail = true;
    server.api.submit = async (id, revision) => {
      revisions.push(revision);
      const result = await submit(id, revision);
      if (fail) {
        fail = false;
        throw new Error("lost submit response");
      }
      return result;
    };
    const id = store.create(initial());
    await expect(store.submit(id)).rejects.toThrow("lost submit response");
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "After response loss" },
    }));
    store.dispose();
    const reopened = fixture(server, storage);
    await reopened.store.load(id);
    await expect(reopened.store.reloadRemote(id)).rejects.toThrow(
      "Retry the pending submission before discarding recovery data",
    );
    const result = await reopened.store.retry(id);
    expect(revisions).toEqual([1, 1]);
    expect(server.receipts.size).toBe(1);
    expect(result).not.toBeNull();
    expect(result?.thread.id).toBe("thr_0");
    expect(result?.recoveryDraftId).not.toBeNull();
    expect(
      reopened.store.getSnapshot(result!.recoveryDraftId!).content?.prompt.text,
    ).toBe("After response loss");
  });

  it("retains the same identity when submit returns a newer accepted remote edit", async () => {
    const { store, server } = fixture();
    const id = store.create(initial());
    const started = deferred<void>();
    const finish = deferred<void>();
    server.api.submit = async () => {
      started.resolve();
      await finish.promise;
      return {
        thread: makeThreadWithRuntime(),
        draft: server.records.get(id) ?? null,
      };
    };
    const pending = store.submit(id);
    await started.promise;
    const newer = draftContentSchema.parse({
      prompt: { text: "Other tab accepted" },
    });
    await server.api.update(id, 1, newer);
    finish.resolve();
    const result = await pending;
    expect(result.recoveryDraftId).toBeNull();
    expect(store.getSnapshot(id).content).toEqual(newer);
    expect(store.getSnapshot(id).status).toBe("saved");
  });

  it("keeps both local and newer remote edits when submit returns a concurrently saved revision", async () => {
    const { store, server } = fixture();
    const id = store.create(initial());
    const started = deferred<void>();
    const finish = deferred<void>();
    server.api.submit = async () => {
      started.resolve();
      await finish.promise;
      return {
        thread: makeThreadWithRuntime(),
        draft: server.records.get(id) ?? null,
      };
    };
    const pending = store.submit(id);
    await started.promise;
    store.edit(id, (content) => ({
      ...content,
      prompt: { ...content.prompt, text: "Local newer" },
    }));
    await server.api.update(
      id,
      1,
      draftContentSchema.parse({ prompt: { text: "Remote newer" } }),
    );
    finish.resolve();
    await pending;
    expect(store.getSnapshot(id).status).toBe("conflict");
    expect(store.getSnapshot(id).content?.prompt.text).toBe("Local newer");
    expect(server.records.get(id)?.content.prompt.text).toBe("Remote newer");
  });
});

describe("acknowledged singleton import", () => {
  it("retries one stable original snapshot and preserves attachments and supplied selections", async () => {
    const { server, storage, queryClient } = fixture();
    const raw = JSON.stringify(initial().prompt);
    storage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, raw);
    const create = server.api.create;
    let fail = true;
    server.api.create = async (id, content) => {
      const response = await create(id, content);
      if (fail) {
        fail = false;
        throw new Error("response lost");
      }
      return response;
    };
    const deps = { api: server.api, storage, queryClient };
    const seed = {
      projectId: initial().projectId,
      sectionId: initial().sectionId,
      options: initial().options,
    };
    const first = await importLegacyNewThreadDraft(seed, deps);
    expect(first.error).not.toBeNull();
    expect(storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBe(raw);
    const second = await importLegacyNewThreadDraft(
      { projectId: "proj_changed" },
      deps,
    );
    expect(second.error).toBeNull();
    expect(second.id).toBe(first.id);
    expect(server.creates[0]?.content).toEqual(initial());
    expect(server.creates[1]?.content).toEqual(initial());
    expect(storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBeNull();
  });

  it("leaves a newer singleton value untouched and imports it separately", async () => {
    const { server, storage, queryClient } = fixture();
    storage.setItem(
      LEGACY_NEW_THREAD_DRAFT_KEY,
      JSON.stringify(initial().prompt),
    );
    const create = server.api.create;
    const changed = JSON.stringify({
      text: "Typed during import",
      mentions: [],
      attachments: [],
    });
    server.api.create = async (id, content) => {
      storage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, changed);
      return create(id, content);
    };
    const deps = { api: server.api, storage, queryClient };
    const first = await importLegacyNewThreadDraft(
      { projectId: "proj_one" },
      deps,
    );
    expect(first.newerLegacyValue).toBe(true);
    expect(storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBe(changed);
    server.api.create = create;
    const second = await importLegacyNewThreadDraft(
      { projectId: "proj_one" },
      deps,
    );
    expect(second.id).not.toBe(first.id);
    expect(server.records.size).toBe(2);
  });

  it("cannot resurrect an acknowledged import after removal fails and the server deletes it", async () => {
    const { server, storage, queryClient } = fixture();
    const raw = JSON.stringify(initial().prompt);
    storage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, raw);
    storage.failRemoves = true;
    const deps = { api: server.api, storage, queryClient };
    const first = await importLegacyNewThreadDraft({}, deps);
    expect(first.error).not.toBeNull();
    expect(first.id).not.toBeNull();
    await server.api.delete(first.id!, 1);
    storage.failRemoves = false;
    const retry = await importLegacyNewThreadDraft({}, deps);
    expect(retry.error).toBeNull();
    expect(retry.id).toBe(first.id);
    expect(retry.draft).toBeNull();
    expect(server.creates).toHaveLength(1);
    expect(server.records.size).toBe(0);
  });

  it("never deletes malformed legacy/import records and does not create without a durable import checkpoint", async () => {
    const { server, storage, queryClient } = fixture();
    const deps = { api: server.api, storage, queryClient };
    storage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, "{broken");
    expect((await importLegacyNewThreadDraft({}, deps)).error).not.toBeNull();
    expect(storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBe("{broken");
    const raw = JSON.stringify(initial().prompt);
    storage.setItem(LEGACY_NEW_THREAD_DRAFT_KEY, raw);
    storage.failWrites = true;
    const quota = await importLegacyNewThreadDraft({}, deps);
    expect(quota.error).not.toBeNull();
    expect(server.creates).toHaveLength(0);
    storage.failWrites = false;
    storage.setItem(
      `${LEGACY_DRAFT_IMPORT_PREFIX}${quota.id}`,
      "{broken checkpoint",
    );
    expect((await importLegacyNewThreadDraft({}, deps)).error).not.toBeNull();
    expect(storage.getItem(`${LEGACY_DRAFT_IMPORT_PREFIX}${quota.id}`)).toBe(
      "{broken checkpoint",
    );
    expect(storage.getItem(LEGACY_NEW_THREAD_DRAFT_KEY)).toBe(raw);
  });

  it("deduplicates concurrent imports of the same singleton", async () => {
    const { server, storage, queryClient } = fixture();
    storage.setItem(
      LEGACY_NEW_THREAD_DRAFT_KEY,
      JSON.stringify(initial().prompt),
    );
    const deps = { api: server.api, storage, queryClient };
    const results = await Promise.all([
      importLegacyNewThreadDraft({ projectId: "proj_one" }, deps),
      importLegacyNewThreadDraft({ projectId: "proj_one" }, deps),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results.every((result) => result.error === null)).toBe(true);
    expect(server.records.size).toBe(1);
  });
});
