import { useEffect, useMemo, useRef } from "react";
import type { PromptInput, ThreadStatus } from "@bb/domain";
import {
  emptyPromptDraftState,
  promptDraftToInput,
  promptInputToDraft,
  type PromptDraftState,
} from "@bb/client-core";
import { useUpdateThreadDraft } from "@/hooks/mutations/thread-runtime-mutations";
import { useLatestRef } from "@/hooks/useLatestRef";

export const SERVER_THREAD_DRAFT_SAVE_DELAY_MS = 750;

interface UseServerThreadDraftSyncArgs {
  threadId: string;
  status: ThreadStatus;
  archived: boolean;
  serverDraft: PromptInput[] | null;
  localDraft: PromptDraftState;
  setLocalDraft: (draft: PromptDraftState) => void;
}

interface PendingDraftSave {
  input: PromptInput[];
  key: string;
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortedJsonValue(entry)]),
  );
}

export function threadDraftKey(input: readonly PromptInput[] | null): string {
  if (input === null) return "";
  const canonical = promptDraftToInput(promptInputToDraft(input));
  return canonical.length === 0
    ? ""
    : JSON.stringify(sortedJsonValue(canonical));
}

export function useServerThreadDraftSync({
  threadId,
  status,
  archived,
  serverDraft,
  localDraft,
  setLocalDraft,
}: UseServerThreadDraftSyncArgs): void {
  const updateDraft = useUpdateThreadDraft();
  const updateDraftRef = useLatestRef(updateDraft.mutate);
  const serverKey = useMemo(() => threadDraftKey(serverDraft), [serverDraft]);
  const localInput = useMemo(
    () => promptDraftToInput(localDraft),
    [localDraft],
  );
  const localKey = useMemo(() => threadDraftKey(localInput), [localInput]);
  const localKeyRef = useLatestRef(localKey);
  const serverDraftRef = useLatestRef(serverDraft);
  const setLocalDraftRef = useLatestRef(setLocalDraft);
  const syncedKeyRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<PendingDraftSave | null>(null);
  const enabled = !archived && (status === "pending" || serverDraft !== null);

  useEffect(() => {
    syncedKeyRef.current = null;
    pendingSaveRef.current = null;
  }, [threadId]);

  useEffect(() => {
    const previousKey = syncedKeyRef.current;
    if (previousKey === serverKey) return;
    syncedKeyRef.current = serverKey;
    const localMatchesPrevious =
      localKeyRef.current === "" || localKeyRef.current === previousKey;
    if (!localMatchesPrevious || localKeyRef.current === serverKey) return;
    const next = serverDraftRef.current;
    setLocalDraftRef.current(
      next === null ? emptyPromptDraftState() : promptInputToDraft(next),
    );
  }, [localKeyRef, serverDraftRef, serverKey, setLocalDraftRef, threadId]);

  useEffect(() => {
    if (!enabled || localKey === syncedKeyRef.current) {
      pendingSaveRef.current = null;
      return;
    }
    const save = { input: localInput, key: localKey };
    pendingSaveRef.current = save;
    const timer = setTimeout(
      () => {
        pendingSaveRef.current = null;
        syncedKeyRef.current = save.key;
        updateDraftRef.current({ id: threadId, input: save.input });
      },
      localKey === "" ? 0 : SERVER_THREAD_DRAFT_SAVE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [enabled, localInput, localKey, threadId, updateDraftRef]);

  useEffect(
    () => () => {
      const pending = pendingSaveRef.current;
      if (pending === null) return;
      pendingSaveRef.current = null;
      syncedKeyRef.current = pending.key;
      updateDraftRef.current({ id: threadId, input: pending.input });
    },
    [threadId, updateDraftRef],
  );
}
