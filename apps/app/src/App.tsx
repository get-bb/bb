import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthCallbackView } from "./views/AuthCallbackView";
import { RootComposeRoute } from "./views/RootComposeView";
import { QuickCreateProjectProvider } from "./hooks/useQuickCreateProject";
import { ProviderCliHealthToasts } from "./components/provider-cli/ProviderCliHealthToasts";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import {
  useDesktopUpdateAvailableToast,
  useUpdateAvailableToast,
} from "./hooks/useUpdateAvailableToast";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  APP_ROOT_ROUTE_PATH,
  APP_SETTINGS_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  DEVELOPMENT_REPLAY_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  STANDALONE_APP_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
} from "./lib/app-route-paths";

const ThreadDetailRoute = lazy(
  () => import("./views/thread-detail/ThreadDetailRoute"),
);
const AppSettingsView = lazy(() =>
  import("./views/AppSettingsView").then((m) => ({
    default: m.AppSettingsView,
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
const InternalReplayListView = lazy(() =>
  import("./views/InternalReplayListView").then((m) => ({
    default: m.InternalReplayListView,
  })),
);
const StandaloneAppView = lazy(() =>
  import("./views/standalone-app/StandaloneAppView").then((m) => ({
    default: m.StandaloneAppView,
  })),
);

function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <Routes>
          <Route path={APP_ROOT_ROUTE_PATH} element={<RootComposeRoute />} />
          <Route path={APP_SETTINGS_ROUTE_PATH} element={<AppSettingsView />} />
          <Route
            path={STANDALONE_APP_ROUTE_PATH}
            element={<StandaloneAppView />}
          />
          {import.meta.env.DEV ? (
            <Route
              path={DEVELOPMENT_REPLAY_ROUTE_PATH}
              element={<InternalReplayListView />}
            />
          ) : null}
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
            path={THREAD_DETAIL_ROUTE_PATH}
            element={<ThreadDetailRoute />}
          />
          <Route
            path={PROJECTLESS_THREAD_DETAIL_ROUTE_PATH}
            element={<ThreadDetailRoute />}
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
      <ProviderCliHealthToasts />
      <Routes>
        <Route
          path={AUTH_CALLBACK_ROUTE_PATH}
          element={<AuthCallbackView />}
        />
        <Route path="*" element={<AppRoutes />} />
      </Routes>
    </QuickCreateProjectProvider>
  );
}
