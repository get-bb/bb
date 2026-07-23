import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthCallbackView } from "./views/AuthCallbackView";
import { QuickCreateProjectProvider } from "./hooks/useQuickCreateProject";
import { RouteNavigationProvider } from "./components/ui/app-route-anchor";
import { useAppTheme } from "./hooks/useAppTheme";
import { useFaviconColorSync } from "./lib/favicon-color-preference";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import { usePluginFrontendBoot } from "./hooks/usePluginFrontendBoot";
import { useWebSocket } from "./hooks/useWebSocket";
import {
  AUTOMATION_DETAIL_ROUTE_PATH,
  AUTOMATIONS_ROUTE_PATH,
  AUTH_CALLBACK_ROUTE_PATH,
  LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_AUTOMATIONS_ROUTE_PATH,
  LEGACY_SKILLS_ROUTE_PATH,
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SKILLS_ROUTE_PATH,
  TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  getAutomationDetailRoutePath,
  getSettingsRoutePath,
  getSkillDetailRoutePath,
} from "./lib/route-paths";
import { AppCommandProvider } from "./components/commands/AppCommandProvider";
import { ToolsExperimentGate } from "./components/tools/ToolsExperimentGate";
import { PluginSettingsCompatibilityRoute } from "./components/settings/PluginSettingsCompatibilityRoute";

const SettingsView = lazy(() =>
  import("./views/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
const ToolsView = lazy(() =>
  import("./views/ToolsView").then((m) => ({
    default: m.ToolsView,
  })),
);
const ProjectSettingsView = lazy(() =>
  import("./views/ProjectSettingsView").then((m) => ({
    default: m.ProjectSettingsView,
  })),
);
const SplitWorkspaceRoute = lazy(() => import("./views/SplitWorkspaceRoute"));

function LegacyAutomationDetailRedirect() {
  const { projectId, automationId } = useParams<{
    projectId?: string;
    automationId?: string;
  }>();

  if (!projectId || !automationId) {
    return <Navigate to={AUTOMATIONS_ROUTE_PATH} replace />;
  }
  return (
    <Navigate
      to={getAutomationDetailRoutePath({ projectId, automationId })}
      replace
    />
  );
}

export function LegacySkillDetailRedirect() {
  const { skillId } = useParams<{ skillId?: string }>();
  return (
    <Navigate
      to={skillId ? getSkillDetailRoutePath({ skillId }) : SKILLS_ROUTE_PATH}
      replace
    />
  );
}

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
          <Route
            path={SETTINGS_PLUGINS_ROUTE_PATH}
            element={
              <PluginSettingsCompatibilityRoute>
                <SettingsView />
              </PluginSettingsCompatibilityRoute>
            }
          />
          <Route
            path={SETTINGS_PLUGIN_ROUTE_PATH}
            element={
              <PluginSettingsCompatibilityRoute>
                <SettingsView />
              </PluginSettingsCompatibilityRoute>
            }
          />
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
          <Route element={<ToolsExperimentGate />}>
            <Route
              path={TOOLS_ROUTE_PATH}
              element={<Navigate to={SKILLS_ROUTE_PATH} replace />}
            />
            <Route path={SKILLS_ROUTE_PATH} element={<ToolsView />} />
            <Route
              path={TOOLS_SKILL_DETAIL_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route
              path={LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH}
              element={<LegacySkillDetailRedirect />}
            />
            <Route
              path={TOOLS_REGISTRY_SKILLS_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route
              path={TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route path={TOOLS_PLUGINS_ROUTE_PATH} element={<ToolsView />} />
            <Route
              path={TOOLS_PLUGIN_BROWSE_ROUTE_PATH}
              element={
                <Navigate
                  to={`${TOOLS_PLUGINS_ROUTE_PATH}?view=browse`}
                  replace
                />
              }
            />
            <Route
              path={TOOLS_PLUGIN_DETAIL_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route path={AUTOMATIONS_ROUTE_PATH} element={<ToolsView />} />
            <Route
              path={TOOLS_AUTOMATION_BROWSE_ROUTE_PATH}
              element={
                <Navigate
                  to={`${AUTOMATIONS_ROUTE_PATH}?view=browse`}
                  replace
                />
              }
            />
            <Route
              path={AUTOMATION_DETAIL_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route
              path={TOOLS_AUTOMATION_EDIT_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route
              path={LEGACY_SKILLS_ROUTE_PATH}
              element={<Navigate to={SKILLS_ROUTE_PATH} replace />}
            />
            <Route
              path={LEGACY_AUTOMATIONS_ROUTE_PATH}
              element={<Navigate to={AUTOMATIONS_ROUTE_PATH} replace />}
            />
            <Route
              path={LEGACY_AUTOMATION_DETAIL_ROUTE_PATH}
              element={<LegacyAutomationDetailRedirect />}
            />
          </Route>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </Suspense>
    </AppLayout>
  );
}

export function App() {
  // Connect WebSocket for real-time invalidation
  useWebSocket();
  // Keep the Electron window chrome (traffic lights, inactive title bar)
  // in sync with bb's theme preference.
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
