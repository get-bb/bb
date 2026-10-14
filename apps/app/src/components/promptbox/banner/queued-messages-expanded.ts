import { useCallback, useEffect } from "react";
import { atom, useAtom } from "jotai";
import type { ThreadQueuedMessage } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";

type CollapsedQueues = ReadonlyMap<string, ReadonlySet<string>>;

export const queuedMessagesCollapsedQueuesAtom = atom<CollapsedQueues>(
  new Map<string, ReadonlySet<string>>(),
);

const mobileExpandedQueuesAtom = atom<ReadonlyMap<string, ReadonlySet<string>>>(
  new Map<string, ReadonlySet<string>>(),
);

function sharesQueuedMessage(
  queuedMessages: readonly ThreadQueuedMessage[],
  seenIds: ReadonlySet<string>,
): boolean {
  return queuedMessages.some((queuedMessage) => seenIds.has(queuedMessage.id));
}

export function setQueueExpanded(
  current: CollapsedQueues,
  threadId: string,
  expanded: boolean,
  queuedMessages: readonly ThreadQueuedMessage[] | null,
  defaultExpanded = true,
): CollapsedQueues {
  if (expanded === (defaultExpanded !== current.has(threadId))) return current;
  const next = new Map(current);
  if (expanded === defaultExpanded) {
    next.delete(threadId);
  } else {
    next.set(
      threadId,
      new Set((queuedMessages ?? []).map((queuedMessage) => queuedMessage.id)),
    );
  }
  return next;
}

export function nextCollapsedQueues(
  current: CollapsedQueues,
  threadId: string,
  queuedMessages: readonly ThreadQueuedMessage[],
): CollapsedQueues {
  const seenIds = current.get(threadId);
  if (seenIds === undefined) return current;
  if (!sharesQueuedMessage(queuedMessages, seenIds)) {
    const next = new Map(current);
    next.delete(threadId);
    return next;
  }
  if (queuedMessages.every((queuedMessage) => seenIds.has(queuedMessage.id))) {
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
}

export function isQueueExpanded(
  collapsedQueues: CollapsedQueues,
  threadId: string,
  queuedMessages: readonly ThreadQueuedMessage[] | null,
): boolean {
  const seenIds = collapsedQueues.get(threadId);
  return (
    seenIds === undefined ||
    (queuedMessages !== null && !sharesQueuedMessage(queuedMessages, seenIds))
  );
}

export function useQueuedMessagesExpanded({
  threadId,
  queuedMessages,
}: {
  threadId: string;
  queuedMessages: readonly ThreadQueuedMessage[] | null;
}): readonly [boolean, (expanded: boolean) => void] {
  const defaultExpanded = !useIsCompactViewport();
  const [toggledQueues, setToggledQueues] = useAtom(
    defaultExpanded
      ? queuedMessagesCollapsedQueuesAtom
      : mobileExpandedQueuesAtom,
  );
  const setExpanded = useCallback(
    (expanded: boolean) => {
      setToggledQueues((current) =>
        setQueueExpanded(
          current,
          threadId,
          expanded,
          queuedMessages,
          defaultExpanded,
        ),
      );
    },
    [defaultExpanded, queuedMessages, setToggledQueues, threadId],
  );
  useEffect(() => {
    if (queuedMessages === null) return;
    setToggledQueues((current) =>
      nextCollapsedQueues(current, threadId, queuedMessages),
    );
  }, [queuedMessages, setToggledQueues, threadId]);
  const usesDefault = isQueueExpanded(toggledQueues, threadId, queuedMessages);
  return [usesDefault ? defaultExpanded : !defaultExpanded, setExpanded];
}
