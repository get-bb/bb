import { getThreadRoutePath } from "@/lib/route-paths";
import { decideThreadDrop } from "@/lib/split-drag";
import { splitLayoutAtom } from "./atoms";
import {
  countPanes,
  findPaneByThread,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "./index";

interface SplitLayoutStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

export interface OpenThreadInSplitArgs {
  store: SplitLayoutStore;
  navigate: (route: string, options?: { replace?: boolean }) => void;
  projectId: string;
  threadId: string;
  /** Splits are off on compact viewports. */
  isCompact: boolean;
  threadSplitsEnabled: boolean;
}

/**
 * Open a thread in the split area with the same placement rules a drag uses:
 * a right split by default, focus the pane when the thread is already open,
 * and coerce to a replace at the pane cap. Falls back to plain navigation
 * where there is no split to grow.
 *
 * Shared by the sidebar row's cmd-click/menu entry point and by the plugin
 * `open(id, { split: true })` action, so the two can never diverge.
 */
export function openThreadInSplit({
  store,
  navigate,
  projectId,
  threadId,
  isCompact,
  threadSplitsEnabled,
}: OpenThreadInSplitArgs): void {
  const route = getThreadRoutePath({ projectId, threadId });
  const layout = store.get(splitLayoutAtom);
  // No split to grow (compact viewport, or a non-thread route with no layout):
  // behave like an ordinary open.
  if (!threadSplitsEnabled || isCompact || layout === null) {
    navigate(route);
    return;
  }
  const existing = findPaneByThread(layout.root, projectId, threadId);
  if (existing !== null) {
    const next = setFocus(layout, existing.paneId);
    if (next !== layout) {
      store.set(splitLayoutAtom, next);
    }
    navigate(route, { replace: true });
    return;
  }
  // Same decision as a drag with a default right-edge target.
  const decision = decideThreadDrop({
    zone: "right",
    threadAlreadyOpen: false,
    atMaxPanes: countPanes(layout.root) >= MAX_PANES,
  });
  const content: PaneContent = { kind: "thread", projectId, threadId };
  const next =
    decision.zone === "center"
      ? replacePaneContent(layout, layout.focusedPaneId, content)
      : splitPane(layout, layout.focusedPaneId, "right", content);
  if (next !== layout) {
    store.set(splitLayoutAtom, next);
  }
  navigate(route);
}
