import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import {
  findPane,
  findPaneByThread,
  replacePaneContent,
  setFocus,
} from "@/lib/split-layout";
import type { PaneContent, SplitLayout } from "@/lib/split-layout";

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
