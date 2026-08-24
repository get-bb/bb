import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";

/**
 * True when the split workspace renders pane chrome — panes, pane headers, and
 * the split tree. Compact viewports render the route as a single page surface
 * instead (see SplitThreadArea), so the shared AppLayout header owns the chrome
 * there.
 *
 * Both sides of that handoff read this one predicate. Duplicating the policy is
 * what produced #1042: AppLayout suppressed its header for plugin panel routes
 * whenever splits were enabled, while SplitThreadArea had already dropped its
 * pane header for the compact viewport, so mobile plugin panels got no header
 * at all.
 */
export function useSplitWorkspaceActive(): boolean {
  const isCompactViewport = useIsCompactViewport();
  return !isCompactViewport;
}
