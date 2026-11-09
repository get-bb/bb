import type { SidebarThread } from "../model/sidebar-thread.js";

const RUNNING_RUNTIME_STATUSES: Record<
  SidebarThread["runtimeStatus"],
  boolean
> = {
  active: true,
  provisioning: true,
  starting: true,
  stopping: true,
  error: false,
  idle: false,
  pending: false,
  "waiting-for-host": false,
};

export function isWorkingThread(thread: SidebarThread): boolean {
  return (
    RUNNING_RUNTIME_STATUSES[thread.runtimeStatus] ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0
  );
}

export function countWorkingDescendants(
  descendants: readonly SidebarThread[],
): number {
  let count = 0;
  for (const descendant of descendants) {
    if (isWorkingThread(descendant)) count += 1;
  }
  return count;
}
