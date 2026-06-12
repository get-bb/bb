import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { matchPath } from "react-router-dom";

export const APP_ROOT_ROUTE_PATH = "/";
export const AUTH_CALLBACK_ROUTE_PATH = "/auth/callback";
export const SETTINGS_ROUTE_PATH = "/settings";
export const AUTOMATIONS_ROUTE_PATH = "/automations";
export const ROOT_COMPOSE_ROUTE_PATH = APP_ROOT_ROUTE_PATH;
export const LEGACY_PROJECT_COMPOSE_ROUTE_PATH = "/projects/:projectId";
export const PROJECTLESS_THREAD_DETAIL_ROUTE_PATH = "/threads/:threadId";
export const PROJECT_SETTINGS_ROUTE_PATH = "/projects/:projectId/settings";
export const PROJECT_ARCHIVED_ROUTE_PATH = "/projects/:projectId/archived";
export const PROJECT_WORKFLOWS_ROUTE_PATH = "/projects/:projectId/workflows";
export const THREAD_DETAIL_ROUTE_PATH =
  "/projects/:projectId/threads/:threadId";
export const WORKFLOW_RUN_ROUTE_PATH = "/workflows/runs/:runId";
export const WORKFLOW_RUN_AGENT_ROUTE_PATH =
  "/workflows/runs/:runId/agents/:agentIndex";

export interface ThreadRoutePathArgs {
  projectId: string;
  threadId: string;
}

export interface WorkflowRunAgentRoutePathArgs {
  /** Journal-stable 1-based agent index (snapshot `agent.index`). */
  agentIndex: number;
  runId: string;
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

export function getWorkflowRunRoutePath(runId: string): string {
  return `/workflows/runs/${runId}`;
}

export function getWorkflowRunAgentRoutePath(
  args: WorkflowRunAgentRoutePathArgs,
): string {
  return `/workflows/runs/${args.runId}/agents/${args.agentIndex}`;
}

const baseRoutePatterns: readonly string[] = [
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECT_WORKFLOWS_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
  WORKFLOW_RUN_ROUTE_PATH,
  WORKFLOW_RUN_AGENT_ROUTE_PATH,
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
