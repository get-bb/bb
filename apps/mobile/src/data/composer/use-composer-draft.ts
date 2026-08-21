import type { PromptDraftAttachment } from "@bb/client-core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  composerValueFromDraftState,
  composerValueToDraftState,
  type ComposerValue,
} from "@/composer/model";
import {
  composerDraftStorageKey,
  createComposerDraftStore,
  type ComposerDraftScope,
  type ComposerDraftStore,
} from "./composer-draft-store";
import { createComposerDraftStorage } from "./composer-draft-storage";

let defaultStore: ComposerDraftStore | null = null;

/** App-wide draft store (client-local, not per server profile). */
function getComposerDraftStore(): ComposerDraftStore {
  defaultStore ??= createComposerDraftStore(createComposerDraftStorage());
  return defaultStore;
}

export interface ComposerDraft {
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
  setValue: (value: ComposerValue) => void;
  setAttachments: (
    update:
      | PromptDraftAttachment[]
      | ((current: PromptDraftAttachment[]) => PromptDraftAttachment[]),
  ) => void;
  /** Replace both halves at once (seeding, restore from a queued message). */
  replace: (
    value: ComposerValue,
    attachments: readonly PromptDraftAttachment[],
  ) => void;
  /** Drop the draft (after a successful submit). Persisted immediately. */
  clear: () => void;
  /** True when the scope had a stored draft when it was (re)mounted. */
  restored: boolean;
}

interface DraftSnapshot {
  key: string;
  value: ComposerValue;
  attachments: PromptDraftAttachment[];
  restored: boolean;
}

function readSnapshot(
  store: ComposerDraftStore,
  scope: ComposerDraftScope,
): DraftSnapshot {
  const stored = store.read(scope);
  const { value, attachments } = composerValueFromDraftState(stored);
  return {
    key: composerDraftStorageKey(scope),
    value,
    attachments,
    restored:
      stored.text.length > 0 ||
      stored.mentions.length > 0 ||
      stored.attachments.length > 0,
  };
}

/**
 * The persisted draft for one composer scope: restored from storage when the
 * scope mounts (or changes), written back debounced on every change, flushed
 * when the app backgrounds or the scope unmounts. `value` is the display-text
 * model; persistence uses the web-compatible serialized form.
 */
export function useComposerDraft(
  scope: ComposerDraftScope,
  store: ComposerDraftStore = getComposerDraftStore(),
): ComposerDraft {
  const key = composerDraftStorageKey(scope);
  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);
  const [snapshot, setSnapshot] = useState<DraftSnapshot>(() =>
    readSnapshot(store, scope),
  );
  // Scope changed under the same hook instance: re-read (no effect, no flash).
  const current = snapshot.key === key ? snapshot : readSnapshot(store, scope);
  if (current !== snapshot) setSnapshot(current);
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const commit = useCallback(
    (
      value: ComposerValue,
      attachments: PromptDraftAttachment[],
      persist: "immediate" | "deferred",
    ) => {
      const next: DraftSnapshot = {
        key: currentRef.current.key,
        value,
        attachments,
        restored: currentRef.current.restored,
      };
      currentRef.current = next;
      setSnapshot(next);
      store.write(
        scopeRef.current,
        composerValueToDraftState(value, attachments),
        { persist },
      );
    },
    [store],
  );

  const setValue = useCallback(
    (value: ComposerValue) =>
      commit(value, currentRef.current.attachments, "deferred"),
    [commit],
  );
  const setAttachments = useCallback<ComposerDraft["setAttachments"]>(
    (update) => {
      const existing = currentRef.current.attachments;
      const next = typeof update === "function" ? update(existing) : update;
      commit(currentRef.current.value, next, "immediate");
    },
    [commit],
  );
  const replace = useCallback<ComposerDraft["replace"]>(
    (value, attachments) => commit(value, [...attachments], "immediate"),
    [commit],
  );
  const clear = useCallback(() => {
    store.clear(scopeRef.current);
    const next: DraftSnapshot = {
      key: currentRef.current.key,
      value: { text: "", mentions: [] },
      attachments: [],
      restored: false,
    };
    currentRef.current = next;
    setSnapshot(next);
  }, [store]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") store.flush();
    });
    return () => {
      subscription.remove();
      store.flush();
    };
  }, [store]);

  return {
    value: current.value,
    attachments: current.attachments,
    setValue,
    setAttachments,
    replace,
    clear,
    restored: current.restored,
  };
}
