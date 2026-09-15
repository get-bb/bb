import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChangeLogPanel } from "./components/change-log-panel.js";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "change-log",
    title: "Changes",
    icon: "Clock",
    component: ChangeLogPanel,
    layout: "flush",
  });
});
