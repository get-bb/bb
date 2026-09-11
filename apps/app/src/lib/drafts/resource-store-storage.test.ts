// @vitest-environment jsdom

import { webcrypto } from "node:crypto";
import { QueryClient } from "@tanstack/react-query";
import {
  draftContentSchema,
  type Draft,
  type DraftContent,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../api";
import { draftResourceQueryKey, type DraftResourceApi } from "./resource-api";
import { browserDraftRecoveryStorage, readDraftRecoveries } from "./recovery";
import { DraftResourceStore } from "./resource-store";

const id = "drf_storage_events";
const stores: DraftResourceStore[] = [];
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  const held = new Set<string>();
  vi.stubGlobal("navigator", {
    locks: {
      async request(
        name: string,
        options: { ifAvailable: boolean },
        callback: (lock: { name: string } | null) => Promise<void>,
      ) {
        await Promise.resolve();
        if (held.has(name) && options.ifAvailable) return callback(null);
        held.add(name);
        return callback({ name }).finally(() => held.delete(name));
      },
    },
  });
});

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  for (const client of clients.splice(0)) client.clear();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture() {
  let saved: Draft = {
    id,
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    content: draftContentSchema.parse({ prompt: { text: "Saved text" } }),
  };
  const api: DraftResourceApi = {
    get: vi.fn(async () => saved),
    create: vi.fn(async () => {
      throw new Error("Unexpected create");
    }),
    update: vi.fn(
      async (_id: string, revision: number, content: DraftContent) => {
        if (revision !== saved.revision)
          throw new HttpError({
            status: 409,
            code: "draft_revision_conflict",
            message: "Changed draft",
          });
        saved = {
          ...saved,
          revision: revision + 1,
          updatedAt: revision + 1,
          content,
        };
        return saved;
      },
    ),
    delete: vi.fn(async () => {}),
    submit: vi.fn(async () => {
      throw new Error("Unexpected submit");
    }),
  };
  const createStore = () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    clients.push(client);
    client.setQueryData(draftResourceQueryKey(id), saved);
    const store = new DraftResourceStore(
      client,
      api,
      browserDraftRecoveryStorage(),
      60_000,
    );
    stores.push(store);
    return store;
  };
  return { api, createStore, getSaved: () => saved };
}

function edit(store: DraftResourceStore, text: string): void {
  store.edit(id, (content) => ({
    ...content,
    prompt: { ...content.prompt, text },
  }));
}

function recoveries() {
  return readDraftRecoveries(localStorage, id).records;
}

function dispatchStorage(key: string): void {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue: localStorage.getItem(key),
      storageArea: localStorage,
    }),
  );
}

describe("draft recovery writer ownership", () => {
  it("does not resume a live writer's checkpoint when the passive window opens after the write", async () => {
    vi.useFakeTimers();
    const { api, createStore, getSaved } = fixture();
    const owner = createStore();
    edit(owner, "Pending before the second window opens");
    const key = recoveries()[0]!.key;

    const passive = createStore();
    passive.resumeRecoveries();
    await vi.advanceTimersByTimeAsync(0);
    expect(passive.getSnapshot(id).status).toBe("saved");
    expect(passive.getRecoverableSnapshot()).toHaveLength(0);
    expect(recoveries()).toHaveLength(1);

    edit(owner, "The owner keeps typing");
    dispatchStorage(key);
    await vi.advanceTimersByTimeAsync(60_000);
    dispatchStorage(key);
    await passive.load(id);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(getSaved().content.prompt.text).toBe("The owner keeps typing");
    expect(owner.getSnapshot(id).status).toBe("saved");
    expect(passive.getSnapshot(id).status).toBe("saved");
    expect(recoveries()).toHaveLength(0);
  });

  it.each([false, true])(
    "keeps a passive window clean across foreign updates and acknowledgment (already open: %s)",
    async (alreadyOpen) => {
      const { createStore, getSaved } = fixture();
      const owner = createStore();
      const passive = createStore();
      if (alreadyOpen) passive.getSnapshot(id);

      edit(owner, "First character");
      const key = recoveries()[0]!.key;
      dispatchStorage(key);
      expect(passive.getSnapshot(id).status).toBe("saved");
      expect(passive.getSnapshot(id).recoveryCopies).toHaveLength(0);

      edit(owner, "More characters");
      dispatchStorage(key);
      expect(recoveries()).toHaveLength(1);
      expect(owner.getSnapshot(id).status).toBe("saving");
      expect(passive.getSnapshot(id).status).toBe("saved");
      expect(passive.getRecoverableSnapshot()).toHaveLength(0);

      await owner.flush(id);
      dispatchStorage(key);
      await passive.load(id);
      expect(getSaved().content.prompt.text).toBe("More characters");
      expect(passive.getSnapshot(id).content?.prompt.text).toBe(
        "More characters",
      );
      expect(passive.getSnapshot(id).status).toBe("saved");
      expect(passive.getSnapshot(id).recoveryCopies).toHaveLength(0);
      expect(recoveries()).toHaveLength(0);
    },
  );

  it("replaces foreign checkpoints by writer and retains real competing edits through CAS", async () => {
    const { createStore, getSaved } = fixture();
    const first = createStore();
    const second = createStore();
    edit(first, "First writer");
    const firstKey = recoveries()[0]!.key;
    dispatchStorage(firstKey);
    edit(second, "Second writer");
    const secondKey = recoveries().find(
      (record) => record.key !== firstKey,
    )!.key;
    dispatchStorage(secondKey);

    edit(first, "First writer newer");
    dispatchStorage(firstKey);
    expect(second.getSnapshot(id).content?.prompt.text).toBe("Second writer");
    expect(
      second
        .getSnapshot(id)
        .recoveryCopies.map((content) => content.prompt.text),
    ).toEqual(["First writer newer"]);
    expect(recoveries()).toHaveLength(2);

    await first.flush(id);
    dispatchStorage(firstKey);
    expect(second.getSnapshot(id).recoveryCopies).toHaveLength(0);
    await expect(second.flush(id)).rejects.toMatchObject({
      code: "draft_revision_conflict",
    });
    expect(second.getSnapshot(id).status).toBe("conflict");
    expect(second.getSnapshot(id).content?.prompt.text).toBe("Second writer");
    expect(second.getSnapshot(id).recoveryCopies[0]?.prompt.text).toBe(
      "Second writer",
    );
    expect(getSaved().content.prompt.text).toBe("First writer newer");
    expect(
      recoveries().map((record) => record.value.content.prompt.text),
    ).toEqual(["Second writer"]);
  });

  it("resumes an existing v1 owner checkpoint after reload", async () => {
    vi.useFakeTimers();
    const { api, createStore, getSaved } = fixture();
    const owner = createStore();
    edit(owner, "Unacknowledged text");
    vi.mocked(api.update).mockRejectedValueOnce(new Error("offline"));
    await expect(owner.flush(id)).rejects.toThrow("offline");
    owner.dispose();

    const reopened = createStore();
    expect(reopened.getSnapshot(id).content?.prompt.text).toBe(
      "Unacknowledged text",
    );
    reopened.resumeRecoveries();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getSaved().content.prompt.text).toBe("Unacknowledged text");
    expect(reopened.getSnapshot(id).status).toBe("saved");
    expect(recoveries()).toHaveLength(0);
  });
});
