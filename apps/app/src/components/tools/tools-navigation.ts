import type { IconName } from "@bb/shared-ui/icon";
import { matchPath } from "react-router-dom";
import {
  getPluginsRoutePath,
  getRegistrySkillsRoutePath,
  getSkillsRoutePath,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  AUTOMATIONS_BROWSE_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTOMATION_DETAIL_ROUTE_PATH,
  AUTOMATION_EDIT_ROUTE_PATH,
} from "@/lib/route-paths";

export type ToolsSectionId = "skills" | "plugins";

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
} satisfies Record<ToolsSectionId, ToolsSectionDefinition>;

/**
 * What each section calls the collection the user already owns. Skills call it
 * the Library; plugins call it Installed. Breadcrumbs and the collection tab
 * both read this, so renaming happens in one place.
 */
export const TOOLS_OWNED_COLLECTION_LABEL = {
  skills: "Library",
  plugins: "Installed",
} as const satisfies Record<ToolsSectionId, string>;

export const TOOLS_OWNED_COLLECTION_VIEW = {
  skills: "library",
  plugins: "installed",
} as const satisfies Record<ToolsSectionId, string>;

export function getToolsOwnedCollectionRoutePath(id: ToolsSectionId): string {
  return `${TOOLS_SECTIONS[id].to}?view=${TOOLS_OWNED_COLLECTION_VIEW[id]}`;
}

export const TOOLS_NAV_ITEMS = [TOOLS_SECTIONS.plugins, TOOLS_SECTIONS.skills];

export interface ToolsBreadcrumbSegment {
  label: string;
  to?: string;
}

export function resolveAutomationBreadcrumbs(
  pathname: string,
  resourceLabel?: string | null,
): ToolsBreadcrumbSegment[] | null {
  const root = { label: "Automations", to: AUTOMATIONS_ROUTE_PATH };
  if (pathname === AUTOMATIONS_BROWSE_ROUTE_PATH) {
    return [root, { label: "Browse" }];
  }
  for (const pattern of [
    AUTOMATION_DETAIL_ROUTE_PATH,
    AUTOMATION_EDIT_ROUTE_PATH,
  ]) {
    const match = matchPath(pattern, pathname);
    if (!match) continue;
    return [
      root,
      { label: "Installed", to: AUTOMATIONS_ROUTE_PATH },
      {
        label:
          resourceLabel ??
          routeResourceLabel(match.params.automationId, "Automation"),
      },
    ];
  }
  if (pathname === AUTOMATIONS_ROUTE_PATH) {
    return [root, { label: "Installed" }];
  }
  return null;
}

function belongsToRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function resolveToolsSection(pathname: string): ToolsSectionId {
  if (belongsToRoute(pathname, TOOLS_SECTIONS.plugins.to)) return "plugins";
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
  to = getToolsOwnedCollectionRoutePath(id),
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
] as const;

const BROWSE_ROUTES = [
  ["skills", TOOLS_REGISTRY_SKILLS_ROUTE_PATH],
  ["plugins", TOOLS_PLUGIN_BROWSE_ROUTE_PATH],
] as const;

const ROOT_ROUTE_ALIASES: Record<ToolsSectionId, readonly string[]> = {
  skills: ["/tools", "/skills"],
  plugins: [],
};

export function resolveToolsBreadcrumbs(
  pathname: string,
  search = "",
  resourceLabel?: string | null,
): ToolsBreadcrumbSegment[] | null {
  const view = new URLSearchParams(search).get("view");
  // Browse is matched before detail on purpose. A single-param detail pattern
  // such as /tools/plugins/:pluginId also matches /tools/plugins/browse, so
  // testing detail first resolves the reserved "browse" segment as a resource
  // id and yields "Plugins / Installed / browse".
  for (const [section, browseRoute] of BROWSE_ROUTES) {
    if (
      pathname === browseRoute ||
      (pathname === TOOLS_SECTIONS[section].to &&
        view !== TOOLS_OWNED_COLLECTION_VIEW[section])
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
      if (
        pathname === section.to &&
        view !== TOOLS_OWNED_COLLECTION_VIEW[section.id]
      ) {
        continue;
      }
      return [
        sectionCrumb(section.id),
        { label: TOOLS_OWNED_COLLECTION_LABEL[section.id] },
      ];
    }
  }
  return null;
}
