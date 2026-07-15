// TaskActivity is the activity feed + comment composer the detail view
// mounts under a task. ActivityView (the "Active" sidebar route: tasks with
// agents working now) is still a placeholder pending its own task; the shell
// only depends on the exported name.

export { TaskActivity, type TaskActivityProps } from "./task-activity.js";
export { default } from "./task-activity.js";

export function ActivityView() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      Active view coming soon
    </div>
  );
}
