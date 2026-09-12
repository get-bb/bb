import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import { beginSidebarPaneContentSplitDrag } from "./usePaneContentSplitDrag";

interface UseThreadRowSplitDragArgs {
  projectId: string;
  threadId: string;
  title: string;
}

export function useThreadRowSplitDrag({
  projectId,
  threadId,
  title,
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
        label: title,
      });
    },
    [navigate, projectId, store, threadId, title],
  );

  const openInSplit = useCallback(() => {
    openThreadInSplit({
      store,
      navigate,
      projectId,
      threadId,
      isCompact,
    });
  }, [isCompact, navigate, projectId, store, threadId]);

  return {
    onPointerDown: !isCompact ? onPointerDown : undefined,
    openInSplit,
  };
}
