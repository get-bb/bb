import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { getThreadRoutePath } from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  findPaneByThread,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
} from "@/lib/split-layout";
import {
  beginSplitDrag,
  decideThreadDrop,
  shouldEngageSidebarSplitDrag,
} from "@/lib/split-drag";

interface UseThreadRowSplitDragArgs {
  projectId: string;
  threadId: string;
  title: string;
}

const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';

/**
 * Makes a sidebar thread row a drag source for the split area via the shared
 * pointer-driven layer. It engages only once the pointer leaves the sidebar
 * toward the main area (so the existing dnd-kit vertical reorder always wins
 * inside the sidebar — plan §3), then hit-tests panes: an edge splits, the
 * center replaces, and a thread already open focuses its pane instead of
 * duplicating. The layout ops enforce the pane cap and no-duplicate invariants;
 * this only picks targets. Disabled on compact viewports, where splits are off.
 */
export function useThreadRowSplitDrag({
  projectId,
  threadId,
  title,
}: UseThreadRowSplitDragArgs): {
  onPointerDown: ((event: ReactPointerEvent<HTMLElement>) => void) | undefined;
} {
  const store = useStore();
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      const rowEl = event.currentTarget;
      const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
      const sidebarRightEdge = (
        sidebarEl ?? rowEl
      ).getBoundingClientRect().right;
      const startX = event.clientX;
      const startY = event.clientY;
      const content: PaneContent = { kind: "thread", projectId, threadId };

      beginSplitDrag(startX, startY, {
        ghostLabel: title,
        sourceEl: rowEl,
        shouldEngage: (x, y) =>
          shouldEngageSidebarSplitDrag({
            startX,
            startY,
            x,
            y,
            sidebarRightEdge,
          }),
        decide: (_paneId, zone) => {
          const layout = store.get(splitLayoutAtom);
          if (layout === null) {
            return null;
          }
          return decideThreadDrop({
            zone,
            threadAlreadyOpen:
              findPaneByThread(layout.root, projectId, threadId) !== null,
            atMaxPanes: countPanes(layout.root) >= MAX_PANES,
          });
        },
        onDrop: (target) => {
          const layout = store.get(splitLayoutAtom);
          if (layout === null) {
            return;
          }
          const existing = findPaneByThread(layout.root, projectId, threadId);
          const next =
            existing !== null
              ? setFocus(layout, existing.paneId)
              : target.zone === "center"
                ? replacePaneContent(layout, target.paneId, content)
                : splitPane(layout, target.paneId, target.zone, content);
          if (next !== layout) {
            store.set(splitLayoutAtom, next);
          }
          // The dropped thread now owns the focused pane, so the URL follows it.
          // An already-open focus is a replace (no history entry); a split or
          // replace pushes like a sidebar click.
          navigate(
            getThreadRoutePath({ projectId, threadId }),
            existing !== null ? { replace: true } : undefined,
          );
        },
      });
    },
    [navigate, projectId, store, threadId, title],
  );

  return { onPointerDown: isCompact ? undefined : onPointerDown };
}
