import { useCallback, useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import type { PromptTextMention } from "@bb/domain";
import type { PromptDraftAttachment, PromptDraftState } from "@bb/client-core";
import {
  arePromptDraftStatesEqual,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  parsePromptDraftStorage,
  promptDraftToInput,
  serializePromptDraftStorage,
} from "@bb/client-core";

const PROMPT_DRAFT_STORAGE_PREFIX = "bb.promptbox.contents";
const PROMPT_DRAFT_STORAGE_VERSION = "3";
const PROMPT_DRAFT_PERSIST_DEBOUNCE_MS = 250;

export type PromptDraftScope =
  | { kind: "automation-edit"; automationId: string }
  | { kind: "new-thread" }
  | { kind: "plugin-new-thread"; key: string }
  | { kind: "thread"; projectId: string; threadId: string };

interface PromptDraftCacheEntry {
  rawValue: string | null;
  draft: PromptDraftState;
}

type PromptDraftListener = () => void;

interface PromptDraftWriteOptions {
  persist: "immediate" | "deferred";
}

const EMPTY_PROMPT_DRAFT = emptyPromptDraftState();
const promptDraftCache = new Map<string, PromptDraftCacheEntry>();
const promptDraftSubscribers = new Map<string, Set<PromptDraftListener>>();
const pendingPromptDraftStorageKeys = new Set<string>();
const promptDraftPersistTimers = new Map<string, number>();
let promptDraftStorageObserverInitialized = false;

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function readPromptDraftValue(storageKey: string | null): PromptDraftState {
  if (!storageKey || typeof window === "undefined") {
    return EMPTY_PROMPT_DRAFT;
  }

  if (pendingPromptDraftStorageKeys.has(storageKey)) {
    return promptDraftCache.get(storageKey)?.draft ?? EMPTY_PROMPT_DRAFT;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  const cachedEntry = promptDraftCache.get(storageKey);
  if (cachedEntry && cachedEntry.rawValue === rawValue) {
    return cachedEntry.draft;
  }

  const draft = parsePromptDraftStorage(rawValue);
  promptDraftCache.set(storageKey, {
    rawValue,
    draft,
  });
  return draft;
}

const pendingSubmissionSchema = z.array(
  z.object({
    id: z.string(),
    draft: z.string(),
  }),
);
const activePromptSubmissions = new Set<string>();
const inspectedPromptSubmissionKeys = new Set<string>();

function readPendingSubmissions(storageKey: string) {
  const raw = window.localStorage.getItem(`${storageKey}.pending-submissions`);
  if (raw === null) return [];
  try {
    const parsed = pendingSubmissionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function writePendingSubmissions(
  storageKey: string,
  submissions: z.infer<typeof pendingSubmissionSchema>,
): void {
  const key = `${storageKey}.pending-submissions`;
  if (submissions.length === 0) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, JSON.stringify(submissions));
}

function mergeRecoveredDraft(
  recovered: PromptDraftState,
  current: PromptDraftState,
): PromptDraftState {
  if (
    isPromptDraftEmpty(recovered) ||
    arePromptDraftStatesEqual(recovered, current)
  )
    return current;
  if (isPromptDraftEmpty(current)) return recovered;
  const separator = recovered.text && current.text ? "\n\n" : "";
  const offset = recovered.text.length + separator.length;
  const paths = new Set(
    recovered.attachments.map((attachment) => attachment.path),
  );
  return {
    text: recovered.text + separator + current.text,
    mentions: [
      ...recovered.mentions,
      ...current.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
    attachments: [
      ...recovered.attachments,
      ...current.attachments.filter(
        (attachment) => !paths.has(attachment.path),
      ),
    ],
  };
}

function readPromptDraft(storageKey: string | null): PromptDraftState {
  const current = readPromptDraftValue(storageKey);
  if (!storageKey || typeof window === "undefined") return current;
  if (inspectedPromptSubmissionKeys.has(storageKey)) return current;
  inspectedPromptSubmissionKeys.add(storageKey);
  const pending = readPendingSubmissions(storageKey);
  const interrupted = pending.filter(
    (submission) => !activePromptSubmissions.has(submission.id),
  );
  if (interrupted.length === 0) return current;
  const recovered = interrupted.reduceRight(
    (draft, submission) =>
      mergeRecoveredDraft(parsePromptDraftStorage(submission.draft), draft),
    current,
  );
  writePromptDraft(storageKey, recovered);
  if (
    window.localStorage.getItem(storageKey) ===
    serializePromptDraftStorage(recovered)
  ) {
    try {
      writePendingSubmissions(
        storageKey,
        pending.filter((submission) =>
          activePromptSubmissions.has(submission.id),
        ),
      );
    } catch (error) {
      console.warn(
        "[prompt-draft] could not clear submission recovery copy",
        error,
      );
    }
  }
  return recovered;
}

export async function submitPromptDraft<Result>(
  controller: PromptDraftController,
  draft: PromptDraftState,
  submit: () => Promise<Result>,
): Promise<Result> {
  const serialized = serializePromptDraftStorage(draft);
  if (serialized === null) return submit();
  const id = crypto.randomUUID();
  const { storageKey } = controller;
  writePendingSubmissions(storageKey, [
    ...readPendingSubmissions(storageKey),
    { id, draft: serialized },
  ]);
  activePromptSubmissions.add(id);
  let cleared = false;
  let accepted = false;
  try {
    cleared = controller.clearIfCurrentMatches(draft);
    const result = await submit();
    accepted = true;
    return result;
  } catch (error) {
    if (cleared)
      controller.setDraft(mergeRecoveredDraft(draft, controller.getCurrent()));
    throw error;
  } finally {
    try {
      if (
        accepted ||
        !cleared ||
        window.localStorage.getItem(storageKey) ===
          serializePromptDraftStorage(controller.getCurrent())
      ) {
        writePendingSubmissions(
          storageKey,
          readPendingSubmissions(storageKey).filter(
            (submission) => submission.id !== id,
          ),
        );
      }
    } catch (error) {
      console.warn(
        "[prompt-draft] could not clear submission recovery copy",
        error,
      );
    } finally {
      activePromptSubmissions.delete(id);
    }
  }
}

function emitPromptDraftChange(storageKey: string): void {
  const listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener();
  }
}

function clearPromptDraftPersistTimer(storageKey: string): void {
  const timerId = promptDraftPersistTimers.get(storageKey);
  if (timerId === undefined || typeof window === "undefined") return;

  window.clearTimeout(timerId);
  promptDraftPersistTimers.delete(storageKey);
}

function persistPromptDraftCache(storageKey: string): void {
  if (typeof window === "undefined") return;

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.delete(storageKey);

  const cachedEntry = promptDraftCache.get(storageKey);
  if (!cachedEntry) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  const serialized = serializePromptDraftStorage(cachedEntry.draft);
  cachedEntry.rawValue = serialized;
  if (serialized === null) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  try {
    window.localStorage.setItem(storageKey, serialized);
  } catch (error) {
    cachedEntry.rawValue = readStoredPromptDraftValue(storageKey);
    console.warn(
      `[prompt-draft] could not persist draft for ${storageKey}; keeping it in memory only`,
      error,
    );
  }
}

function readStoredPromptDraftValue(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function schedulePromptDraftPersist(storageKey: string): void {
  if (typeof window === "undefined") return;

  clearPromptDraftPersistTimer(storageKey);
  pendingPromptDraftStorageKeys.add(storageKey);
  const timerId = window.setTimeout(() => {
    persistPromptDraftCache(storageKey);
  }, PROMPT_DRAFT_PERSIST_DEBOUNCE_MS);
  promptDraftPersistTimers.set(storageKey, timerId);
}

function flushPendingPromptDraftPersists(): void {
  for (const storageKey of Array.from(pendingPromptDraftStorageKeys)) {
    persistPromptDraftCache(storageKey);
  }
}

function ensurePromptDraftStorageObserver(): void {
  if (promptDraftStorageObserverInitialized || typeof window === "undefined") {
    return;
  }

  promptDraftStorageObserverInitialized = true;
  window.addEventListener("storage", (event) => {
    if (!event.key) return;
    if (pendingPromptDraftStorageKeys.has(event.key)) return;
    promptDraftCache.delete(event.key);
    emitPromptDraftChange(event.key);
  });
  window.addEventListener("pagehide", flushPendingPromptDraftPersists);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPromptDraftPersists();
    }
  });
}

function subscribePromptDraft(
  storageKey: string | null,
  listener: PromptDraftListener,
): () => void {
  if (!storageKey) {
    return () => {};
  }

  ensurePromptDraftStorageObserver();

  let listeners = promptDraftSubscribers.get(storageKey);
  if (!listeners) {
    listeners = new Set();
    promptDraftSubscribers.set(storageKey, listeners);
  }

  listeners.add(listener);
  return () => {
    const existingListeners = promptDraftSubscribers.get(storageKey);
    if (!existingListeners) return;

    existingListeners.delete(listener);
    if (existingListeners.size === 0) {
      promptDraftSubscribers.delete(storageKey);
    }
  };
}

function writePromptDraft(
  storageKey: string | null,
  value: PromptDraftState,
  options: PromptDraftWriteOptions = { persist: "immediate" },
): void {
  if (!storageKey || typeof window === "undefined") return;

  promptDraftCache.set(storageKey, {
    rawValue: null,
    draft: isPromptDraftEmpty(value) ? EMPTY_PROMPT_DRAFT : value,
  });
  if (options.persist === "deferred") {
    schedulePromptDraftPersist(storageKey);
  } else {
    persistPromptDraftCache(storageKey);
  }
  emitPromptDraftChange(storageKey);
}

function restorePromptDraftIfEmpty(
  storageKey: string | null,
  value: PromptDraftState,
): boolean {
  if (
    !storageKey ||
    typeof window === "undefined" ||
    isPromptDraftEmpty(value)
  ) {
    return false;
  }

  if (!isPromptDraftEmpty(readPromptDraft(storageKey))) {
    return false;
  }

  writePromptDraft(storageKey, value);
  return true;
}

function getPromptDraftStorageKey(scope: PromptDraftScope): string {
  if (scope.kind === "automation-edit") {
    const normalizedAutomationId = normalizeStorageSegment(scope.automationId);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-automation-edit-${normalizedAutomationId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  if (scope.kind === "new-thread") {
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-draft-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  if (scope.kind === "plugin-new-thread") {
    const normalizedKey = normalizeStorageSegment(scope.key);
    return `${PROMPT_DRAFT_STORAGE_PREFIX}-plugin-draft-${normalizedKey}-${PROMPT_DRAFT_STORAGE_VERSION}`;
  }
  const normalizedProjectId = normalizeStorageSegment(scope.projectId);
  const normalizedThreadId = normalizeStorageSegment(scope.threadId);
  return `${PROMPT_DRAFT_STORAGE_PREFIX}-${normalizedProjectId}-${normalizedThreadId}-${PROMPT_DRAFT_STORAGE_VERSION}`;
}

export interface PromptDraftController {
  storageKey: string;
  getCurrent: () => PromptDraftState;
  subscribe: (listener: () => void) => () => void;
  setDraft: (draft: PromptDraftState) => void;
  setTextAndMentions: (
    nextText: string,
    nextMentions: PromptTextMention[],
  ) => void;
  setAttachments: (attachments: PromptDraftAttachment[]) => void;
  addAttachment: (attachment: PromptDraftAttachment) => void;
  updateAttachments: (
    update: (attachments: PromptDraftAttachment[]) => PromptDraftAttachment[],
  ) => void;
  clear: () => void;
  clearIfCurrentMatches: (expectedDraft: PromptDraftState) => boolean;
  restoreIfEmpty: (nextDraft: PromptDraftState) => void;
}

function createPromptDraftController(
  storageKey: string,
): PromptDraftController {
  return {
    storageKey,
    getCurrent: () => readPromptDraft(storageKey),
    subscribe: (listener) => subscribePromptDraft(storageKey, listener),
    setDraft: (draft) => writePromptDraft(storageKey, draft),
    setTextAndMentions: (nextText, nextMentions) => {
      writePromptDraft(
        storageKey,
        {
          ...readPromptDraft(storageKey),
          text: nextText,
          mentions: nextMentions,
        },
        { persist: "deferred" },
      );
    },
    setAttachments: (attachments) => {
      writePromptDraft(storageKey, {
        ...readPromptDraft(storageKey),
        attachments,
      });
    },
    addAttachment: (attachment) => {
      const currentDraft = readPromptDraft(storageKey);
      const alreadyExists = currentDraft.attachments.some(
        (existingAttachment) => existingAttachment.path === attachment.path,
      );
      if (alreadyExists) return;

      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: [...currentDraft.attachments, attachment],
      });
    },
    updateAttachments: (update) => {
      const currentDraft = readPromptDraft(storageKey);
      writePromptDraft(storageKey, {
        ...currentDraft,
        attachments: update(currentDraft.attachments),
      });
    },
    clear: () => writePromptDraft(storageKey, EMPTY_PROMPT_DRAFT),
    clearIfCurrentMatches: (expectedDraft) => {
      if (
        !arePromptDraftStatesEqual(readPromptDraft(storageKey), expectedDraft)
      ) {
        return false;
      }

      writePromptDraft(storageKey, EMPTY_PROMPT_DRAFT);
      return true;
    },
    restoreIfEmpty: (nextDraft) => {
      restorePromptDraftIfEmpty(storageKey, nextDraft);
    },
  };
}

export function getPromptDraftAccessor(
  scope: PromptDraftScope,
): PromptDraftController {
  return createPromptDraftController(getPromptDraftStorageKey(scope));
}

export function usePromptDraftController(
  scope: PromptDraftScope,
): PromptDraftController {
  const storageKey = getPromptDraftStorageKey(scope);
  return useMemo(() => createPromptDraftController(storageKey), [storageKey]);
}

type PromptDraftSource = Pick<
  PromptDraftController,
  "getCurrent" | "subscribe"
>;

export function usePromptDraftSnapshot(
  source: PromptDraftSource,
): PromptDraftState {
  return useSyncExternalStore(
    source.subscribe,
    source.getCurrent,
    () => EMPTY_PROMPT_DRAFT,
  );
}

export function usePromptDraftInputEmpty(source: PromptDraftSource): boolean {
  return useSyncExternalStore(
    source.subscribe,
    () => promptDraftToInput(source.getCurrent()).length === 0,
    () => true,
  );
}

export function usePromptDraftStorage(scope: PromptDraftScope) {
  const controller = usePromptDraftController(scope);
  const draft = usePromptDraftSnapshot(controller);

  return useMemo(
    () => ({
      ...controller,
      value: draft.text,
      text: draft.text,
      mentions: draft.mentions,
      attachments: draft.attachments,
    }),
    [controller, draft.attachments, draft.mentions, draft.text],
  );
}

export function usePromptDraftHasInput(scope: PromptDraftScope): boolean {
  const storageKey = getPromptDraftStorageKey(scope);

  return useSyncExternalStore(
    useCallback(
      (listener) => subscribePromptDraft(storageKey, listener),
      [storageKey],
    ),
    useCallback(
      () => !isPromptDraftEmpty(readPromptDraft(storageKey)),
      [storageKey],
    ),
    () => false,
  );
}

interface PromptDraftThreadRef {
  id: string;
  projectId: string;
}

interface PromptDraftThreadSubscription {
  storageKey: string;
  threadId: string;
}

function getEmptyPresenceSnapshot(): string {
  return "";
}

function readPromptDraftPresenceBit(storageKey: string): "0" | "1" {
  return isPromptDraftEmpty(readPromptDraft(storageKey)) ? "0" : "1";
}

function createPromptDraftPresenceStore(
  subscriptions: readonly PromptDraftThreadSubscription[],
): {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string;
} {
  let bits: ("0" | "1")[] | null = null;
  let snapshot: string | null = null;
  const refresh = (): string => {
    bits = subscriptions.map(({ storageKey }) =>
      readPromptDraftPresenceBit(storageKey),
    );
    snapshot = bits.join("");
    return snapshot;
  };
  return {
    getSnapshot: () => snapshot ?? refresh(),
    subscribe: (listener) => {
      snapshot = null;
      bits = null;
      const unsubscribe = subscriptions.map(({ storageKey }, index) =>
        subscribePromptDraft(storageKey, () => {
          const bit = readPromptDraftPresenceBit(storageKey);
          if (bits !== null && bits[index] === bit) return;
          if (bits === null) {
            refresh();
          } else {
            bits[index] = bit;
            snapshot = bits.join("");
          }
          listener();
        }),
      );
      return () => {
        for (const stopListening of unsubscribe) {
          stopListening();
        }
      };
    },
  };
}

export function usePromptDraftInputThreadIds(
  threads: readonly PromptDraftThreadRef[],
): ReadonlySet<string> {
  const subscriptions = useMemo<PromptDraftThreadSubscription[]>(() => {
    const seenStorageKeys = new Set<string>();
    const next: PromptDraftThreadSubscription[] = [];
    for (const thread of threads) {
      const storageKey = getPromptDraftStorageKey({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      });
      if (!storageKey || seenStorageKeys.has(storageKey)) continue;

      seenStorageKeys.add(storageKey);
      next.push({ storageKey, threadId: thread.id });
    }
    return next;
  }, [threads]);

  const presenceStore = useMemo(
    () => createPromptDraftPresenceStore(subscriptions),
    [subscriptions],
  );
  const presenceSnapshot = useSyncExternalStore(
    presenceStore.subscribe,
    presenceStore.getSnapshot,
    getEmptyPresenceSnapshot,
  );

  return useMemo(() => {
    const threadIds = new Set<string>();
    subscriptions.forEach(({ threadId }, index) => {
      if (presenceSnapshot[index] === "1") {
        threadIds.add(threadId);
      }
    });
    return threadIds;
  }, [presenceSnapshot, subscriptions]);
}
