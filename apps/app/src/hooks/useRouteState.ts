import { useLocation, useMatch } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { isToolsRoutePath, TOOLS_SKILLS_ROUTE_PATH } from "@/lib/route-paths";

export interface RouteState {
  /** ID of the project in view (any project-scoped route), else undefined. */
  projectId: string | undefined;
  /** ID of the thread in view (thread detail only), else undefined. */
  threadId: string | undefined;
  /** On a thread detail URL. */
  isThreadView: boolean;
  /** On a project or projectless archived threads list. */
  isArchivedView: boolean;
  /** On the project settings page. */
  isSettingsView: boolean;
  /** On Extensions or a legacy tool route. */
  isToolsView: boolean;
  /** On the Skills surface. */
  isSkillsView: boolean;
  /** On the root route ("/"). */
  isRootView: boolean;
  /** On a projectless surface: compose, thread detail, or archived threads. */
  isProjectlessView: boolean;
}

/**
 * Single source of truth for URL → logical route state. All route pattern
 * matching for "what view are we in" happens here so that shifts in the route
 * schema have one place to update instead of N scattered `useMatch` calls.
 */
export function useRouteState(): RouteState {
  const location = useLocation();
  // Wildcard match exists only to extract `projectId` from any
  // project-scoped subroute; specific-view detection uses exact matches so a
  // new subroute doesn't accidentally count as the root compose redirect.
  const projectMatch = useMatch("/projects/:projectId/*");
  const projectThreadMatch = useMatch(
    "/projects/:projectId/threads/:threadId/*",
  );
  const projectlessThreadMatch = useMatch("/threads/:threadId/*");
  const projectlessArchivedMatch = useMatch("/archived");
  const projectArchivedMatch = useMatch("/projects/:projectId/archived");
  const projectSettingsMatch = useMatch("/projects/:projectId/settings");
  // Legacy /tools URLs count too: they redirect to /extensions, and treating
  // them as tools views keeps the chrome stable for the redirect frame.
  const isToolsPath =
    isToolsRoutePath(location.pathname) ||
    location.pathname === "/tools" ||
    location.pathname.startsWith("/tools/");
  const isRootView = location.pathname === "/";
  const isUnsupportedPersonalProjectThread =
    projectThreadMatch?.params.projectId === PERSONAL_PROJECT_ID;
  const projectlessThreadId = projectlessThreadMatch?.params.threadId;
  const threadId =
    projectlessThreadId ??
    (isUnsupportedPersonalProjectThread
      ? undefined
      : projectThreadMatch?.params.threadId);
  const projectRouteProjectId = projectMatch?.params.projectId;
  const projectId =
    projectlessThreadId !== undefined || Boolean(projectlessArchivedMatch)
      ? PERSONAL_PROJECT_ID
      : isUnsupportedPersonalProjectThread
        ? undefined
        : projectRouteProjectId;

  return {
    projectId,
    threadId,
    isThreadView:
      Boolean(projectlessThreadMatch) ||
      (Boolean(projectThreadMatch) && !isUnsupportedPersonalProjectThread),
    isArchivedView:
      Boolean(projectArchivedMatch) || Boolean(projectlessArchivedMatch),
    isSettingsView: Boolean(projectSettingsMatch),
    isToolsView:
      isToolsPath ||
      location.pathname === "/skills" ||
      location.pathname === "/automations",
    isSkillsView:
      location.pathname === TOOLS_SKILLS_ROUTE_PATH ||
      location.pathname === "/skills",
    isRootView,
    isProjectlessView:
      isRootView ||
      projectlessThreadId !== undefined ||
      Boolean(projectlessArchivedMatch),
  };
}
