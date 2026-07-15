import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthCallbackView } from "./views/AuthCallbackView";
import { QuickCreateProjectProvider } from "./hooks/useQuickCreateProject";
import { ProviderCliHealthToasts } from "./components/provider-cli/ProviderCliHealthToasts";
import { RouteNavigationProvider } from "./components/ui/app-route-anchor";
import { useAppTheme } from "./hooks/useAppTheme";
import { useFaviconColorSync } from "./lib/favicon-color-preference";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import {
  useDesktopUpdateAvailableToast,
  useUpdateAvailableToast,
} from "./hooks/useUpdateAvailableToast";
import { usePluginFrontendBoot } from "./hooks/usePluginFrontendBoot";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  AUTH_CALLBACK_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  getSettingsRoutePath,
} from "./lib/route-paths";
import { AppCommandProvider } from "./components/commands/AppCommandProvider";

const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
const ProjectSettingsView = lazy(() =>
  import("./views/ProjectSettingsView").then((m) => ({
    default: m.ProjectSettingsView,
  })),
);
const SplitWorkspaceRoute = lazy(() => import("./views/SplitWorkspaceRoute"));

function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <Routes>
          <Route path={SETTINGS_ROUTE_PATH} element={<SettingsView />} />
          <Route
            path={SETTINGS_SECTION_ROUTE_PATH}
            element={<SettingsView />}
          />
          <Route path={SETTINGS_PLUGIN_ROUTE_PATH} element={<SettingsView />} />
          <Route
            path={SETTINGS_PROVIDER_ROUTE_PATH}
            element={<SettingsView />}
          />
          <Route
            path={PROJECT_SETTINGS_ROUTE_PATH}
            element={<ProjectSettingsView />}
          />
          <Route
            path={PROJECT_ARCHIVED_ROUTE_PATH}
            element={<Navigate to={getSettingsRoutePath("archived")} replace />}
          />
          <Route
            path={PROJECTLESS_ARCHIVED_ROUTE_PATH}
            element={<Navigate to={getSettingsRoutePath("archived")} replace />}
          />
          <Route path="*" element={<SplitWorkspaceRoute />} />
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
  // Apply the server-stored app palette (built-in or custom CSS) app-wide.
  useAppTheme();
  // Reconcile the favicon tint with the server-stored appearance (and migrate
  // any legacy localStorage-only preference on first load).
  useFaviconColorSync();
  // Load plugin frontend bundles once the `plugins` experiment resolves.
  usePluginFrontendBoot();

  return (
    <QuickCreateProjectProvider>
      <AppCommandProvider>
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
      </AppCommandProvider>
    </QuickCreateProjectProvider>
  );
}
