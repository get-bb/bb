import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { matchPath } from "react-router-dom";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { LazySettingsSidebar } from "@/components/settings/LazySettingsSidebar";
import { SectionSidebar } from "@/components/sidebar/SectionSidebar";
import { ResourceSidebar } from "@/components/tools/ResourceSidebar";
import type { PluginNavPanelSlot } from "@/lib/plugin-slots";
import {
  isPluginsRoutePath,
  isSkillsRoutePath,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";

export interface RouteSidebarProps {
  backTo: string | null;
  isResizing: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export interface RouteSidebar {
  id: string;
  render: (props: RouteSidebarProps) => ReactNode;
}

export interface RouteSidebarPluginPanel {
  panel: PluginNavPanelSlot;
  subPath: string;
}

const SETTINGS_ROUTE_SIDEBAR: RouteSidebar = {
  id: "settings",
  render: (props) => <LazySettingsSidebar {...props} />,
};

const PLUGINS_ROUTE_SIDEBAR: RouteSidebar = {
  id: "plugins",
  render: (props) => (
    <ResourceSidebar key="plugins" workspace="plugins" {...props} />
  ),
};

const SKILLS_ROUTE_SIDEBAR: RouteSidebar = {
  id: "skills",
  render: (props) => (
    <ResourceSidebar key="skills" workspace="skills" {...props} />
  ),
};

function pluginPanelRouteSidebar({
  panel,
  subPath,
}: RouteSidebarPluginPanel): RouteSidebar | null {
  const PanelSidebar = panel.experimental_sidebar;
  if (PanelSidebar === undefined) return null;
  return {
    id: `plugin/${panel.pluginId}/${panel.id}/${panel.generation}/${subPath}`,
    render: (props) => (
      <SectionSidebar title={panel.title} testIdPrefix="plugin" {...props}>
        <PluginSlotMount
          key={`${panel.pluginId}/${panel.id}/${panel.generation}`}
          pluginId={panel.pluginId}
          slotKind="navPanelSidebar"
          slotId={panel.id}
          crashResetKey={`${panel.generation}/${subPath}`}
        >
          <PanelSidebar subPath={subPath} />
        </PluginSlotMount>
      </SectionSidebar>
    ),
  };
}

export function resolveRouteSidebar(
  pathname: string,
  pluginPanel: RouteSidebarPluginPanel | null,
): RouteSidebar | null {
  if (matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname) !== null) {
    return SETTINGS_ROUTE_SIDEBAR;
  }
  if (isPluginsRoutePath(pathname)) return PLUGINS_ROUTE_SIDEBAR;
  if (isSkillsRoutePath(pathname)) return SKILLS_ROUTE_SIDEBAR;
  return pluginPanel === null ? null : pluginPanelRouteSidebar(pluginPanel);
}
