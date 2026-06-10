import { useLocation, useMatch } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";

export interface AppRouteState {
  /** ID of the project in view (any project-scoped route), else undefined. */
  projectId: string | undefined;
  /** ID of the thread in view (thread detail only), else undefined. */
  threadId: string | undefined;
  /** ID of the global app in view (standalone app route only), else undefined. */
  applicationId: string | undefined;
  /** ID of the workflow run in view (run page only), else undefined. */
  workflowRunId: string | undefined;
  /** On the standalone app surface (`/apps/:applicationId`). */
  isAppView: boolean;
  /** On a thread detail URL. */
  isThreadView: boolean;
  /** On the project's archived threads list. */
  isArchivedView: boolean;
  /** On the project's workflows tab. */
  isWorkflowsView: boolean;
  /** On the projectless workflow-run page (`/workflows/runs/:runId`). */
  isWorkflowRunView: boolean;
  /** On the project settings page. */
  isSettingsView: boolean;
  /** On the app root ("/"). */
  isRootView: boolean;
  /** On the projectless new-thread surface or canonical projectless thread URL. */
  isProjectlessView: boolean;
}

/**
 * Single source of truth for URL → logical route state. All route pattern
 * matching for "what view are we in" happens here so that shifts in the route
 * schema have one place to update instead of N scattered `useMatch` calls.
 */
export function useAppRoute(): AppRouteState {
  const location = useLocation();
  // Wildcard match exists only to extract `projectId` from any
  // project-scoped subroute; specific-view detection uses exact matches so a
  // new subroute doesn't accidentally count as the root compose redirect.
  const projectMatch = useMatch("/projects/:projectId/*");
  const projectThreadMatch = useMatch(
    "/projects/:projectId/threads/:threadId/*",
  );
  const projectlessThreadMatch = useMatch("/threads/:threadId/*");
  const projectArchivedMatch = useMatch("/projects/:projectId/archived");
  const projectWorkflowsMatch = useMatch("/projects/:projectId/workflows");
  const projectSettingsMatch = useMatch("/projects/:projectId/settings");
  const appMatch = useMatch("/apps/:applicationId");
  // The run page and its agent drill-in sub-route are the same logical view;
  // both must resolve `workflowRunId` so the sidebar active state and the
  // document title survive selecting an agent.
  const workflowRunMatch = useMatch("/workflows/runs/:runId");
  const workflowRunAgentMatch = useMatch(
    "/workflows/runs/:runId/agents/:agentIndex",
  );
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
    projectlessThreadId !== undefined
      ? PERSONAL_PROJECT_ID
      : isUnsupportedPersonalProjectThread
        ? undefined
        : projectRouteProjectId;

  return {
    projectId,
    threadId,
    applicationId: appMatch?.params.applicationId,
    workflowRunId:
      workflowRunMatch?.params.runId ?? workflowRunAgentMatch?.params.runId,
    isAppView: Boolean(appMatch),
    isThreadView:
      Boolean(projectlessThreadMatch) ||
      (Boolean(projectThreadMatch) && !isUnsupportedPersonalProjectThread),
    isArchivedView: Boolean(projectArchivedMatch),
    isWorkflowsView: Boolean(projectWorkflowsMatch),
    isWorkflowRunView: Boolean(workflowRunMatch) || Boolean(workflowRunAgentMatch),
    isSettingsView: Boolean(projectSettingsMatch),
    isRootView,
    isProjectlessView: isRootView || projectlessThreadId !== undefined,
  };
}
