import { definePluginApp, type PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";
import { useSidebarThreadReveal } from "./app/list/useSidebarThreadReveal.js";

function ThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  useSidebarThreadReveal();
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <TooltipProvider>
        <PreferencesSync />
        <ProjectList
          activeThreadId={activeThreadId}
          onProjectSelect={onNavigate}
        />
      </TooltipProvider>
    </CompactViewportOverrideProvider>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "thread-list",
    title: "Thread list",
    description:
      "Pinned threads, custom sections, projects, machines, and nested threads.",
    component: ThreadList,
  });
});
