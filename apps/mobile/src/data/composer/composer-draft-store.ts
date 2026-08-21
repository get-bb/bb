import {
  arePromptDraftStatesEqual,
  emptyPromptDraftState,
  parsePromptDraftStorage,
  serializePromptDraftStorage,
  type PromptDraftState,
} from "@bb/client-core";

/**
 * Per-scope composer drafts, persisted under the web app's
 * `bb.promptbox.contents-*` keys and storage format (`PromptDraftState`
 * JSON: serialized text + mention ranges + attachments; see
 * apps/app/src/hooks/usePromptDraftStorage.ts) so a draft written here reads
 * the same as one written by the web. Writes are debounced per key and an
 * empty draft removes the key. Storage is injected (MMKV in the app, a Map in
 * tests); the store is the in-process source of truth and notifies
 * subscribers.
 */

const PROMPT_DRAFT_STORAGE_PREFIX = "bb.promptbox.contents";
const PROMPT_DRAFT_STORAGE_VERSION = "3";
const COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS = 250;

export type ComposerDraftScope =
  | { kind: "new-thread" }
  | { kind: "thread"; projectId: string; threadId: string }
  /** Any other composer surface (dev screens, plugin composers). */
  | { kind: "custom"; key: string };

export interface ComposerDraftStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface ComposerDraftStore {
  storageKey(scope: ComposerDraftScope): string;
  read(scope: ComposerDraftScope): PromptDraftState;
  /** Replace the draft; persisted after the debounce (or at once). */
  write(
    scope: ComposerDraftScope,
    draft: PromptDraftState,
    options?: { persist: "immediate" | "deferred" },
  ): void;
  clear(scope: ComposerDraftScope): void;
  subscribe(scope: ComposerDraftScope, listener: () => void): () => void;
  /** Write every pending draft now (app background, unmount). */
  flush(): void;
}

function segment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function composerDraftStorageKey(scope: ComposerDraftScope): string {
  switch (scope.kind) {
    case "new-thread":
      return `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
    case "thread":
      return `${PROMPT_DRAFT_STORAGE_PREFIX}-${segment(scope.projectId)}-${segment(scope.threadId)}-${PROMPT_DRAFT_STORAGE_VERSION}`;
    case "custom":
      return `${PROMPT_DRAFT_STORAGE_PREFIX}-custom-${segment(scope.key)}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
}

interface CacheEntry {
  raw: string | null;
  draft: PromptDraftState;
}

export function createComposerDraftStore(
  storage: ComposerDraftStorage,
  options: { debounceMs?: number } = {},
): ComposerDraftStore {
  const debounceMs = options.debounceMs ?? COMPOSER_DRAFT_PERSIST_DEBOUNCE_MS;
  const cache = new Map<string, CacheEntry>();
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const EMPTY = emptyPromptDraftState();

  function readKey(key: string): PromptDraftState {
    const pending = timers.has(key);
    const cached = cache.get(key);
    if (pending && cached) return cached.draft;
    const raw = storage.getString(key) ?? null;
    if (cached && cached.raw === raw) return cached.draft;
    const draft = raw === null ? EMPTY : parsePromptDraftStorage(raw);
    cache.set(key, { raw, draft });
    return draft;
  }

  function persistKey(key: string): void {
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(key);
    }
    const entry = cache.get(key);
    if (!entry || entry.raw === null) {
      storage.remove(key);
      return;
    }
    storage.set(key, entry.raw);
  }

  function emit(key: string): void {
    const set = listeners.get(key);
    if (!set) return;
    for (const listener of set) listener();
  }

  function writeKey(
    key: string,
    draft: PromptDraftState,
    persist: "immediate" | "deferred",
  ): void {
    const current = readKey(key);
    if (arePromptDraftStatesEqual(current, draft)) return;
    const raw = serializePromptDraftStorage(draft);
    cache.set(key, { raw, draft: raw === null ? EMPTY : draft });
    if (persist === "immediate" || debounceMs <= 0) {
      persistKey(key);
    } else {
      const existing = timers.get(key);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => persistKey(key), debounceMs),
      );
    }
    emit(key);
  }

  return {
    storageKey: composerDraftStorageKey,
    read: (scope) => readKey(composerDraftStorageKey(scope)),
    write: (scope, draft, opts) =>
      writeKey(
        composerDraftStorageKey(scope),
        draft,
        opts?.persist ?? "deferred",
      ),
    clear: (scope) =>
      writeKey(composerDraftStorageKey(scope), EMPTY, "immediate"),
    subscribe: (scope, listener) => {
      const key = composerDraftStorageKey(scope);
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(key);
      };
    },
    flush: () => {
      for (const key of Array.from(timers.keys())) persistKey(key);
    },
  };
}
