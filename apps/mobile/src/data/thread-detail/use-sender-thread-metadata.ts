import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import {
  createSenderThreadMetadataStore,
  type SenderThreadMetadata,
} from "./sender-thread-metadata";

/**
 * Sender-thread titles/origins for generated conversation rows, rebuilt from
 * the query cache whenever a thread, thread list, or sidebar query updates.
 * Value-equal rebuilds keep the previous map so consumers (every generated
 * row) do not re-render on unrelated cache events. Mount once per timeline
 * and pass the map down through context.
 */
export function useSenderThreadMetadataById(): ReadonlyMap<
  string,
  SenderThreadMetadata
> {
  const queryClient = useQueryClient();
  const store = useMemo(
    () => createSenderThreadMetadataStore(queryClient),
    [queryClient],
  );
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}
