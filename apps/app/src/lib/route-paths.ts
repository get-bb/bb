import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { matchPath } from "react-router-dom";

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const SETTINGS_ROUTE_PATH = "/settings";
// Settings buckets (general, files, …) and per-plugin settings pages. The
// static "plugins" segment wins over :section, so /settings/plugins is the
// plugin management bucket and /settings/plugins/:id a plugin's own page.
export const SETTINGS_SECTION_ROUTE_PATH = "/settings/:section";
export const SETTINGS_PLUGIN_ROUTE_PATH = "/settings/plugins/:pluginId";
export const SETTINGS_PROVIDER_ROUTE_PATH = "/settings/providers/:providerId";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_ARCHIVED_ROUTE_PATH = "/archived";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";
// Trailing splat: the remainder is the panel's `subPath` (empty at the root).
export const PLUGIN_PANEL_ROUTE_PATH = "/plugins/:pluginId/:panelPath/*";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
}

export interface IsRoutePathArgs {
  path: string;
}

export interface ResolveRouteHrefArgs {
  currentOrigin: string;
  href: string;
}

export interface RouteHrefResolution {
  path: string;
}

export function isProjectlessProjectId(
  projectId: string | null | undefined,
): boolean {
  return projectId === PERSONAL_PROJECT_ID;
}

export function getRootComposeRoutePath(): string {
  return ROOT_COMPOSE_ROUTE_PATH;
}

export function getLegacyProjectComposeRoutePath(projectId: string): string {
  return `/projects/${projectId}`;
}

// Opens a project's compose view. The personal project has no `/projects/:id`
// surface — its compose view is the app root — so it routes there instead.
export function getProjectComposeRoutePath(projectId: string): string {
  return isProjectlessProjectId(projectId)
    ? getRootComposeRoutePath()
    : getLegacyProjectComposeRoutePath(projectId);
}

export function getSettingsRoutePath(section?: string): string {
  return section === undefined
    ? SETTINGS_ROUTE_PATH
    : `/settings/${encodeURIComponent(section)}`;
}

export function getSettingsPluginRoutePath(pluginId: string): string {
  return `/settings/plugins/${encodeURIComponent(pluginId)}`;
}

export function getSettingsProviderRoutePath(providerId: string): string {
  return `/settings/providers/${encodeURIComponent(providerId)}`;
}

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

export interface PluginPanelRoutePathArgs {
  pluginId: string;
  /** The nav panel's registered `path` segment (validated: [a-zA-Z0-9_-]+). */
  path: string;
  /** Location inside the panel; segments are encoded, slashes preserved. */
  subPath?: string;
}

export function getPluginPanelRoutePath({
  pluginId,
  path,
  subPath,
}: PluginPanelRoutePathArgs): string {
  const root = `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(path)}`;
  if (subPath === undefined || subPath === "") {
    return root;
  }
  const encoded = subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

export function getThreadRoutePath(args: ThreadRoutePathArgs): string {
  return isProjectlessProjectId(args.projectId)
    ? `/threads/${args.threadId}`
    : `/projects/${args.projectId}/threads/${args.threadId}`;
}

const baseRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
];

export const ROUTE_PATTERNS = baseRoutePatterns;

const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//iu;

function stripPathSuffix(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const suffixIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);
  return suffixIndex === -1 ? path : path.slice(0, suffixIndex);
}

export function isRoutePath({ path }: IsRoutePathArgs): boolean {
  const pathname = stripPathSuffix(path);
  return ROUTE_PATTERNS.some(
    (pattern) => matchPath(pattern, pathname) !== null,
  );
}

export function resolveRouteHref({
  currentOrigin,
  href,
}: ResolveRouteHrefArgs): RouteHrefResolution | null {
  if (
    href.length === 0 ||
    href.startsWith("//") ||
    (!href.startsWith("/") && !ABSOLUTE_HTTP_URL_PATTERN.test(href))
  ) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(href, currentOrigin);
  } catch {
    return null;
  }

  if (url.origin !== currentOrigin || !isRoutePath({ path: url.pathname })) {
    return null;
  }

  return {
    path: `${url.pathname}${url.search}${url.hash}`,
  };
}
