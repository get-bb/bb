// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  AppRoutes,
  LegacyInstalledPluginsRedirect,
  LegacyPluginsPathRedirect,
  LegacySkillsPathRedirect,
  LegacyToolsPathRedirect,
  PluginsLandingRedirect,
} from "./App";
import {
  LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH,
  LEGACY_TOOLS_PREFIX_ROUTE_PATH,
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  LEGACY_TOOLS_SPLAT_ROUTE_PATH,
  PLUGINS_ROUTE_PATH,
  SETTINGS_PLUGINS_ROUTE_PATH,
  SKILLS_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_SKILLS_ROUTE_PATH,
} from "./lib/route-paths";

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./views/SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));
vi.mock("./views/ToolsView", () => ({
  PluginsView: ({ pluginId }: { pluginId?: string }) => (
    <h1>Plugin detail: {pluginId}</h1>
  ),
}));

function HistoryBackButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}

function LocationPath() {
  const location = useLocation();
  return (
    <span>
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

afterEach(cleanup);

describe("legacy Extensions redirects", () => {
  it.each(["github", "plugin with spaces"])(
    "redirects legacy installed detail for %s without changing configuration routes",
    async (pluginId) => {
      const settingsPath = `/settings/plugins/${encodeURIComponent(pluginId)}`;
      render(
        <MemoryRouter
          initialEntries={[
            settingsPath,
            `${settingsPath}?view=installed&from=bookmark#details`,
          ]}
          initialIndex={1}
        >
          <AppRoutes />
          <LocationPath />
          <HistoryBackButton />
        </MemoryRouter>,
      );
      expect(
        await screen.findByRole("heading", {
          name: `Plugin detail: ${pluginId}`,
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `/plugins/${encodeURIComponent(pluginId)}?view=installed&from=bookmark#details`,
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(
        await screen.findByRole("heading", { name: "Settings" }),
      ).toBeTruthy();
      expect(screen.getByText(settingsPath)).toBeTruthy();
    },
  );

  it("redirects the legacy Settings plugin manager to Installed plugins", () => {
    render(
      <MemoryRouter initialEntries={[SETTINGS_PLUGINS_ROUTE_PATH]}>
        <Routes>
          <Route
            path={SETTINGS_PLUGINS_ROUTE_PATH}
            element={<LegacyInstalledPluginsRedirect />}
          />
          <Route path={PLUGINS_ROUTE_PATH} element={<LocationPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("/plugins?view=installed")).toBeTruthy();
  });

  it("redirects the Extensions root to Plugins while preserving query and hash", () => {
    render(
      <MemoryRouter initialEntries={["/extensions?view=installed#catalog"]}>
        <Routes>
          <Route path={TOOLS_ROUTE_PATH} element={<PluginsLandingRedirect />} />
          <Route path={`${PLUGINS_ROUTE_PATH}/*`} element={<LocationPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("/plugins?view=installed#catalog")).toBeTruthy();
  });

  it.each([
    [TOOLS_PLUGINS_ROUTE_PATH, "/extensions/plugins", "/plugins"],
    [
      TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
      "/extensions/plugins/browse?sort=name#catalog",
      "/plugins?sort=name#catalog",
    ],
    [
      TOOLS_PLUGIN_DETAIL_ROUTE_PATH,
      "/extensions/plugins/github?view=installed#configuration",
      "/plugins/github?view=installed#configuration",
    ],
  ])(
    "redirects %s to its canonical Plugins path",
    (pattern, entry, expected) => {
      render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path={pattern} element={<LegacyPluginsPathRedirect />} />
            <Route
              path={`${PLUGINS_ROUTE_PATH}/*`}
              element={<LocationPath />}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it.each([
    [TOOLS_SKILLS_ROUTE_PATH, "/extensions/skills", "/skills"],
    [
      TOOLS_SKILL_DETAIL_ROUTE_PATH,
      "/extensions/skills/library/skill_abc123?source=local#details",
      "/skills/library/skill_abc123?source=local#details",
    ],
    [
      LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
      "/extensions/skills/installed/skill_abc123",
      "/skills/library/skill_abc123",
    ],
    [
      TOOLS_REGISTRY_SKILLS_ROUTE_PATH,
      "/extensions/skills/registry",
      "/skills/registry",
    ],
    [
      TOOLS_REGISTRY_SKILL_DETAIL_ROUTE_PATH,
      "/extensions/skills/registry/moss-skills%2Fmoss-notes",
      "/skills/registry/moss-skills%2Fmoss-notes",
    ],
  ])(
    "redirects %s to its canonical Skills path",
    (pattern, entry, expected) => {
      render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path={pattern} element={<LegacySkillsPathRedirect />} />
            <Route path={`${SKILLS_ROUTE_PATH}/*`} element={<LocationPath />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );
});

describe("legacy Tools redirects", () => {
  it.each([
    ["/tools", "/plugins"],
    ["/tools/plugins/browse", "/plugins"],
    [
      "/tools/plugins/github?view=installed#configuration",
      "/plugins/github?view=installed#configuration",
    ],
    [
      "/tools/skills/installed/skill_abc123?source=local#details",
      "/skills/library/skill_abc123?source=local#details",
    ],
  ])("redirects %s to %s", (entry, expected) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path={LEGACY_TOOLS_PREFIX_ROUTE_PATH}
            element={<LegacyToolsPathRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_SPLAT_ROUTE_PATH}
            element={<LegacyToolsPathRedirect />}
          />
          <Route path={`${PLUGINS_ROUTE_PATH}/*`} element={<LocationPath />} />
          <Route path={`${SKILLS_ROUTE_PATH}/*`} element={<LocationPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("leaves /tools/automations to its more-specific redirect", () => {
    render(
      <MemoryRouter initialEntries={[LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH]}>
        <Routes>
          <Route
            path={LEGACY_TOOLS_SPLAT_ROUTE_PATH}
            element={<LegacyToolsPathRedirect />}
          />
          <Route
            path={LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH}
            element={<LocationPath />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH)).toBeTruthy();
  });
});
