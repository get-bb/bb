import { activateNavigationDestination } from "./activateNavigationDestination";
import { usePaneContentSplitActions } from "./usePaneContentSplitDrag";
import type { ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import {
  type BuiltInSidebarNavEntry,
  ResourceNavSidebarItem,
  PluginNavSidebarItems,
  type SidebarNavActivationModifiers,
} from "@/components/plugin/PluginNavSidebarItems";
import { useAppCommandRunner } from "@/components/commands/AppCommandProvider";
import { Icon } from "@bb/shared-ui/icon";
import {
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./ProjectList";
import { DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER } from "@/components/plugin/pluginNavSidebarOrder";
import { getPluginsRoutePath, getSkillsRoutePath } from "@/lib/route-paths";

export type BuiltInSidebarNavigationProps = ComponentProps<
  typeof ProjectListNewThreadAction
> &
  ComponentProps<typeof ProjectListSearchThreadsAction> &
  Pick<
    ComponentProps<typeof PluginNavSidebarItems>,
    | "compactCustomizeMode"
    | "onCompactCustomizeModeChange"
    | "onNavigate"
    | "splitEnabled"
  >;

export function BuiltInSidebarNavigation({
  compactCustomizeMode,
  newThreadSplit,
  onCompactCustomizeModeChange,
  onNavigate,
  onNewChat,
  onSearchThreads,
  splitEnabled,
}: BuiltInSidebarNavigationProps) {
  const navigate = useNavigate();
  const commandRunner = useAppCommandRunner();
  const splitActions = usePaneContentSplitActions();
  const pluginsRoutePath = getPluginsRoutePath();
  const skillsRoutePath = getSkillsRoutePath();
  const builtInEntries: BuiltInSidebarNavEntry[] = [
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "new-thread",
      title: "New thread",
      icon: <Icon name="MessageSquarePlus" aria-hidden="true" />,
      content: (
        <ProjectListNewThreadAction
          splitEnabled={splitEnabled}
          newThreadSplit={newThreadSplit}
          onNewChat={onNewChat}
        />
      ),
      disabled: onNewChat === undefined,
      splitContent: { kind: "new-thread" },
      onActivate: (event: SidebarNavActivationModifiers) => {
        activateNavigationDestination({
          event,
          path: "/",
          navigate: () => onNewChat?.(),
          openInSplit: () => newThreadSplit?.openInSplit(),
        });
      },
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "search-threads",
      title: "Search threads",
      icon: <Icon name="Search" aria-hidden="true" />,
      content: (
        <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />
      ),
      disabled: !commandRunner.isCommandAvailable("thread.search", null),
      onActivate: () => {
        onSearchThreads?.();
        commandRunner.dispatch("thread.search", null);
      },
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "extensions",
      title: "Plugins",
      icon: <Icon name="Plug02" aria-hidden="true" />,
      content: (
        <ResourceNavSidebarItem
          icon="Plug02"
          title="Plugins"
          routePath={pluginsRoutePath}
          splitEnabled={splitEnabled}
          onNavigate={onNavigate}
        />
      ),
      splitContent: { kind: "resource", path: pluginsRoutePath },
      onActivate: (event) =>
        activateNavigationDestination({
          event,
          path: pluginsRoutePath,
          navigate: () => {
            onNavigate?.();
            void navigate(pluginsRoutePath);
          },
          openInSplit: () =>
            splitActions.openInSplit({
              content: { kind: "resource", path: pluginsRoutePath },
              enabled: splitEnabled ?? false,
              label: "Plugins",
              onNavigate,
            }),
        }),
    },
    {
      kind: "built-in",
      pluginId: "__bb__",
      id: "skills",
      title: "Skills",
      icon: <Icon name="Zap" aria-hidden="true" />,
      content: (
        <ResourceNavSidebarItem
          icon="Zap"
          title="Skills"
          routePath={skillsRoutePath}
          splitEnabled={splitEnabled}
          onNavigate={onNavigate}
        />
      ),
      splitContent: { kind: "resource", path: skillsRoutePath },
      onActivate: (event) =>
        activateNavigationDestination({
          event,
          path: skillsRoutePath,
          navigate: () => {
            onNavigate?.();
            void navigate(skillsRoutePath);
          },
          openInSplit: () =>
            splitActions.openInSplit({
              content: { kind: "resource", path: skillsRoutePath },
              enabled: splitEnabled ?? false,
              label: "Skills",
              onNavigate,
            }),
        }),
    },
  ];

  return (
    <div
      className="contents"
      data-testid="built-in-sidebar-navigation"
      data-sidebar-navigation-unified="true"
    >
      <div className="contents" data-testid="app-sidebar-primary-actions">
        <PluginNavSidebarItems
          builtInEntries={builtInEntries}
          compactCustomizeMode={compactCustomizeMode}
          leadingOrderKeys={DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER}
          onCompactCustomizeModeChange={onCompactCustomizeModeChange}
          onNavigate={onNavigate}
          splitEnabled={splitEnabled}
        />
      </div>
    </div>
  );
}
