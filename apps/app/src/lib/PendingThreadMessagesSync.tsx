import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { invalidateThreadQueuedMessageListQuery } from "@/hooks/cache-owners/mutation-cache-effects";
import { BbHttpError, sdk } from "./sdk";
import { wsManager } from "./ws";
import {
  removePendingThreadMessage,
  savePendingThreadMessage,
  usePendingThreadMessages,
  type PendingThreadMessage,
} from "./pending-thread-messages";

function retryable(error: unknown): boolean {
  return (
    !(error instanceof BbHttpError) ||
    error.status >= 500 ||
    error.status === 429 ||
    error.status === 408
  );
}

function PendingDelivery({ entry }: { entry: PendingThreadMessage }) {
  const queryClient = useQueryClient();
  const connection = useServerConnectionState();
  const mutation = useMutation({
    mutationKey: ["deliver-pending-thread-message", entry.row.id],
    meta: { showErrorToast: false },
    retry: (_count, error) =>
      retryable(error) && wsManager.getConnectionState() === "connected",
    mutationFn: async () => {
      if (wsManager.getConnectionState() !== "connected")
        throw new Error("Waiting for connection");
      const { id, ...request } = entry.request;
      const signal = AbortSignal.timeout(30_000);
      const result =
        entry.operation === "queue"
          ? await sdk.threads.queuedMessages.create({
              ...request,
              threadId: id,
              signal,
            })
          : await sdk.threads
              .send({
                ...request,
                threadId: id,
                mode:
                  entry.operation === "steer"
                    ? "steer-if-active"
                    : "queue-if-active",
                signal,
              })
              .then((result) =>
                result.delivery === "queued" ? result.queuedMessage : null,
              );
      if (result?.clientSubmissionId !== request.clientSubmissionId)
        throw new Error("Waiting for server confirmation");
      invalidateThreadQueuedMessageListQuery({ queryClient, threadId: id });
      removePendingThreadMessage(entry.row.id);
    },
    onError: (error) => {
      if (!retryable(error))
        savePendingThreadMessage({
          ...entry,
          error:
            error instanceof Error ? error.message : "Message was rejected",
        });
    },
  });
  const { mutate } = mutation;
  useEffect(() => {
    if (
      connection === "connected" &&
      queryClient.isMutating({
        mutationKey: ["deliver-pending-thread-message", entry.row.id],
      }) === 0
    )
      mutate();
  }, [connection, mutate, queryClient, entry.row.id]);
  return null;
}

export function PendingThreadMessagesSync() {
  const entries = usePendingThreadMessages();
  const { data: config } = useSystemConfig();
  if (!config?.messageSubmissionKeys) return null;
  const threads = new Set<string>();
  return entries
    .filter((entry) => {
      if (entry.error || threads.has(entry.request.id)) return false;
      threads.add(entry.request.id);
      return true;
    })
    .map((entry) => <PendingDelivery key={entry.row.id} entry={entry} />);
}
