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
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
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

/**
 * What each section calls the collection the user already owns. Skills call it
 * the Library; plugins and automations call it Installed. Breadcrumbs and the
 * collection tab both read this, so renaming happens in one place.
 */
export const TOOLS_OWNED_COLLECTION_LABEL = {
  skills: "Library",
  plugins: "Installed",
  automations: "Installed",
} as const satisfies Record<ToolsSectionId, string>;

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

function collectionCrumb(
  id: ToolsSectionId,
  label: string = TOOLS_OWNED_COLLECTION_LABEL[id],
  to = TOOLS_SECTIONS[id].to,
): ToolsBreadcrumbSegment {
  return { label, to };
}

const DETAIL_ROUTES = [
  {
    pattern: TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
    section: "skills",
    collection: collectionCrumb(
      "skills",
      "Browse",
      getRegistrySkillsRoutePath(),
    ),
    param: "registrySkillId",
    fallback: "Skill",
  },
  {
    pattern: TOOLS_SKILL_DETAIL_ROUTE_PATH,
    section: "skills",
    collection: collectionCrumb("skills"),
    param: "skillId",
    fallback: "Skill",
  },
  {
    // The pre-Library route still resolves so a deep link keeps its header and
    // document title for the redirect window instead of flashing an empty one.
    pattern: LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
    section: "skills",
    collection: collectionCrumb("skills"),
    param: "skillId",
    fallback: "Skill",
  },
  {
    pattern: TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
    section: "plugins",
    collection: collectionCrumb("plugins"),
    param: "pluginId",
    fallback: "Plugin",
  },
  {
    pattern: TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
    section: "automations",
    collection: collectionCrumb("automations"),
    param: "automationId",
    fallback: "Automation",
  },
] as const;

const BROWSE_ROUTES = [
  ["skills", TOOLS_REGISTRY_SKILLS_ROUTE_PATH],
  ["plugins", TOOLS_PLUGIN_BROWSE_ROUTE_PATH],
  ["automations", TOOLS_AUTOMATION_BROWSE_ROUTE_PATH],
] as const;

const ROOT_ROUTE_ALIASES: Record<ToolsSectionId, readonly string[]> = {
  skills: ["/tools", "/skills"],
  plugins: [],
  automations: ["/automations"],
};

export function resolveToolsBreadcrumbs(
  pathname: string,
  search = "",
  resourceLabel?: string | null,
): ToolsBreadcrumbSegment[] | null {
  const view = new URLSearchParams(search).get("view");
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
      sectionCrumb("automations"),
      collectionCrumb("automations"),
      { label: automationLabel, to: automationDetailPath },
      { label: "Edit" },
    ];
  }

  // Browse is matched before detail on purpose. A single-param detail pattern
  // such as /tools/plugins/:pluginId also matches /tools/plugins/browse, so
  // testing detail first resolves the reserved "browse" segment as a resource
  // id and yields "Plugins / Installed / browse".
  for (const [section, browseRoute] of BROWSE_ROUTES) {
    if (
      pathname === browseRoute ||
      (pathname === TOOLS_SECTIONS[section].to && view === "browse")
    ) {
      return [sectionCrumb(section), { label: "Browse" }];
    }
  }

  for (const detail of DETAIL_ROUTES) {
    const match = matchPath(detail.pattern, pathname);
    if (!match) continue;
    return [
      sectionCrumb(detail.section),
      detail.collection,
      {
        label:
          resourceLabel ??
          routeResourceLabel(match.params[detail.param], detail.fallback),
      },
    ];
  }

  for (const section of TOOLS_NAV_ITEMS) {
    if (
      pathname === section.to ||
      ROOT_ROUTE_ALIASES[section.id].includes(pathname)
    ) {
      return [
        sectionCrumb(section.id),
        { label: TOOLS_OWNED_COLLECTION_LABEL[section.id] },
      ];
    }
  }
  return null;
}
