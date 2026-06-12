import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthCallbackView } from "./views/AuthCallbackView";
import { RootComposeRoute } from "./views/RootComposeView";
import { QuickCreateProjectProvider } from "./hooks/useQuickCreateProject";
import { ProviderCliHealthToasts } from "./components/provider-cli/ProviderCliHealthToasts";
import { RouteNavigationProvider } from "./components/ui/app-route-anchor";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import {
  useDesktopUpdateAvailableToast,
  useUpdateAvailableToast,
} from "./hooks/useUpdateAvailableToast";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  APP_ROOT_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECT_WORKFLOWS_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
  WORKFLOW_RUN_AGENT_ROUTE_PATH,
  WORKFLOW_RUN_ROUTE_PATH,
} from "./lib/route-paths";

const ThreadDetailRoute = lazy(
  () => import("./views/thread-detail/ThreadDetailRoute"),
);
const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
const AutomationsView = lazy(() =>
  import("./views/AutomationsView").then((m) => ({
    default: m.AutomationsView,
  })),
);
const ProjectSettingsView = lazy(() =>
  import("./views/ProjectSettingsView").then((m) => ({
    default: m.ProjectSettingsView,
  })),
);
const ProjectArchivedThreadsView = lazy(() =>
  import("./views/ProjectArchivedThreadsView").then((m) => ({
    default: m.ProjectArchivedThreadsView,
  })),
);
const WorkflowRunView = lazy(() =>
  import("./views/workflow-run/WorkflowRunView").then((m) => ({
    default: m.WorkflowRunView,
  })),
);
const ProjectWorkflowsView = lazy(() =>
  import("./views/project-workflows/ProjectWorkflowsView").then((m) => ({
    default: m.ProjectWorkflowsView,
  })),
);

function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <Routes>
          <Route path={APP_ROOT_ROUTE_PATH} element={<RootComposeRoute />} />
          <Route path={SETTINGS_ROUTE_PATH} element={<SettingsView />} />
          <Route path={AUTOMATIONS_ROUTE_PATH} element={<AutomationsView />} />
          <Route
            path={LEGACY_PROJECT_COMPOSE_ROUTE_PATH}
            element={<RootComposeRoute />}
          />
          <Route
            path={PROJECT_SETTINGS_ROUTE_PATH}
            element={<ProjectSettingsView />}
          />
          <Route
            path={PROJECT_ARCHIVED_ROUTE_PATH}
            element={<ProjectArchivedThreadsView />}
          />
          <Route
            path={PROJECT_WORKFLOWS_ROUTE_PATH}
            element={<ProjectWorkflowsView />}
          />
          <Route
            path={THREAD_DETAIL_ROUTE_PATH}
            element={<ThreadDetailRoute />}
          />
          <Route
            path={PROJECTLESS_THREAD_DETAIL_ROUTE_PATH}
            element={<ThreadDetailRoute />}
          />
          <Route path={WORKFLOW_RUN_ROUTE_PATH} element={<WorkflowRunView />} />
          <Route
            path={WORKFLOW_RUN_AGENT_ROUTE_PATH}
            element={<WorkflowRunView />}
          />
          <Route
            path="*"
            element={<Navigate to={APP_ROOT_ROUTE_PATH} replace />}
          />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

export function App() {
  // Connect WebSocket for real-time invalidation
  useWebSocket();
  // Show a toast when the server reports a newer bb-app published on npm.
  useUpdateAvailableToast();
  // Show a separate toast when the Electron shell reports a desktop update.
  useDesktopUpdateAvailableToast();
  // Keep the Electron window chrome (traffic lights, inactive title bar)
  // in sync with bb's resolved theme.
  useDesktopThemeSync();

  return (
    <QuickCreateProjectProvider>
      <RouteNavigationProvider>
        <ProviderCliHealthToasts />
        <Routes>
          <Route
            path={AUTH_CALLBACK_ROUTE_PATH}
            element={<AuthCallbackView />}
          />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </RouteNavigationProvider>
    </QuickCreateProjectProvider>
  );
}
