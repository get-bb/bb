import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { useTasksBadge } from "./shell/badge.js";
import { TasksNavigationPanel } from "./shell/navigation-panel.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
    experimental_useBadge: useTasksBadge,
  });
  app.slots.experimental_tab({
    context: { kind: "nav-panel", panelId: "tasks" },
    availability: "fixed",
    id: "navigation",
    title: "Navigation",
    icon: "ListTodo",
    component: TasksNavigationPanel,
    layout: "flush",
  });
  app.slots.experimental_tab({
    context: { kind: "thread" },
    availability: "action",
    id: "task",
    title: "Task",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.messageDirective({ id: "task", component: TaskDirectiveCard });
});
