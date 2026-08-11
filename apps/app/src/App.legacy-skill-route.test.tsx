// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  ExtensionsLandingRedirect,
  LegacyPluginBrowseRedirect,
  LegacySkillDetailRedirect,
} from "./App";
import {
  LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH,
  TOOLS_PLUGIN_BROWSE_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  TOOLS_ROUTE_PATH,
  TOOLS_SKILL_DETAIL_ROUTE_PATH,
} from "./lib/route-paths";

function LocationPath() {
  const location = useLocation();
  return (
    <span>
      {location.pathname}
      {location.search}
    </span>
  );
}

describe("LegacySkillDetailRedirect", () => {
  afterEach(cleanup);

  it("preserves old installed links while Library remains canonical", () => {
    render(
      <MemoryRouter initialEntries={["/tools/skills/installed/skill_abc123"]}>
        <Routes>
          <Route
            path={LEGACY_TOOLS_SKILL_DETAIL_ROUTE_PATH}
            element={<LegacySkillDetailRedirect />}
          />
          <Route
            path={TOOLS_SKILL_DETAIL_ROUTE_PATH}
            element={<LocationPath />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("/tools/skills/library/skill_abc123")).toBeTruthy();
  });
});

describe("ExtensionsLandingRedirect", () => {
  afterEach(cleanup);

  it("opens Extensions on Plugins by default", () => {
    render(
      <MemoryRouter initialEntries={[TOOLS_ROUTE_PATH]}>
        <Routes>
          <Route
            path={TOOLS_ROUTE_PATH}
            element={<ExtensionsLandingRedirect />}
          />
          <Route path={TOOLS_PLUGINS_ROUTE_PATH} element={<LocationPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(TOOLS_PLUGINS_ROUTE_PATH)).toBeTruthy();
  });
});

describe("LegacyPluginBrowseRedirect", () => {
  afterEach(cleanup);

  it("redirects the old Browse path to the canonical bare Plugins route", () => {
    render(
      <MemoryRouter initialEntries={[TOOLS_PLUGIN_BROWSE_ROUTE_PATH]}>
        <Routes>
          <Route
            path={TOOLS_PLUGIN_BROWSE_ROUTE_PATH}
            element={<LegacyPluginBrowseRedirect />}
          />
          <Route path={TOOLS_PLUGINS_ROUTE_PATH} element={<LocationPath />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(TOOLS_PLUGINS_ROUTE_PATH)).toBeTruthy();
  });
});
