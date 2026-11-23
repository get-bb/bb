import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { openThread } from "@/lib/split-layout/openThread";
import type { DroppedThreadMention } from "@/lib/thread-mention-drop";
import { beginSidebarPaneContentSplitDrag } from "./usePaneContentSplitDrag";

interface UseThreadRowSplitDragArgs {
  projectId: string;
  threadId: string;
  getTitle: () => string;
  getMentionThreads?: () => readonly DroppedThreadMention[] | undefined;
}

export function useThreadRowSplitDrag({
  projectId,
  threadId,
  getTitle,
  getMentionThreads,
}: UseThreadRowSplitDragArgs): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
  openInSplit: () => void;
} {
  const store = useStore();
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      beginSidebarPaneContentSplitDrag({
        event,
        store,
        navigate,
        content: { kind: "thread", projectId, threadId },
        label: getTitle(),
        mentionThreads: getMentionThreads?.(),
      });
    },
    [getMentionThreads, getTitle, navigate, projectId, store, threadId],
  );

  const openInSplit = useCallback(() => {
    openThread({
      navigate,
      projectId,
      threadId,
      split: { zone: "right", store, isCompact },
    });
  }, [isCompact, navigate, projectId, store, threadId]);

  return {
    onPointerDown: !isCompact ? onPointerDown : undefined,
    openInSplit,
  };
}
