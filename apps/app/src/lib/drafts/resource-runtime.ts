import type { QueryClient } from "@tanstack/react-query";
import type { DraftContentInput } from "@bb/server-contract";
import { appQueryClient } from "../app-query-client";
import { draftResourceApi } from "./resource-api";
import { browserDraftRecoveryStorage } from "./recovery";
import { DraftResourceStore } from "./resource-store";

const stores = new WeakMap<QueryClient, DraftResourceStore>();

export function getDraftResourceStore(
  queryClient = appQueryClient,
): DraftResourceStore {
  let store = stores.get(queryClient);
  if (!store) {
    store = new DraftResourceStore(
      queryClient,
      draftResourceApi,
      browserDraftRecoveryStorage(),
    );
    stores.set(queryClient, store);
  }
  return store;
}

export function createNewThreadDraft(initial: DraftContentInput): string {
  return getDraftResourceStore().create(initial);
}

export function initializeNewThreadDraft(
  id: string,
  initial: DraftContentInput,
): boolean {
  return getDraftResourceStore().initialize(id, initial);
}
