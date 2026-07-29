// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import {
  LegacyAutomationCollectionRedirect,
  LegacyAutomationDetailRedirect,
  LegacyAutomationPluginPanelRedirect,
} from "./App";
import {
  LEGACY_AUTOMATIONS_PLUGIN_PANEL_ROUTE_PATH,
  LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_AUTOMATIONS_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
  LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH,
} from "./lib/route-paths";

function LocationPath() {
  const location = useLocation();
  return <span>{`${location.pathname}${location.search}`}</span>;
}

function renderRedirect(path: string, pattern: string, element: ReactNode) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<LocationPath />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("legacy schedule route redirects", () => {
  afterEach(cleanup);

  it.each([
    [
      "/tools/automations",
      LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH,
      "/plugins/automations/schedules",
    ],
    [
      "/tools/automations?view=browse",
      LEGACY_TOOLS_AUTOMATIONS_ROUTE_PATH,
      "/plugins/automations/schedules/browse",
    ],
    [
      "/tools/automations/browse",
      LEGACY_TOOLS_AUTOMATION_BROWSE_ROUTE_PATH,
      "/plugins/automations/schedules/browse",
    ],
    [
      "/automations",
      LEGACY_AUTOMATIONS_ROUTE_PATH,
      "/plugins/automations/schedules",
    ],
  ])("redirects %s to %s", (from, pattern, to) => {
    renderRedirect(from, pattern, <LegacyAutomationCollectionRedirect />);
    expect(screen.getByText(to)).toBeTruthy();
  });

  it.each([
    [
      "/tools/automations/proj_1/auto_1",
      LEGACY_TOOLS_AUTOMATION_DETAIL_ROUTE_PATH,
      "/plugins/automations/schedules/proj_1/auto_1",
    ],
    [
      "/tools/automations/proj_1/auto_1/edit",
      LEGACY_TOOLS_AUTOMATION_EDIT_ROUTE_PATH,
      "/plugins/automations/schedules/proj_1/auto_1/edit",
    ],
    [
      "/automations/proj_1/auto_1",
      LEGACY_AUTOMATION_DETAIL_ROUTE_PATH,
      "/plugins/automations/schedules/proj_1/auto_1",
    ],
  ])("preserves schedule identity when redirecting %s", (from, pattern, to) => {
    renderRedirect(from, pattern, <LegacyAutomationDetailRedirect />);
    expect(screen.getByText(to)).toBeTruthy();
  });

  it("preserves the old plugin panel subpath", () => {
    renderRedirect(
      "/plugins/automations/automations/proj_1/auto_1/edit",
      LEGACY_AUTOMATIONS_PLUGIN_PANEL_ROUTE_PATH,
      <LegacyAutomationPluginPanelRedirect />,
    );
    expect(
      screen.getByText("/plugins/automations/schedules/proj_1/auto_1/edit"),
    ).toBeTruthy();
  });
});
