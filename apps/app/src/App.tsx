import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthCallbackView } from "./views/AuthCallbackView";
import { RootComposeRoute } from "./views/RootComposeView";
import { QuickCreateProjectProvider } from "./hooks/useQuickCreateProject";
import { ProviderCliHealthToasts } from "./components/provider-cli/ProviderCliHealthToasts";
import { RouteNavigationProvider } from "./components/ui/app-route-anchor";
import { useAppTheme } from "./hooks/useAppTheme";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import {
  useDesktopUpdateAvailableToast,
  useUpdateAvailableToast,
} from "./hooks/useUpdateAvailableToast";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  APP_ROOT_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_PROJECT_COMPOSE_ROUTE_PATH,
  POPOUT_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_THREAD_DETAIL_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  THREAD_DETAIL_ROUTE_PATH,
} from "./lib/route-paths";
import { Icon } from "./components/ui/icon";
import {
  POPOUT_QUICK_ASK_HEIGHT,
  POPOUT_SHADOW_MARGIN,
} from "@bb/desktop-contract";

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
const AutomationDetailView = lazy(() =>
  import("./views/AutomationDetailView").then((m) => ({
    default: m.AutomationDetailView,
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
const PopoutChatView = lazy(() =>
  import("./views/PopoutChatView").then((m) => ({
    default: m.PopoutChatView,
  })),
);

function PopoutRouteFallback() {
  useEffect(() => {
    document.documentElement.setAttribute("data-bb-popout-route", "");
    document.body.setAttribute("data-bb-popout-route", "");
    return () => {
      document.documentElement.removeAttribute("data-bb-popout-route");
      document.body.removeAttribute("data-bb-popout-route");
    };
  }, []);

  return (
    <div
      className="flex h-screen flex-col overflow-visible bg-transparent text-foreground"
      style={{ padding: `${POPOUT_SHADOW_MARGIN}px` }}
    >
      <div
        className="flex min-h-0 w-full flex-col items-center justify-center rounded-2xl border border-border bg-background text-sm text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_2px_8px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.16)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.07),0_2px_8px_rgba(0,0,0,0.4),0_8px_20px_rgba(0,0,0,0.5)]"
        style={{ height: `${POPOUT_QUICK_ASK_HEIGHT}px` }}
      >
        <Icon name="Spinner" className="mb-2 size-4 animate-spin" />
        Loading...
      </div>
    </div>
  );
}

function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={null}>
        <Routes>
          <Route path={APP_ROOT_ROUTE_PATH} element={<RootComposeRoute />} />
          <Route path={SETTINGS_ROUTE_PATH} element={<SettingsView />} />
          <Route
            path={AUTOMATIONS_ROUTE_PATH}
            element={<AutomationsView />}
          />
          <Route
            path={AUTOMATION_DETAIL_ROUTE_PATH}
            element={<AutomationDetailView />}
          />
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
            path={PROJECTLESS_ARCHIVED_ROUTE_PATH}
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
  // Apply the server-stored app palette (built-in or custom CSS) app-wide.
  useAppTheme();

  return (
    <QuickCreateProjectProvider>
      <RouteNavigationProvider>
        <ProviderCliHealthToasts />
        <Routes>
          <Route
            path={AUTH_CALLBACK_ROUTE_PATH}
            element={<AuthCallbackView />}
          />
          <Route
            path={`${POPOUT_ROUTE_PATH}/*`}
            element={
              <Suspense fallback={<PopoutRouteFallback />}>
                <PopoutChatView />
              </Suspense>
            }
          />
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </RouteNavigationProvider>
    </QuickCreateProjectProvider>
  );
}
