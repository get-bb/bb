import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import type { ThreadOpenSplit } from "@bb/server-contract";
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

export function createSinglePaneContentLayout(
  content: PaneContent,
): SplitLayout {
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

/**
 * Folds an external route (initial load, sidebar click, deep link) into the
 * layout, per the binding navigation policy:
 *  - no layout yet => a single pane from the route;
 *  - the route thread is already open in a pane => focus that pane, never
 *    duplicate it;
 *  - otherwise => replace the focused pane's content, never dismantling the
 *    rest of the layout.
 * Returns the same reference when nothing changes so the driving effect stays
 * idempotent (no history spam, no render loop).
 */
export function reconcileLayoutForRoute(
  layout: SplitLayout | null,
  thread: ThreadRoutePathArgs,
): SplitLayout {
  if (layout === null) {
    return createSinglePaneLayout(thread);
  }
  const existing = findPaneByThread(
    layout.root,
    thread.projectId,
    thread.threadId,
  );
  if (existing !== null) {
    return layout.focusedPaneId === existing.paneId
      ? layout
      : setFocus(layout, existing.paneId);
  }
  const focused = findPane(layout.root, layout.focusedPaneId);
  if (
    focused !== null &&
    focused.content.kind === "thread" &&
    focused.content.projectId === thread.projectId &&
    focused.content.threadId === thread.threadId
  ) {
    return layout;
  }
  return replacePaneContent(
    layout,
    layout.focusedPaneId,
    threadPaneContent(thread),
  );
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

/**
 * The focused pane's thread as route args, or null when it isn't a thread pane.
 * Drives URL sync: the focused pane owns the address bar.
 */
export function focusedThreadRoute(
  layout: SplitLayout,
): ThreadRoutePathArgs | null {
  const focused = findPane(layout.root, layout.focusedPaneId);
  if (focused === null || focused.content.kind !== "thread") {
    return null;
  }
  return {
    projectId: focused.content.projectId,
    threadId: focused.content.threadId,
  };
}
