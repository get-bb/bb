import { useCallback, useEffect } from "react";
import { atom, useAtom } from "jotai";

export const queuedMessagesCollapsedThreadIdsAtom = atom<ReadonlySet<string>>(
  new Set<string>(),
);

export function useQueuedMessagesExpanded({
  threadId,
  queueIsEmpty,
}: {
  threadId: string;
  queueIsEmpty: boolean;
}): readonly [boolean, (expanded: boolean) => void] {
  const [collapsedThreadIds, setCollapsedThreadIds] = useAtom(
    queuedMessagesCollapsedThreadIdsAtom,
  );
  const setExpanded = useCallback(
    (expanded: boolean) => {
      setCollapsedThreadIds((current) => {
        const collapsed = !expanded;
        if (current.has(threadId) === collapsed) return current;
        const next = new Set(current);
        if (expanded) next.delete(threadId);
        else next.add(threadId);
        return next;
      });
    },
    [setCollapsedThreadIds, threadId],
  );
  useEffect(() => {
    if (queueIsEmpty) setExpanded(true);
  }, [queueIsEmpty, setExpanded]);
  return [!collapsedThreadIds.has(threadId), setExpanded];
}
