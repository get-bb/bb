import { definePluginApp } from "@bb/plugin-sdk/app";
import { TasksAppShell } from "./shell/app-shell.js";
import { TasksSidebarAccessory } from "./shell/sidebar-accessory.js";
import { TaskDirectiveCard, TaskEmbedPanel } from "./views/embed/index.js";

export default definePluginApp((app) => {
  app.slots.experimental_primaryTab({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    order: 20,
    defaultStartup: false,
    routePersistence: "fixed",
    target: {
      kind: "plugin-panel",
      path: "tasks",
      query: { view: "board" },
    },
  });
  app.slots.navPanel({
    id: "tasks",
    title: "Tasks",
    icon: "ListTodo",
    path: "tasks",
    component: TasksAppShell,
    experimental_sidebarAccessory: TasksSidebarAccessory,
  });
  app.slots.threadPanelAction({
    id: "task",
    title: "Task",
    icon: "ListTodo",
    component: TaskEmbedPanel,
  });
  app.slots.messageDirective({ id: "task", component: TaskDirectiveCard });
});
