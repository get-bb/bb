import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  appendQuoteAndAttachmentsToDraft,
  arePromptDraftStatesEqual,
  emptyPromptDraftState,
  isPromptDraftEmpty,
  type PromptDraftState,
} from "@bb/client-core";
import type { DraftContent, DraftContentInput } from "@bb/server-contract";
import type { usePromptDraftStorage } from "./usePromptDraftStorage";
import {
  draftResourceApi,
  draftResourceQueryKey,
} from "@/lib/drafts/resource-api";
import { getDraftResourceStore } from "@/lib/drafts/resource-runtime";

export {
  createNewThreadDraft,
  getDraftResourceStore,
} from "@/lib/drafts/resource-runtime";

const EMPTY_PROMPT = emptyPromptDraftState();

export function useRecoverableDrafts() {
  const queryClient = useQueryClient();
  const store = getDraftResourceStore(queryClient);
  const drafts = useSyncExternalStore(
    store.subscribeRecoverable,
    store.getRecoverableSnapshot,
    store.getRecoverableSnapshot,
  );
  useEffect(() => {
    store.resumeRecoveries();
  }, [store]);
  return drafts;
}

export function useDraftResource(id: string) {
  const queryClient = useQueryClient();
  const store = getDraftResourceStore(queryClient);
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(id, listener),
    [id, store],
  );
  const getSnapshot = useCallback(() => store.getSnapshot(id), [id, store]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const query = useQuery({
    queryKey: draftResourceQueryKey(id),
    queryFn: ({ signal }) => draftResourceApi.get(id, signal),
    enabled: snapshot.status !== "deleted",
  });
  useEffect(() => {
    store.resumeRecoveries();
  }, [store]);

  const prompt = snapshot.content?.prompt ?? EMPTY_PROMPT;
  const promptDraft = useMemo<ReturnType<typeof usePromptDraftStorage>>(() => {
    const getCurrent = (): PromptDraftState =>
      store.getSnapshot(id).content?.prompt ?? EMPTY_PROMPT;
    const setDraft = (next: PromptDraftState): void => {
      store.edit(id, (content) => ({ ...content, prompt: next }));
    };
    return {
      storageKey: `draft-resource:${id}`,
      getCurrent,
      subscribe,
      value: prompt.text,
      text: prompt.text,
      mentions: prompt.mentions,
      attachments: prompt.attachments,
      setDraft,
      setTextAndMentions: (text, mentions) =>
        setDraft({ ...getCurrent(), text, mentions }),
      setAttachments: (attachments) =>
        setDraft({ ...getCurrent(), attachments }),
      addAttachment: (attachment) => {
        const current = getCurrent();
        if (current.attachments.some((item) => item.path === attachment.path))
          return;
        setDraft({
          ...current,
          attachments: [...current.attachments, attachment],
        });
      },
      removeAttachment: (path) => {
        const current = getCurrent();
        setDraft({
          ...current,
          attachments: current.attachments.filter((item) => item.path !== path),
        });
      },
      addQuote: (text, attachments = []) =>
        setDraft(
          appendQuoteAndAttachmentsToDraft(getCurrent(), text, attachments),
        ),
      clear: () => {
        void store.delete(id).catch(() => {});
      },
      clearIfCurrentMatches: (expected) => {
        if (!arePromptDraftStatesEqual(getCurrent(), expected)) return false;
        void store.delete(id).catch(() => {});
        return true;
      },
      restoreIfEmpty: (next) => {
        if (!isPromptDraftEmpty(next) && isPromptDraftEmpty(getCurrent()))
          setDraft(next);
      },
    };
  }, [id, prompt, store, subscribe]);

  const actions = useMemo(
    () => ({
      edit: (updater: (content: DraftContent) => DraftContentInput) =>
        store.edit(id, updater),
      flush: () => store.flush(id),
      submit: () => store.submit(id),
      delete: () => store.delete(id),
      retry: () => store.retry(id),
      reloadRemote: () => store.reloadRemote(id),
      saveLocalAsCopy: (index?: number) => store.saveLocalAsCopy(id, index),
    }),
    [id, store],
  );

  return {
    ...snapshot,
    status:
      query.isError && snapshot.status === "loading"
        ? ("error" as const)
        : snapshot.status,
    error: snapshot.error ?? query.error,
    promptDraft,
    ...actions,
  };
}
