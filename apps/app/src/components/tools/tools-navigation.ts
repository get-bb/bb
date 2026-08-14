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
  isToolsRoutePath,
} from "@/lib/route-paths";

export type ToolsSectionId = "skills" | "plugins";

/**
 * Centers one band of a full-bleed Extensions page onto the shared content
 * column. Collection pages let their scroller span the whole pane (so the
 * wheel works from the gutters) and re-center every band with this class.
 */
export const TOOLS_PAGE_BAND_CLASSES = "mx-auto w-full max-w-5xl px-4 md:px-5";

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
  skills: "My skills",
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

function resolvePluginCreateBreadcrumbs(
  pathname: string,
  search: string,
): ToolsBreadcrumbSegment[] | null {
  if (
    pathname !== TOOLS_SECTIONS.plugins.to ||
    new URLSearchParams(search).get("view") !== "create"
  ) {
    return null;
  }
  return [
    { label: "Extensions", to: getPluginsRoutePath() },
    { label: "Create a plugin" },
  ];
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

// Legacy roots that resolve to a section for the redirect frame. "/tools"
// itself is absent on purpose: it forwards to the plugins Browse landing,
// which the alias table's owned-collection labels would misname.
const ROOT_ROUTE_ALIASES: Record<ToolsSectionId, readonly string[]> = {
  skills: ["/skills"],
  plugins: [],
};

export function resolveToolsBreadcrumbs(
  pathname: string,
  search = "",
  resourceLabel?: string | null,
): ToolsBreadcrumbSegment[] | null {
  const view = new URLSearchParams(search).get("view");
  const pluginCreateBreadcrumbs = resolvePluginCreateBreadcrumbs(
    pathname,
    search,
  );
  if (pluginCreateBreadcrumbs !== null) {
    return pluginCreateBreadcrumbs;
  }
  // Browse is matched before detail on purpose. A single-param detail pattern
  // such as /extensions/plugins/:pluginId also matches /extensions/plugins/browse, so
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
    const collection =
      detail.section === "plugins" &&
      view !== TOOLS_OWNED_COLLECTION_VIEW.plugins
        ? collectionCrumb("plugins", "Browse", getPluginsRoutePath())
        : detail.collection;
    return [
      sectionCrumb(detail.section),
      collection,
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

/** One Extensions page the sidebar lists: identity, label, icon, route. */
export interface ToolsPageDefinition {
  id:
    | "plugins-browse"
    | "plugins-installed"
    | "skills-browse"
    | "skills-library";
  section: ToolsSectionId;
  label: string;
  icon: IconName;
  to: string;
}

/**
 * Every Extensions page, in sidebar order. Labels compose from the canonical
 * section and collection names so a rename still happens in one place.
 */
export const TOOLS_PAGES: readonly ToolsPageDefinition[] = [
  {
    id: "plugins-browse",
    section: "plugins",
    label: `Browse ${TOOLS_SECTIONS.plugins.label.toLowerCase()}`,
    icon: TOOLS_SECTIONS.plugins.icon,
    to: TOOLS_SECTIONS.plugins.to,
  },
  {
    id: "plugins-installed",
    section: "plugins",
    label: `${TOOLS_OWNED_COLLECTION_LABEL.plugins} ${TOOLS_SECTIONS.plugins.label.toLowerCase()}`,
    icon: "PackageReceive",
    to: getToolsOwnedCollectionRoutePath("plugins"),
  },
  {
    id: "skills-browse",
    section: "skills",
    label: `Browse ${TOOLS_SECTIONS.skills.label.toLowerCase()}`,
    icon: TOOLS_SECTIONS.skills.icon,
    to: TOOLS_SECTIONS.skills.to,
  },
  {
    id: "skills-library",
    section: "skills",
    label: TOOLS_OWNED_COLLECTION_LABEL.skills,
    icon: "FolderOpen",
    to: getToolsOwnedCollectionRoutePath("skills"),
  },
];

/**
 * Which Extensions page owns the current location — the same ownership the
 * breadcrumb resolver's DETAIL_ROUTES table encodes, so the sidebar highlight
 * and document title agree. Plugin details preserve their originating
 * collection in `view`: catalog details default to Browse, while installed
 * rows carry `view=installed`. The legacy installed-skill path belongs to the
 * library.
 */
export function resolveToolsActivePage(
  pathname: string,
  search = "",
): ToolsPageDefinition["id"] {
  const view = new URLSearchParams(search).get("view");
  for (const detail of DETAIL_ROUTES) {
    if (matchPath(detail.pattern, pathname) === null) continue;
    if (detail.section === "plugins") {
      return view === TOOLS_OWNED_COLLECTION_VIEW.plugins
        ? "plugins-installed"
        : "plugins-browse";
    }
    return detail.collection.label === TOOLS_OWNED_COLLECTION_LABEL.skills
      ? "skills-library"
      : "skills-browse";
  }
  const section = resolveToolsSection(pathname);
  if (section === "plugins") {
    return view === TOOLS_OWNED_COLLECTION_VIEW.plugins
      ? "plugins-installed"
      : "plugins-browse";
  }
  return view === TOOLS_OWNED_COLLECTION_VIEW.skills
    ? "skills-library"
    : "skills-browse";
}

/**
 * What the app header shows for a route in the Tools/Automations chrome area:
 * Extensions collection pages get the static area title (their sidebar names
 * every page, so a crumb trail would repeat the active row), plugin creation
 * gets the same ancestor/current breadcrumb treatment as other app depth,
 * automation routes keep their breadcrumb trail, and anything else is not
 * this resolver's business.
 *
 * Pure on purpose: the precedence used to live in AppLayout's meta ternary
 * with no coverage; here the three cases are testable directly.
 */
export function resolveToolsAreaHeaderMeta(
  pathname: string,
  toolsHubEnabled: boolean,
  resourceLabel?: string | null,
  search = "",
):
  | { kind: "extensions-title"; title: string }
  | { kind: "breadcrumbs"; breadcrumbs: ToolsBreadcrumbSegment[] }
  | null {
  if (toolsHubEnabled && isToolsRoutePath(pathname)) {
    const pluginCreateBreadcrumbs = resolvePluginCreateBreadcrumbs(
      pathname,
      search,
    );
    if (pluginCreateBreadcrumbs !== null) {
      return { kind: "breadcrumbs", breadcrumbs: pluginCreateBreadcrumbs };
    }
    return { kind: "extensions-title", title: "Extensions" };
  }
  const automationBreadcrumbs = resolveAutomationBreadcrumbs(
    pathname,
    resourceLabel,
  );
  if (automationBreadcrumbs !== null) {
    return { kind: "breadcrumbs", breadcrumbs: automationBreadcrumbs };
  }
  return null;
}
