import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { matchPath } from "react-router-dom";

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const APP_SETTINGS_ROUTE_PATH = "/settings";
export const AUTOMATIONS_ROUTE_PATH = "/automations";
export const DEVELOPMENT_REPLAY_ROUTE_PATH = "/development-only/replay";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const STANDALONE_APP_ROUTE_PATH = "/apps/:applicationId";
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const PROJECT_WORKFLOWS_ROUTE_PATH = "/projects/:projectId/workflows";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";
export const WORKFLOW_RUN_ROUTE_PATH = "/workflows/runs/:runId";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
}

export interface IsAppRoutePathArgs {
  path: string;
}

export interface ResolveAppRouteHrefArgs {
  currentOrigin: string;
  href: string;
}

export interface AppRouteHrefResolution {
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

export function getLegacyProjectComposeRoutePath(projectId: string): string {
  return `/projects/${projectId}`;
}

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

export function getProjectArchivedRoutePath(projectId: string): string {
  return `/projects/${projectId}/archived`;
}

export function getProjectWorkflowsRoutePath(projectId: string): string {
  return `/projects/${projectId}/workflows`;
}

export function getThreadRoutePath(args: ThreadRoutePathArgs): string {
  return isProjectlessProjectId(args.projectId)
    ? `/threads/${args.threadId}`
    : `/projects/${args.projectId}/threads/${args.threadId}`;
}

export function getStandaloneAppRoutePath(applicationId: string): string {
  return `/apps/${applicationId}`;
}

export function getWorkflowRunRoutePath(runId: string): string {
  return `/workflows/runs/${runId}`;
}

const baseAppRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  APP_SETTINGS_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  STANDALONE_APP_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECT_WORKFLOWS_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
  WORKFLOW_RUN_ROUTE_PATH,
];

export const APP_ROUTE_PATTERNS = import.meta.env.DEV
  ? [...baseAppRoutePatterns, DEVELOPMENT_REPLAY_ROUTE_PATH]
  : baseAppRoutePatterns;

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

export function isAppRoutePath({ path }: IsAppRoutePathArgs): boolean {
  const pathname = stripPathSuffix(path);
  return APP_ROUTE_PATTERNS.some(
    (pattern) => matchPath(pattern, pathname) !== null,
  );
}

export function resolveAppRouteHref({
  currentOrigin,
  href,
}: ResolveAppRouteHrefArgs): AppRouteHrefResolution | null {
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

  if (url.origin !== currentOrigin || !isAppRoutePath({ path: url.pathname })) {
    return null;
  }

  return {
    path: `${url.pathname}${url.search}${url.hash}`,
  };
}
