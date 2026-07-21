import type { IconName } from "@bb/shared-ui/icon";
import {
  getAutomationsRoutePath,
  getPluginsRoutePath,
  getSkillsRoutePath,
} from "@/lib/route-paths";

export type ToolsSectionId = "skills" | "plugins" | "automations";

export const TOOLS_NAV_ITEMS = [
  {
    id: "skills",
    label: "Skills",
    icon: "Zap",
    to: getSkillsRoutePath(),
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: "ElectricPlugs",
    to: getPluginsRoutePath(),
  },
  {
    id: "automations",
    label: "Automations",
    icon: "TimeSchedule",
    to: getAutomationsRoutePath(),
  },
] satisfies readonly {
  id: ToolsSectionId;
  label: string;
  icon: IconName;
  to: string;
}[];

function belongsToRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function resolveToolsSection(pathname: string): ToolsSectionId {
  if (belongsToRoute(pathname, getPluginsRoutePath())) return "plugins";
  if (belongsToRoute(pathname, getAutomationsRoutePath())) return "automations";
  return "skills";
}
