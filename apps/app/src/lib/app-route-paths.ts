import { PERSONAL_PROJECT_ID } from "@bb/domain";

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const APP_SETTINGS_ROUTE_PATH = "/settings";
export const DEVELOPMENT_REPLAY_ROUTE_PATH = "/development-only/replay";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const STANDALONE_APP_ROUTE_PATH = "/apps/:applicationId";
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
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

export function getProjectSettingsRoutePath(projectId: string): string {
  return `/projects/${projectId}/settings`;
}

export function getProjectArchivedRoutePath(projectId: string): string {
  return `/projects/${projectId}/archived`;
}

export function getThreadRoutePath(args: ThreadRoutePathArgs): string {
  return isProjectlessProjectId(args.projectId)
    ? `/threads/${args.threadId}`
    : `/projects/${args.projectId}/threads/${args.threadId}`;
}

export function getStandaloneAppRoutePath(applicationId: string): string {
  return `/apps/${applicationId}`;
}

const baseAppRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  APP_SETTINGS_ROUTE_PATH,
  STANDALONE_APP_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
];

export const APP_ROUTE_PATTERNS = import.meta.env.DEV
  ? [...baseAppRoutePatterns, DEVELOPMENT_REPLAY_ROUTE_PATH]
  : baseAppRoutePatterns;
