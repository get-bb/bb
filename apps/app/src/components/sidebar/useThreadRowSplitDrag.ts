import { useCallback, type PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "jotai";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import { getThreadRoutePath } from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  countPanes,
  findPaneByThread,
  listPanes,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type SplitLayout,
  type PaneContent,
} from "@/lib/split-layout";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import {
  beginSplitDrag,
  decideThreadDrop,
  shouldEngageSidebarSplitDrag,
  type SplitDragFallbackTarget,
} from "@/lib/split-drag";

interface UseThreadRowSplitDragArgs {
  projectId: string;
  threadId: string;
  title: string;
}

const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';
// The single-pane surface renders no wrapper element, so its drop target is the
// whole main content region.
const MAIN_CONTENT_SELECTOR = "main";

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
  /**
   * Opens this thread in the split via the second entry point (cmd/ctrl-click,
   * context-menu "Open in split"), using the SAME placement rules as drag:
   * default to a right split, focus the pane if already open, and coerce to
   * replace at the pane cap. Falls back to plain navigation on compact
   * viewports (splits disabled) and non-thread routes (no layout to split).
   */
  openInSplit: () => void;
} {
  const store = useStore();
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!threadSplitsEnabled || event.button !== 0) {
        return;
      }
      const rowEl = event.currentTarget;
      const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
      const sidebarRightEdge = (sidebarEl ?? rowEl).getBoundingClientRect()
        .right;
      const startX = event.clientX;
      const startY = event.clientY;
      const content: PaneContent = { kind: "thread", projectId, threadId };
      const startLayout = store.get(splitLayoutAtom);
      const fallback = singlePaneFallback(startLayout);

      beginSplitDrag(startX, startY, {
        ghostLabel: title,
        sourceEl: rowEl,
        cancelSidebarReorderOnEngage: true,
        ...(fallback ? { fallback } : {}),
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
    [navigate, projectId, store, threadId, threadSplitsEnabled, title],
  );

  const openInSplit = useCallback(() => {
    openThreadInSplit({
      store,
      navigate,
      projectId,
      threadId,
      isCompact,
      threadSplitsEnabled,
    });
  }, [isCompact, navigate, projectId, store, threadId, threadSplitsEnabled]);

  return {
    onPointerDown:
      threadSplitsEnabled && !isCompact ? onPointerDown : undefined,
    openInSplit,
  };
}

// The single-pane surface renders no `[data-split-pane-id]` wrapper, so drops
// hit-test against the main content region instead. Only meaningful when the
// layout holds exactly one pane; multi-pane layouts have real pane elements.
function singlePaneFallback(
  layout: SplitLayout | null,
): SplitDragFallbackTarget | null {
  if (layout === null) {
    return null;
  }
  const panes = listPanes(layout.root);
  const only = panes[0];
  if (panes.length !== 1 || only === undefined) {
    return null;
  }
  return {
    paneId: only.paneId,
    container: document.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR),
  };
}
