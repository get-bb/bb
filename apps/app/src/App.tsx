import { lazy, Suspense, useEffect } from "react";
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
import { AppNavigationUrlHost } from "./lib/url-open-routing";
import { AppFileExternalNavigationHost } from "./components/plugin/AppFileExternalNavigationHost";
import { useAppTheme } from "./hooks/useAppTheme";
import { useFaviconColorSync } from "./lib/favicon-color-preference";
import { useDesktopThemeSync } from "./hooks/useDesktopThemeSync";
import { usePluginFrontendBoot } from "./hooks/usePluginFrontendBoot";
import { markRouteContentPainted } from "./lib/route-content-paint";
import { useRememberPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
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
  LEGACY_TOOLS_PREFIX_ROUTE_PATH,
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  LEGACY_TOOLS_SPLAT_ROUTE_PATH,
  PROJECT_ARCHIVED_ROUTE_PATH,
  PROJECTLESS_ARCHIVED_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_PLUGIN_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SETTINGS_MACHINE_ROUTE_PATH,
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
import { ProviderCliInstallLogDialogHost } from "./components/provider-cli/provider-cli-install";
import { PluginSettingsCompatibilityRoute } from "./components/settings/PluginSettingsCompatibilityRoute";
import { RouteLoadingSkeleton } from "./components/ui/route-loading-skeleton";

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
// Start fetching the split-workspace route chunk (and, through Vite's preload
// helper, its static closure) as soon as the boot chunk evaluates instead of
// waiting for the first React render to reach the lazy element. Nearly every
// page load ends up on this route, so the request is never wasted, and on a
// phone the boot parse + first render otherwise adds a serialized round trip
// before the largest transfer even starts. The trailing catch only keeps a
// failed fetch from surfacing as an unhandled rejection while no route has
// rendered yet; React.lazy still receives the rejection when it renders.
const splitWorkspaceRouteModule = import("./views/SplitWorkspaceRoute");
splitWorkspaceRouteModule.catch(() => {});
const SplitWorkspaceRoute = lazy(() => splitWorkspaceRouteModule);

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

/**
 * /tools/* → /extensions/* preserving the subpath, query, and hash, so every
 * pre-rename deep link lands on its renamed page. The /tools/automations
 * routes keep their own more-specific redirects (React Router ranks static
 * segments above this splat), since those left Extensions for the plugin
 * panel rather than moving with the rename.
 */
export function LegacyToolsPathRedirect() {
  const location = useLocation();
  const suffix = location.pathname.slice(LEGACY_TOOLS_PREFIX_ROUTE_PATH.length);
  return (
    <Navigate
      to={{
        pathname: `${TOOLS_ROUTE_PATH}${suffix}`,
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  );
}

function hashTargetId(hash: string): string | null {
  if (hash.length <= 1) return null;
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

const HASH_NAVIGATION_WAIT_MS = 2_000;

export function HashNavigationScroll() {
  const location = useLocation();

  useEffect(() => {
    const targetId = hashTargetId(location.hash);
    if (targetId === null) return;

    const scrollToTarget = (): boolean => {
      const target = document.getElementById(targetId);
      if (target === null) return false;
      // Fragment destinations are navigation landmarks. Move keyboard focus as
      // well as the viewport, including for semantic sections that are not
      // normally focusable.
      if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) {
        target.tabIndex = -1;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "start", inline: "nearest" });
      return true;
    };

    if (scrollToTarget()) return;

    // Lazy routes and plugin slots may mount after the URL changes. Observe the
    // app until the destination exists instead of dropping the navigation.
    let observer: MutationObserver | null = null;
    let timeoutId: number | null = null;
    const stopWaiting = () => {
      observer?.disconnect();
      observer = null;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };
    observer = new MutationObserver(() => {
      if (scrollToTarget()) stopWaiting();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    timeoutId = window.setTimeout(stopWaiting, HASH_NAVIGATION_WAIT_MS);
    return stopWaiting;
  }, [location.hash, location.key]);

  return null;
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
          <Route
            path={TOOLS_ROUTE_PATH}
            element={<ExtensionsLandingRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_PREFIX_ROUTE_PATH}
            element={<LegacyToolsPathRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_SPLAT_ROUTE_PATH}
            element={<LegacyToolsPathRedirect />}
          />
          <Route path={SKILLS_ROUTE_PATH} element={<ToolsView />} />
          <Route path={TOOLS_SKILL_DETAIL_ROUTE_PATH} element={<ToolsView />} />
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
            element={<ExtensionsLandingRedirect />}
          />
          <Route
            path={TOOLS_PLUGIN_DETAIL_ROUTE_PATH}
            element={<ToolsView />}
          />
          <Route
            path={LEGACY_SKILLS_ROUTE_PATH}
            element={<Navigate to={SKILLS_ROUTE_PATH} replace />}
          />
          <Route
            path="*"
            element={
              // The thread / new-thread pane draws its own header, so while
              // its chunk loads the content area would otherwise be blank.
              // Settings and tools routes keep the outer null fallback: the
              // AppLayout header is already on screen for them.
              <Suspense fallback={<RouteLoadingSkeleton />}>
                <SplitWorkspaceRoute />
              </Suspense>
            }
          />
        </Routes>
        <RouteContentPaintSignal />
      </Suspense>
    </AppLayout>
  );
}

/**
 * Sibling of the lazy routes inside their Suspense boundary: React commits
 * it (and runs its effect) only once the first route content has resolved,
 * which is the signal deferred plugin frontend boot waits on.
 */
function RouteContentPaintSignal() {
  useEffect(() => {
    markRouteContentPainted();
  }, []);
  return null;
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
  useRememberPluginNavPanelChrome();

  return (
    <QuickCreateProjectProvider>
      <AppCommandProvider>
        <RouteNavigationProvider>
          <AppNavigationUrlHost>
            <AppFileExternalNavigationHost>
              <HashNavigationScroll />
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
             </AppFileExternalNavigationHost>
          </AppNavigationUrlHost>
        </RouteNavigationProvider>
      </AppCommandProvider>
    </QuickCreateProjectProvider>
  );
}
