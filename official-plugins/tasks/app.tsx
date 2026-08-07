import { definePluginApp } from "@bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";
import { TasksHomePanel } from "./views/home/index.js";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
  });
  app.slots.navPanel({
    id: "home",
    title: "Home",
    icon: "Home",
    path: "home",
    sidebarPlacement: "top",
    component: TasksHomePanel,
  });
  app.slots.threadPanelAction({
    id: "task",
    title: "Task",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.messageDirective({ id: "task", component: TaskDirectiveCard });
});
