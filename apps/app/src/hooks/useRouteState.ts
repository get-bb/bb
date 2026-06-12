import { useLocation, useMatch } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

export interface RouteState {
  /** ID of the project in view (any project-scoped route), else undefined. */
  projectId: string | undefined;
  /** ID of the thread in view (thread detail only), else undefined. */
  threadId: string | undefined;
  /** On a thread detail URL. */
  isThreadView: boolean;
  /** On the project's archived threads list. */
  isArchivedView: boolean;
  /** On the project settings page. */
  isSettingsView: boolean;
  /** On the root route ("/"). */
  isRootView: boolean;
  /** On the projectless new-thread surface or canonical projectless thread URL. */
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
  const popoutProjectThreadMatch = useMatch(
    "/popout/projects/:projectId/threads/:threadId/*",
  );
  const popoutProjectlessThreadMatch = useMatch("/popout/threads/:threadId/*");
  const projectArchivedMatch = useMatch("/projects/:projectId/archived");
  const projectSettingsMatch = useMatch("/projects/:projectId/settings");
  const isRootView = location.pathname === "/";
  const isUnsupportedPersonalProjectThread =
    projectThreadMatch?.params.projectId === PERSONAL_PROJECT_ID ||
    popoutProjectThreadMatch?.params.projectId === PERSONAL_PROJECT_ID;
  const projectlessThreadId =
    projectlessThreadMatch?.params.threadId ??
    popoutProjectlessThreadMatch?.params.threadId;
  const threadId =
    projectlessThreadId ??
    (isUnsupportedPersonalProjectThread
      ? undefined
      : (projectThreadMatch?.params.threadId ??
        popoutProjectThreadMatch?.params.threadId));
  const projectRouteProjectId =
    projectMatch?.params.projectId ?? popoutProjectThreadMatch?.params.projectId;
  const projectId =
    projectlessThreadId !== undefined
      ? PERSONAL_PROJECT_ID
      : isUnsupportedPersonalProjectThread
        ? undefined
        : projectRouteProjectId;

  return {
    projectId,
    threadId,
    isThreadView:
      Boolean(projectlessThreadMatch) ||
      Boolean(popoutProjectlessThreadMatch) ||
      ((Boolean(projectThreadMatch) || Boolean(popoutProjectThreadMatch)) &&
        !isUnsupportedPersonalProjectThread),
    isArchivedView: Boolean(projectArchivedMatch),
    isSettingsView: Boolean(projectSettingsMatch),
    isRootView,
    isProjectlessView: isRootView || projectlessThreadId !== undefined,
  };
}
