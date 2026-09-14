import { matchPath } from "react-router-dom";
import {
  getPluginsRoutePath,
  getRegistrySkillsRoutePath,
  getSkillsRoutePath,
  PLUGIN_DETAIL_ROUTE_PATH,
  REGISTRY_SKILLS_ROUTE_PATH,
  REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  SKILL_DETAIL_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  AUTOMATIONS_BROWSE_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTOMATION_DETAIL_ROUTE_PATH,
  AUTOMATION_EDIT_ROUTE_PATH,
  isPluginsRoutePath,
  isSkillsRoutePath,
} from "@/lib/route-paths";

export type ToolsSectionId = "skills" | "plugins";

export const TOOLS_PAGE_BAND_CLASSES = "mx-auto w-full max-w-5xl px-4 md:px-5";

interface ToolsSectionDefinition {
  id: ToolsSectionId;
  label: string;
  to: string;
}

const TOOLS_SECTIONS = {
  skills: {
    id: "skills",
    label: "Skills",
    to: getSkillsRoutePath(),
  },
  plugins: {
    id: "plugins",
    label: "Plugins",
    to: getPluginsRoutePath(),
  },
} satisfies Record<ToolsSectionId, ToolsSectionDefinition>;

const TOOLS_OWNED_COLLECTION_LABEL = {
  skills: "My skills",
  plugins: "Installed",
} as const satisfies Record<ToolsSectionId, string>;

const TOOLS_OWNED_COLLECTION_VIEW = {
  skills: "library",
  plugins: "installed",
} as const satisfies Record<ToolsSectionId, string>;

export function getToolsOwnedCollectionRoutePath(id: ToolsSectionId): string {
  return id === "plugins"
    ? SETTINGS_PLUGINS_ROUTE_PATH
    : `${TOOLS_SECTIONS[id].to}?view=${TOOLS_OWNED_COLLECTION_VIEW[id]}`;
}

interface ToolsBreadcrumbSegment {
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
    { label: "Plugins", to: getPluginsRoutePath() },
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
  } catch {}
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
    pattern: REGISTRY_SKILL_DETAIL_ROUTE_PATH,
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
    pattern: SKILL_DETAIL_ROUTE_PATH,
    section: "skills",
    collection: collectionCrumb("skills"),
    param: "skillId",
    fallback: "Skill",
  },
  {
    pattern: PLUGIN_DETAIL_ROUTE_PATH,
    section: "plugins",
    collection: collectionCrumb("plugins"),
    param: "pluginId",
    fallback: "Plugin",
  },
] as const;

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
  if (pathname === REGISTRY_SKILLS_ROUTE_PATH) {
    return [sectionCrumb("skills"), { label: "Browse" }];
  }

  for (const section of [TOOLS_SECTIONS.plugins, TOOLS_SECTIONS.skills]) {
    if (pathname === section.to) {
      return [
        sectionCrumb(section.id),
        {
          label:
            view === TOOLS_OWNED_COLLECTION_VIEW[section.id]
              ? TOOLS_OWNED_COLLECTION_LABEL[section.id]
              : "Browse",
        },
      ];
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

  return null;
}

interface ResourcePageDefinition {
  id:
    | "plugins-browse"
    | "plugins-installed"
    | "skills-browse"
    | "skills-library";
  label: string;
  to: string;
}

export const PLUGIN_PAGES: readonly ResourcePageDefinition[] = [
  {
    id: "plugins-browse",
    label: "Browse plugins",
    to: TOOLS_SECTIONS.plugins.to,
  },
  {
    id: "plugins-installed",
    label: "Installed plugins",
    to: `${TOOLS_SECTIONS.plugins.to}?view=installed`,
  },
];

export const SKILL_PAGES: readonly ResourcePageDefinition[] = [
  {
    id: "skills-browse",
    label: "Browse skills",
    to: TOOLS_SECTIONS.skills.to,
  },
  {
    id: "skills-library",
    label: TOOLS_OWNED_COLLECTION_LABEL.skills,
    to: getToolsOwnedCollectionRoutePath("skills"),
  },
];

export function resolveToolsActivePage(
  pathname: string,
  search = "",
): ResourcePageDefinition["id"] {
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

type ResourceWorkspaceHeaderMeta =
  | { kind: "section-title"; title: string }
  | { kind: "breadcrumbs"; breadcrumbs: ToolsBreadcrumbSegment[] };

export function resolvePluginsWorkspaceHeaderMeta(
  pathname: string,
  search = "",
): ResourceWorkspaceHeaderMeta | null {
  if (!isPluginsRoutePath(pathname)) return null;
  const pluginCreateBreadcrumbs = resolvePluginCreateBreadcrumbs(
    pathname,
    search,
  );
  if (pluginCreateBreadcrumbs !== null) {
    return { kind: "breadcrumbs", breadcrumbs: pluginCreateBreadcrumbs };
  }
  return { kind: "section-title", title: "Plugins" };
}

export function resolveSkillsWorkspaceHeaderMeta(
  pathname: string,
): ResourceWorkspaceHeaderMeta | null {
  if (!isSkillsRoutePath(pathname)) return null;
  return { kind: "section-title", title: "Skills" };
}
