import type { ComponentProps } from "react";
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import { ProjectListActionButtons } from "./ProjectList";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListActionButtons
> &
  ComponentProps<typeof PluginNavSidebarItems>;

export function BuiltInSidebarNavigation({
  newThreadSplit,
  onNavigate,
  onNewChat,
  onSearchThreads,
  splitEnabled,
  toolsRoutePath,
}: BuiltInSidebarNavigationProps) {
  return (
    <div className="contents" data-testid="built-in-sidebar-navigation">
      <div
        data-testid="app-sidebar-primary-actions"
        className="shrink-0 px-2 py-2 group-data-[collapsible=icon]:hidden"
      >
        <ProjectListActionButtons
          splitEnabled={splitEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={onNewChat}
          onSearchThreads={onSearchThreads}
        />
      </div>
      <PluginNavSidebarItems
        onNavigate={onNavigate}
        splitEnabled={splitEnabled}
        toolsRoutePath={toolsRoutePath}
      />
    </div>
  );
}
