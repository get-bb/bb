import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { WorkspaceSidebar } from "./app/sidebar/WorkspaceSidebar.js";

function ConductorThreadList(props: PluginThreadListProps) {
  return (
    <TooltipProvider>
      <WorkspaceSidebar {...props} />
    </TooltipProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "workspaces",
    title: "Conductor workspaces",
    description:
      "Projects with one row per workspace: the threads that share an environment, with branch, pull request, and line changes.",
    component: ConductorThreadList,
  });
});
