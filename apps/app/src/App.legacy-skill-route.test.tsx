// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
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
