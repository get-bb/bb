import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { WorkspaceExplorerPanel } from "./explorer-panel.js";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "workspace-explorer",
    title: "Explorer",
    icon: "FolderOpen",
    component: WorkspaceExplorerPanel,
    layout: "flush",
  });
});
