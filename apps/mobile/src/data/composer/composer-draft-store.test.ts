import type { PromptDraftState } from "@bb/client-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  composerDraftStorageKey,
  createComposerDraftStore,
  type ComposerDraftStorage,
} from "./composer-draft-store";

function memoryStorage(): ComposerDraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getString: (key) => map.get(key),
    set: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  };
}

const THREAD_SCOPE = {
  kind: "thread" as const,
  projectId: "proj_1",
  threadId: "thr a",
};
const DRAFT: PromptDraftState = {
  text: "hi @thread:thr_2",
  mentions: [
    {
      start: 3,
      end: 16,
      resource: { kind: "thread", threadId: "thr_2", label: "Two" },
    },
  ],
  attachments: [
    { type: "localImage", path: "img.png", name: "img.png", sizeBytes: 1 },
  ],
};

describe("composer draft store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("uses the web app's storage keys", () => {
    expect(composerDraftStorageKey({ kind: "new-thread" })).toBe(
      "bb.promptbox.contents-draft-3",
    );
    expect(composerDraftStorageKey(THREAD_SCOPE)).toBe(
      "bb.promptbox.contents-proj_1-thr%20a-3",
    );
  });

  it("reads a draft the web wrote and round-trips its own writes", () => {
    const storage = memoryStorage();
    storage.map.set(
      composerDraftStorageKey(THREAD_SCOPE),
      JSON.stringify({
        text: DRAFT.text,
        mentions: DRAFT.mentions,
        attachments: DRAFT.attachments,
      }),
    );
    const store = createComposerDraftStore(storage);
    expect(store.read(THREAD_SCOPE)).toEqual(DRAFT);
    store.write({ kind: "new-thread" }, DRAFT);
    expect(store.read({ kind: "new-thread" })).toEqual(DRAFT);
    // Debounced: not on disk yet, then persisted.
    expect(storage.map.has("bb.promptbox.contents-draft-3")).toBe(false);
    vi.advanceTimersByTime(250);
    expect(
      JSON.parse(storage.map.get("bb.promptbox.contents-draft-3")!),
    ).toEqual({
      text: DRAFT.text,
      mentions: DRAFT.mentions,
      attachments: DRAFT.attachments,
    });
  });

  it("removes the key for an empty draft and notifies subscribers", () => {
    const storage = memoryStorage();
    const store = createComposerDraftStore(storage);
    const listener = vi.fn();
    store.subscribe(THREAD_SCOPE, listener);
    store.write(THREAD_SCOPE, DRAFT, { persist: "immediate" });
    expect(storage.map.size).toBe(1);
    store.clear(THREAD_SCOPE);
    expect(storage.map.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.read(THREAD_SCOPE)).toEqual({
      text: "",
      mentions: [],
      attachments: [],
    });
  });

  it("flush writes pending drafts at once and ignores corrupt storage", () => {
    const storage = memoryStorage();
    storage.map.set("bb.promptbox.contents-draft-3", "{not json");
    const store = createComposerDraftStore(storage);
    expect(store.read({ kind: "new-thread" })).toEqual({
      text: "",
      mentions: [],
      attachments: [],
    });
    store.write({ kind: "new-thread" }, { ...DRAFT, attachments: [] });
    store.flush();
    expect(storage.map.get("bb.promptbox.contents-draft-3")).toContain("thr_2");
  });
});
