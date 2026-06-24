import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  POPOUT_ROUTE_PATH,
  getDesktopPopoutThreadRoutePath,
  type BbDesktopPopoutThreadRef,
} from "@bb/desktop-contract";
import { matchPath } from "react-router-dom";

export { POPOUT_ROUTE_PATH };

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const POPOUT_PROJECTLESS_THREAD_DETAIL_ROUTE_PATH =
  "/popout/threads/:threadId";
export const POPOUT_THREAD_DETAIL_ROUTE_PATH =
  "/popout/projects/:projectId/threads/:threadId";
export const SETTINGS_ROUTE_PATH = "/settings";
export const AUTOMATIONS_ROUTE_PATH = "/automations";
export const AUTOMATION_DETAIL_ROUTE_PATH =
  "/automations/:projectId/:automationId";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_ARCHIVED_ROUTE_PATH = "/archived";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
}

export type ThreadRouteSurface = "page" | "popout";

export interface SurfaceAwareThreadRoutePathArgs extends ThreadRoutePathArgs {
  surface: ThreadRouteSurface;
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

export function getAutomationsRoutePath(): string {
  return AUTOMATIONS_ROUTE_PATH;
}

export interface AutomationDetailRoutePathArgs {
  projectId: string;
  automationId: string;
}

export function getAutomationDetailRoutePath({
  projectId,
  automationId,
}: AutomationDetailRoutePathArgs): string {
  return `/automations/${projectId}/${automationId}`;
}

export function getPopoutRoutePath(): string {
  return POPOUT_ROUTE_PATH;
}

export function getPopoutThreadRoutePath(args: ThreadRoutePathArgs): string {
  const thread: BbDesktopPopoutThreadRef = {
    projectId: args.projectId,
    threadId: args.threadId,
  };
  return getDesktopPopoutThreadRoutePath(thread);
}

export function getLegacyProjectComposeRoutePath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

export function getProjectlessArchivedRoutePath(): string {
  return PROJECTLESS_ARCHIVED_ROUTE_PATH;
}

export function getProjectArchivedRoutePath(projectId: string): string {
  if (isProjectlessProjectId(projectId)) {
    return getProjectlessArchivedRoutePath();
  }
  return `/projects/${projectId}/archived`;
}

// Folders live in the personal/projectless section, so a folder's archived
// list reuses the projectless archived route, scoped by a `folderId` query param.
export function getFolderArchivedRoutePath(folderId: string): string {
  return `${PROJECTLESS_ARCHIVED_ROUTE_PATH}?folderId=${encodeURIComponent(
    folderId,
  )}`;
}

export function getThreadRoutePath(args: ThreadRoutePathArgs): string {
  return isProjectlessProjectId(args.projectId)
    ? `/threads/${args.threadId}`
    : `/projects/${args.projectId}/threads/${args.threadId}`;
}

export function getSurfaceAwareThreadRoutePath(
  args: SurfaceAwareThreadRoutePathArgs,
): string {
  return args.surface === "popout"
    ? getPopoutThreadRoutePath(args)
    : getThreadRoutePath(args);
}

const baseRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  POPOUT_ROUTE_PATH,
  POPOUT_PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  POPOUT_THREAD_DETAIL_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
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
