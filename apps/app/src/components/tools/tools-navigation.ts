import type { IconName } from "@bb/shared-ui/icon";
import { matchPath } from "react-router-dom";
import {
  getAutomationsRoutePath,
  getAutomationDetailRoutePath,
  getPluginsRoutePath,
  getRegistrySkillsRoutePath,
  getSkillsRoutePath,
  TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";

export type ToolsSectionId = "skills" | "plugins" | "automations";

export interface ToolsSectionDefinition {
  id: ToolsSectionId;
  label: string;
  icon: IconName;
  to: string;
}

export const TOOLS_SECTIONS = {
  skills: {
    id: "skills",
    label: "Skills",
    icon: "Zap",
    to: getSkillsRoutePath(),
  },
  plugins: {
    id: "plugins",
    label: "Plugins",
    icon: "ElectricPlugs",
    to: getPluginsRoutePath(),
  },
  automations: {
    id: "automations",
    label: "Automations",
    icon: "TimeSchedule",
    to: getAutomationsRoutePath(),
  },
} satisfies Record<ToolsSectionId, ToolsSectionDefinition>;

export const TOOLS_NAV_ITEMS = [
  TOOLS_SECTIONS.skills,
  TOOLS_SECTIONS.plugins,
  TOOLS_SECTIONS.automations,
] as const;

export interface ToolsBreadcrumbSegment {
  label: string;
  to?: string;
}

function belongsToRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function resolveToolsSection(pathname: string): ToolsSectionId {
  if (belongsToRoute(pathname, TOOLS_SECTIONS.plugins.to)) return "plugins";
  if (belongsToRoute(pathname, TOOLS_SECTIONS.automations.to)) {
    return "automations";
  }
  return "skills";
}

function routeResourceLabel(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // React Router may already have decoded the segment; use it as-is.
  }
  const segments = decoded.split("/").filter(Boolean);
  return segments.at(-1) ?? fallback;
}

function sectionCrumb(id: ToolsSectionId): ToolsBreadcrumbSegment {
  const section = TOOLS_SECTIONS[id];
  return { label: section.label, to: section.to };
}

export function resolveToolsBreadcrumbs(
  pathname: string,
  search = "",
  resourceLabel?: string | null,
): ToolsBreadcrumbSegment[] | null {
  const view = new URLSearchParams(search).get("view");
  const skillsCrumb = sectionCrumb("skills");
  const pluginsCrumb = sectionCrumb("plugins");
  const automationsCrumb = sectionCrumb("automations");
  const installedSkillsCrumb = {
    label: "Installed",
    to: TOOLS_SECTIONS.skills.to,
  };
  const browseSkillsCrumb = {
    label: "Browse",
    to: getRegistrySkillsRoutePath(),
  };
  const installedPluginsCrumb = {
    label: "Installed",
    to: TOOLS_SECTIONS.plugins.to,
  };
  const installedAutomationsCrumb = {
    label: "Installed",
    to: TOOLS_SECTIONS.automations.to,
  };
  const registrySkillDetail = matchPath(
    TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
    pathname,
  );
  if (registrySkillDetail) {
    return [
      skillsCrumb,
      browseSkillsCrumb,
      {
        label:
          resourceLabel ??
          routeResourceLabel(
            registrySkillDetail.params.registrySkillId,
            "Skill",
          ),
      },
    ];
  }
  const installedSkillDetail = matchPath(
    TOOLS_SKILL_DETAIL_ROUTE_PATH,
    pathname,
  );
  if (installedSkillDetail) {
    return [
      skillsCrumb,
      installedSkillsCrumb,
      {
        label:
          resourceLabel ??
          routeResourceLabel(installedSkillDetail.params.skillId, "Skill"),
      },
    ];
  }
  const isPluginBrowse =
    pathname === TOOLS_PLUGIN_BROWSE_ROUTE_PATH ||
    (pathname === TOOLS_SECTIONS.plugins.to && view === "browse");
  if (isPluginBrowse) return [pluginsCrumb, { label: "Browse" }];
  const pluginDetail = matchPath(TOOLS_PLUGIN_DETAIL_ROUTE_PATH, pathname);
  if (pluginDetail) {
    return [
      pluginsCrumb,
      installedPluginsCrumb,
      {
        label:
          resourceLabel ??
          routeResourceLabel(pluginDetail.params.pluginId, "Plugin"),
      },
    ];
  }
  const automationEdit = matchPath(TOOLS_AUTOMATION_EDIT_ROUTE_PATH, pathname);
  if (automationEdit) {
    const automationLabel = routeResourceLabel(
      automationEdit.params.automationId,
      "Automation",
    );
    const automationDetailPath =
      automationEdit.params.projectId && automationEdit.params.automationId
        ? getAutomationDetailRoutePath({
            projectId: automationEdit.params.projectId,
            automationId: automationEdit.params.automationId,
          })
        : TOOLS_SECTIONS.automations.to;
    return [
      automationsCrumb,
      installedAutomationsCrumb,
      { label: automationLabel, to: automationDetailPath },
      { label: "Edit" },
    ];
  }
  const automationDetail = matchPath(
    TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
    pathname,
  );
  if (automationDetail) {
    return [
      automationsCrumb,
      installedAutomationsCrumb,
      {
        label:
          resourceLabel ??
          routeResourceLabel(
            automationDetail.params.automationId,
            "Automation",
          ),
      },
    ];
  }
  const isAutomationBrowse =
    pathname === TOOLS_AUTOMATION_BROWSE_ROUTE_PATH ||
    (pathname === TOOLS_SECTIONS.automations.to && view === "browse");
  if (isAutomationBrowse) return [automationsCrumb, { label: "Browse" }];
  const isSkillsBrowse =
    pathname === TOOLS_REGISTRY_SKILLS_ROUTE_PATH ||
    (pathname === TOOLS_SECTIONS.skills.to && view === "browse");
  if (isSkillsBrowse) return [skillsCrumb, { label: "Browse" }];
  if (
    pathname === "/tools" ||
    pathname === TOOLS_SECTIONS.skills.to ||
    pathname === "/skills"
  ) {
    return [skillsCrumb, { label: "Installed" }];
  }
  if (pathname === TOOLS_SECTIONS.plugins.to) {
    return [pluginsCrumb, { label: "Installed" }];
  }
  if (
    pathname === TOOLS_SECTIONS.automations.to ||
    pathname === "/automations"
  ) {
    return [automationsCrumb, { label: "Installed" }];
  }
  return null;
}
