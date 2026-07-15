import { definePluginApp } from "@bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
  });
});
