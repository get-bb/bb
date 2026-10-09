import { useCallback, useEffect } from "react";
import { atom, useAtom } from "jotai";
import type { ThreadQueuedMessage } from "@bb/domain";

export const queuedMessagesCollapsedQueuesAtom = atom<
  ReadonlyMap<string, ReadonlySet<string>>
>(new Map<string, ReadonlySet<string>>());

function sharesQueuedMessage(
  queuedMessages: readonly ThreadQueuedMessage[],
  seenIds: ReadonlySet<string>,
): boolean {
  return queuedMessages.some((queuedMessage) => seenIds.has(queuedMessage.id));
}

export function useQueuedMessagesExpanded({
  threadId,
  queuedMessages,
}: {
  threadId: string;
  queuedMessages: readonly ThreadQueuedMessage[] | null;
}): readonly [boolean, (expanded: boolean) => void] {
  const [collapsedQueues, setCollapsedQueues] = useAtom(
    queuedMessagesCollapsedQueuesAtom,
  );
  const setExpanded = useCallback(
    (expanded: boolean) => {
      setCollapsedQueues((current) => {
        if (expanded === !current.has(threadId)) return current;
        const next = new Map(current);
        if (expanded) {
          next.delete(threadId);
        } else {
          next.set(
            threadId,
            new Set(
              (queuedMessages ?? []).map((queuedMessage) => queuedMessage.id),
            ),
          );
        }
        return next;
      });
    },
    [queuedMessages, setCollapsedQueues, threadId],
  );
  useEffect(() => {
    if (queuedMessages === null) return;
    setCollapsedQueues((current) => {
      const seenIds = current.get(threadId);
      if (seenIds === undefined) return current;
      if (!sharesQueuedMessage(queuedMessages, seenIds)) {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      }
      if (
        queuedMessages.every((queuedMessage) => seenIds.has(queuedMessage.id))
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(
        threadId,
        new Set([
          ...seenIds,
          ...queuedMessages.map((queuedMessage) => queuedMessage.id),
        ]),
      );
      return next;
    });
  }, [queuedMessages, setCollapsedQueues, threadId]);
  const seenIds = collapsedQueues.get(threadId);
  const expanded =
    seenIds === undefined ||
    (queuedMessages !== null && !sharesQueuedMessage(queuedMessages, seenIds));
  return [expanded, setExpanded];
}
