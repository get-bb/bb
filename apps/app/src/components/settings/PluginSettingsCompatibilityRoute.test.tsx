// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PluginSettingsCompatibilityRoute } from "./PluginSettingsCompatibilityRoute";

function ToolsPluginsLocation() {
  const location = useLocation();
  return (
    <div>
      Tools plugins
      <output data-testid="tools-plugins-location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
    </div>
  );
}

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/settings/plugins"
          element={
            <PluginSettingsCompatibilityRoute>
              <div>Settings plugin manager</div>
            </PluginSettingsCompatibilityRoute>
          }
        />
        <Route
          path="/settings/plugins/:pluginId"
          element={
            <PluginSettingsCompatibilityRoute>
              <div>Settings plugin detail</div>
            </PluginSettingsCompatibilityRoute>
          }
        />
        <Route path="/extensions/plugins" element={<ToolsPluginsLocation />} />
        <Route
          path="/extensions/plugins/:pluginId"
          element={<ToolsPluginsLocation />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PluginSettingsCompatibilityRoute", () => {
  afterEach(cleanup);

  it("renders per-plugin settings pages in place — Settings owns them now", () => {
    renderRoute("/settings/plugins/example");

    expect(screen.getByText("Settings plugin detail")).toBeTruthy();
    expect(screen.queryByText("Tools plugins")).toBeNull();
  });

  it.each(["/settings/plugins", "/settings/plugins/"])(
    "moves legacy plugin management at %s to Extensions",
    (path) => {
      renderRoute(path);

      expect(screen.getByText("Tools plugins")).toBeTruthy();
      expect(screen.getByTestId("tools-plugins-location").textContent).toBe(
        "/extensions/plugins?view=installed",
      );
      expect(screen.queryByText("Settings plugin manager")).toBeNull();
    },
  );
});
