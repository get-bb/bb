import { useEffect } from "react";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import {
  ProjectListActionButtons,
  PROJECT_LIST_ACTION_BUTTON_CLASS,
} from "@/components/sidebar/ProjectList";
import { ToolsSidebar as ToolsSectionSidebar } from "@/components/tools/ToolsSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { Icon } from "@bb/shared-ui/icon";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  SCHEDULES_PLUGIN_PANEL_PATH,
} from "@/lib/route-paths";

export default {
  title: "Tools/Navigation",
};

const noop = () => {};

function StorySchedulesRegistration() {
  useEffect(() => {
    setPluginSlotRegistrations(AUTOMATIONS_PLUGIN_ID, {
      homepageSections: [],
      settingsSections: [],
      navPanels: [
        {
          id: SCHEDULES_PLUGIN_PANEL_PATH,
          title: "Schedules",
          icon: "TimeSchedule",
          path: SCHEDULES_PLUGIN_PANEL_PATH,
          component: () => null,
        },
      ],
      threadPanelActions: [],
      composerCustomizations: [],
      pendingInteractions: [],
      sidebarFooterActions: [],
      fileOpeners: [],
      messageDirectives: [],
    });
    return () => removePluginSlotRegistrations(AUTOMATIONS_PLUGIN_ID);
  }, []);
  return null;
}

export function AppSidebar() {
  return (
    <ProjectActionsProvider>
      <ThreadActionsProvider>
        <StorySchedulesRegistration />
        <main className="m-6 max-w-[320px]">
          <p className="mb-3 text-sm text-muted-foreground">
            Schedules is a top-level destination beside thread navigation.
            Plugins &amp; Skills opens the separate tools section.
          </p>
          <div className="overflow-hidden rounded-md border border-sidebar-border bg-sidebar py-2 text-sidebar-foreground shadow-sm">
            <div className="px-2">
              <ProjectListActionButtons
                onNewChat={noop}
                onOpenTools={noop}
              />
            </div>
            <PluginNavSidebarItems />
            <div className="border-t border-sidebar-border/70 px-2 pt-2">
              <div className={PROJECT_LIST_ACTION_BUTTON_CLASS}>
                <Icon name="MessageSquare" className="size-4" />
                <span>Threads continue here</span>
              </div>
            </div>
          </div>
        </main>
      </ThreadActionsProvider>
    </ProjectActionsProvider>
  );
}

export function PluginsAndSkillsSidebar() {
  return (
    <SidebarProvider>
      <main className="flex h-[420px] w-full bg-background">
        <ToolsSectionSidebar
          appRoutePath="/"
          isResizing={false}
          onResizeMouseDown={noop}
          showTopReserve={false}
        />
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Select Skills or Plugins. Schedules lives in the app sidebar instead.
        </div>
      </main>
    </SidebarProvider>
  );
}
