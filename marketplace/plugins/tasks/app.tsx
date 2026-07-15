import { definePluginApp } from "@bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";

function TasksPanel() {
  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-auto bg-background p-6 text-foreground">
      <section className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <p className="text-sm font-medium">Tasks plugin scaffold</p>
          <p className="text-sm text-muted-foreground">
            Linear-style task tracking for bb is coming next.
          </p>
        </div>
        <Button type="button">Tasks is ready</Button>
      </section>
    </main>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksPanel,
  });
});
