import {
  definePluginApp,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PreferencesSync } from "./app/preferences/PreferencesSync.js";
import { ProjectList } from "./app/list/ProjectList.js";
import { useSidebarThreadReveal } from "./app/list/useSidebarThreadReveal.js";
import { moveThreadAction } from "./app/rows/moveThreadAction.js";
import { ThreadSelectionProvider } from "./app/selection/threadSelection.js";
import { SidebarScrollAreaProvider } from "./app/ui/sidebar.js";

function ThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
  experimental_scrollElement,
}: PluginThreadListProps) {
  useSidebarThreadReveal();
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <SidebarScrollAreaProvider scrollElement={experimental_scrollElement}>
        <TooltipProvider>
          <PreferencesSync />
          <ThreadSelectionProvider activeThreadId={activeThreadId}>
            <ProjectList
              activeThreadId={activeThreadId}
              onProjectSelect={onNavigate}
            />
          </ThreadSelectionProvider>
        </TooltipProvider>
      </SidebarScrollAreaProvider>
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
  app.slots.experimental_threadAction(moveThreadAction);
});
