import { lazy, Suspense } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
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
  AUTH_CALLBACK_ROUTE_PATH,
  LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_AUTOMATIONS_ROUTE_PATH,
  LEGACY_SKILLS_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH,
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_MACHINE_ROUTE_PATH,
  SETTINGS_PROVIDER_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  SETTINGS_SECTION_ROUTE_PATH,
  SKILLS_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getAutomationsRoutePath,
  getSettingsRoutePath,
  getSkillDetailRoutePath,
} from "./lib/route-paths";
import { AppCommandProvider } from "./components/commands/AppCommandProvider";
import { OnboardingHost } from "@/components/onboarding/OnboardingHost";
import { ProviderCliInstallLogDialogHost } from "./components/provider-cli/provider-cli-install";
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
const MachineSettingsView = lazy(() =>
  import("./views/MachineSettingsView").then((m) => ({
    default: m.MachineSettingsView,
  })),
);
const ProjectSettingsView = lazy(() =>
  import("./views/ProjectSettingsView").then((m) => ({
    default: m.ProjectSettingsView,
  })),
);
const SplitWorkspaceRoute = lazy(() => import("./views/SplitWorkspaceRoute"));

export function LegacyAutomationDetailRedirect() {
  const location = useLocation();
  const { projectId, automationId } = useParams<{
    projectId?: string;
    automationId?: string;
  }>();

  if (!projectId || !automationId) {
    return <Navigate to={getAutomationsRoutePath()} replace />;
  }
  return (
    <Navigate
      to={
        location.pathname.endsWith("/edit")
          ? getAutomationEditRoutePath({ projectId, automationId })
          : getAutomationDetailRoutePath({ projectId, automationId })
      }
      replace
    />
  );
}

export function LegacyAutomationCollectionRedirect() {
  const location = useLocation();
  const browse =
    location.pathname.endsWith("/browse") ||
    new URLSearchParams(location.search).get("view") === "browse";
  return (
    <Navigate
      to={
        browse
          ? `${getAutomationsRoutePath()}/browse`
          : getAutomationsRoutePath()
      }
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

export function ExtensionsLandingRedirect() {
  return <Navigate to={TOOLS_PLUGINS_ROUTE_PATH} replace />;
}

export function LegacyPluginBrowseRedirect() {
  return <Navigate to={TOOLS_PLUGINS_ROUTE_PATH} replace />;
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
            path={SETTINGS_MACHINE_ROUTE_PATH}
            element={<MachineSettingsView />}
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
          <Route
            path={LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH}
            element={<LegacyAutomationCollectionRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_AUTOMATION_BROWSE_ROUTE_PATH}
            element={<LegacyAutomationCollectionRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_AUTOMATION_DETAIL_ROUTE_PATH}
            element={<LegacyAutomationDetailRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_AUTOMATION_EDIT_ROUTE_PATH}
            element={<LegacyAutomationDetailRedirect />}
          />
          <Route
            path={LEGACY_AUTOMATIONS_ROUTE_PATH}
            element={<LegacyAutomationCollectionRedirect />}
          />
          <Route
            path={LEGACY_AUTOMATION_DETAIL_ROUTE_PATH}
            element={<LegacyAutomationDetailRedirect />}
          />
          <Route element={<ToolsExperimentGate />}>
            <Route
              path={TOOLS_ROUTE_PATH}
              element={<ExtensionsLandingRedirect />}
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
              element={<LegacyPluginBrowseRedirect />}
            />
            <Route
              path={TOOLS_PLUGIN_DETAIL_ROUTE_PATH}
              element={<ToolsView />}
            />
            <Route
              path={LEGACY_SKILLS_ROUTE_PATH}
              element={<Navigate to={SKILLS_ROUTE_PATH} replace />}
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
  // Load plugin frontend bundles once system config resolves.
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
          {/* Outside <Routes>: a provider CLI install outlives the page that
              started it, so its failure toast can be clicked from any route —
              including auth callback, which renders no app shell. */}
          <ProviderCliInstallLogDialogHost />
          {/* First-run onboarding. Outside <Routes> so it is not tied to a
              page. It self-gates on the experiment and completion timestamp. */}
          <OnboardingHost />
        </RouteNavigationProvider>
      </AppCommandProvider>
    </QuickCreateProjectProvider>
  );
}
