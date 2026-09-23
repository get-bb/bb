import { resolveThreadMentionDropTarget } from "@/lib/thread-mention-drop";
import {
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "jotai";
import { useNavigate } from "react-router-dom";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  getPluginDetailRoutePath,
} from "@/lib/route-paths";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { openPaneContentInSplit } from "@/lib/split-layout/openPaneContentInSplit";
import {
  countPanes,
  findPaneByContent,
  listPanes,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "@/lib/split-layout";
import {
  beginSplitDrag,
  decideThreadDrop,
  shouldEngageSidebarSplitDrag,
  type SplitDragFallbackTarget,
} from "@/lib/split-drag";

const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';
const MAIN_CONTENT_SELECTOR = "main";

function routeForContent(content: PaneContent): string {
  if (content.kind === "thread") return getThreadRoutePath(content);
  if (content.kind === "new-thread") return getRootComposeRoutePath();
  if (content.kind === "plugin-detail") {
    return getPluginDetailRoutePath({ pluginId: content.pluginId });
  }
  return getPluginPanelRoutePath({
    pluginId: content.pluginId,
    path: content.panelPath,
    subPath: content.subPath,
  });
}

export function usePaneContentSplitDrag(options: PaneContentSplitOptions) {
  const actions = usePaneContentSplitActions();
  const openInSplit = useCallback(
    () => actions.openInSplit(options),
    [actions, options],
  );
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) =>
      actions.beginDrag(event, options),
    [actions, options],
  );

  return {
    onPointerDown:
      options.enabled && !actions.isCompact ? onPointerDown : undefined,
    openInSplit,
  };
}

interface PaneContentSplitOptions {
  content: PaneContent;
  enabled: boolean;
  label: string;
  onNavigate?: () => void;
  onDragStart?: () => void;
  dragActivation?: "sidebar" | "distance";
}

export function usePaneContentSplitActions() {
  const store = useStore();
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();

  const openInSplit = useCallback(
    ({ content, enabled, onNavigate }: PaneContentSplitOptions) => {
      onNavigate?.();
      openPaneContentInSplit({
        store,
        navigate,
        content,
        route: routeForContent(content),
        enabled: enabled && !isCompact,
      });
    },
    [isCompact, navigate, store],
  );

  const onPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      {
        content,
        enabled,
        label,
        onNavigate,
        onDragStart,
        dragActivation,
      }: PaneContentSplitOptions,
    ) => {
      if (!enabled || isCompact || event.button !== 0) return;
      beginSidebarPaneContentSplitDrag({
        event,
        store,
        navigate,
        content,
        label,
        onNavigate,
        onDragStart,
        dragActivation,
      });
    },
    [isCompact, navigate, store],
  );

  return useMemo(
    () => ({ beginDrag: onPointerDown, isCompact, openInSplit }),
    [isCompact, onPointerDown, openInSplit],
  );
}

interface BeginSidebarPaneContentSplitDragArgs {
  event: ReactPointerEvent<HTMLElement>;
  store: ReturnType<typeof useStore>;
  navigate: (
    route: string,
    options?: { replace?: boolean },
  ) => void | Promise<void>;
  content: PaneContent;
  label: string;
  onNavigate?: () => void;
  onDragStart?: () => void;
  dragActivation?: "sidebar" | "distance";
}

export function beginSidebarPaneContentSplitDrag({
  event,
  store,
  navigate,
  content,
  label,
  onNavigate,
  onDragStart,
  dragActivation = "sidebar",
}: BeginSidebarPaneContentSplitDragArgs): void {
  const rowEl = event.currentTarget;
  const sidebarEl = rowEl.closest(SIDEBAR_SELECTOR);
  const sidebarRightEdge = (sidebarEl ?? rowEl).getBoundingClientRect().right;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLayout = store.get(splitLayoutAtom);
  const fallback = singlePaneFallback(startLayout);
  beginSplitDrag({
    ghostLabel: label,
    cancelSidebarReorderOnEngage: true,
    resolveAuxiliaryTarget:
      content.kind === "thread"
        ? (x, y) =>
            resolveThreadMentionDropTarget(x, y, {
              threadId: content.threadId,
              label,
            })
        : undefined,
    sourceEl: rowEl,
    fadeSourceOnEngage: false,
    renderGhost: false,
    onEngage: onDragStart,
    ...(fallback ? { fallback } : {}),
    shouldEngage: (x, y) =>
      dragActivation === "distance"
        ? Math.hypot(x - startX, y - startY) > 12
        : shouldEngageSidebarSplitDrag({
            startX,
            startY,
            x,
            y,
            sidebarRightEdge,
          }),
    decide: (_paneId, zone) => {
      const layout = store.get(splitLayoutAtom);
      if (layout === null) return null;
      return decideThreadDrop({
        zone,
        threadAlreadyOpen: findPaneByContent(layout.root, content) !== null,
        atMaxPanes: countPanes(layout.root) >= MAX_PANES,
      });
    },
    onDrop: (target) => {
      const layout = store.get(splitLayoutAtom);
      if (layout === null) return;
      const existing = findPaneByContent(layout.root, content);
      const next =
        existing !== null
          ? setFocus(layout, existing.paneId)
          : target.zone === "center"
            ? replacePaneContent(layout, target.paneId, content)
            : splitPane(layout, target.paneId, target.zone, content);
      if (next !== layout) store.set(splitLayoutAtom, next);
      onNavigate?.();
      void navigate(
        routeForContent(content),
        existing !== null ? { replace: true } : undefined,
      );
    },
  });
}

function singlePaneFallback(
  layout: SplitLayout | null,
): SplitDragFallbackTarget | null {
  if (layout === null) return null;
  const panes = listPanes(layout.root);
  const only = panes[0];
  if (panes.length !== 1 || only === undefined) return null;
  return {
    paneId: only.paneId,
    container: document.querySelector<HTMLElement>(MAIN_CONTENT_SELECTOR),
  };
}
