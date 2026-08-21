import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import type { ThreadOpenSplit, ThreadPaneAction } from "@bb/server-contract";
import {
  countPanes,
  findPane,
  findPaneByContent,
  findPaneByThread,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
} from "@/lib/split-layout";
import { decideThreadDrop, type SplitZone } from "@/lib/split-drag";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";
import {
  getPluginPanelRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";

const FIRST_PANE_ID = "pane-1";

export function threadPaneContent(thread: ThreadRoutePathArgs): PaneContent {
  return {
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.threadId,
  };
}

export function createSinglePaneLayout(
  thread: ThreadRoutePathArgs,
): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: FIRST_PANE_ID,
      content: threadPaneContent(thread),
    },
    focusedPaneId: FIRST_PANE_ID,
  };
}

function createSinglePaneContentLayout(content: PaneContent): SplitLayout {
  return {
    root: { type: "pane", paneId: FIRST_PANE_ID, content },
    focusedPaneId: FIRST_PANE_ID,
  };
}

export function paneContentRoute(content: PaneContent): string {
  if (content.kind === "thread") {
    return getThreadRoutePath(content);
  }
  if (content.kind === "new-thread") {
    return getRootComposeRoutePath();
  }
  return getPluginPanelRoutePath({
    pluginId: content.pluginId,
    path: content.panelPath,
    subPath: content.subPath,
  });
}

/** Reconciles any splittable page route into the focused pane. */
export function reconcileLayoutForContent(
  layout: SplitLayout | null,
  content: PaneContent,
): SplitLayout {
  if (layout === null) {
    return createSinglePaneContentLayout(content);
  }
  const existing = findPaneByContent(layout.root, content);
  if (existing !== null) {
    const withRouteState =
      existing.content.kind === "plugin-panel" &&
      content.kind === "plugin-panel" &&
      existing.content.subPath !== content.subPath
        ? replacePaneContent(layout, existing.paneId, content)
        : layout;
    return withRouteState.focusedPaneId === existing.paneId
      ? withRouteState
      : setFocus(withRouteState, existing.paneId);
  }
  return replacePaneContent(layout, layout.focusedPaneId, content);
}

export function focusedPaneRoute(layout: SplitLayout): string | null {
  const focused = findPane(layout.root, layout.focusedPaneId);
  return focused === null ? null : paneContentRoute(focused.content);
}

function threadOpenSplitZone(split: ThreadOpenSplit): SplitZone {
  return split === "replace" ? "center" : split === "down" ? "bottom" : split;
}

/**
 * Applies a CLI/SDK thread-open intent to the current layout. This deliberately
 * routes through the same drop decision as sidebar dragging so already-open
 * threads focus, and edge splits at the pane cap coerce to replacement.
 */
export function applyThreadOpenToLayout(
  layout: SplitLayout | null,
  thread: ThreadRoutePathArgs,
  split: ThreadOpenSplit,
): SplitLayout {
  if (layout === null) {
    return createSinglePaneLayout(thread);
  }
  const existing = findPaneByThread(
    layout.root,
    thread.projectId,
    thread.threadId,
  );
  const decision = decideThreadDrop({
    zone: threadOpenSplitZone(split),
    threadAlreadyOpen: existing !== null,
    atMaxPanes: countPanes(layout.root) >= MAX_PANES,
  });
  if (existing !== null) {
    return layout.focusedPaneId === existing.paneId
      ? layout
      : setFocus(layout, existing.paneId);
  }
  const content = threadPaneContent(thread);
  return decision.zone === "center"
    ? replacePaneContent(layout, layout.focusedPaneId, content)
    : splitPane(layout, layout.focusedPaneId, decision.zone, content);
}

interface ThreadPaneActionLayoutResult {
  layout: SplitLayout;
  maximizedPaneId: string | null;
  /** Explicit preference update requested by the action, or null when unchanged. */
  dimInactiveSplits: boolean | null;
}

/** Apply one CLI/SDK pane action without creating or replacing pane content. */
export function applyThreadPaneActionToLayout(
  layout: SplitLayout,
  maximizedPaneId: string | null,
  thread: ThreadRoutePathArgs,
  action: ThreadPaneAction,
): ThreadPaneActionLayoutResult {
  const pane = findPaneByThread(layout.root, thread.projectId, thread.threadId);
  if (pane === null || countPanes(layout.root) < 2) {
    return { layout, maximizedPaneId, dimInactiveSplits: null };
  }
  if (action === "spotlight" || action === "clear-spotlight") {
    return {
      layout:
        layout.focusedPaneId === pane.paneId
          ? layout
          : setFocus(layout, pane.paneId),
      maximizedPaneId,
      dimInactiveSplits: action === "spotlight",
    };
  }
  if (action === "restore") {
    return {
      layout,
      maximizedPaneId: maximizedPaneId === pane.paneId ? null : maximizedPaneId,
      dimInactiveSplits: null,
    };
  }
  if (action === "toggle" && maximizedPaneId === pane.paneId) {
    return { layout, maximizedPaneId: null, dimInactiveSplits: null };
  }
  return {
    layout:
      layout.focusedPaneId === pane.paneId
        ? layout
        : setFocus(layout, pane.paneId),
    maximizedPaneId: pane.paneId,
    dimInactiveSplits: null,
  };
}
