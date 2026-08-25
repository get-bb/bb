import type { ComponentProps } from "react";
import { PluginNavSidebarItems } from "@/components/plugin/PluginNavSidebarItems";
import { ProjectListActionButtons } from "./ProjectList";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListActionButtons
> &
  ComponentProps<typeof PluginNavSidebarItems>;

/** BB's complete native renderer for the replaceable navigation controls. */
export function BuiltInSidebarNavigation({
  newThreadSplit,
  onNavigate,
  onNewChat,
  splitEnabled,
  threadSearch,
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
          threadSearch={threadSearch}
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
