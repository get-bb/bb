// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { PluginSettingsCompatibilityRoute } from "./PluginSettingsCompatibilityRoute";

function PluginsLocation() {
  const location = useLocation();
  return (
    <div>
      Plugins
      <output data-testid="plugins-location">
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
        <Route path="/plugins" element={<PluginsLocation />} />
        <Route path="/plugins/:pluginId" element={<PluginsLocation />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PluginSettingsCompatibilityRoute", () => {
  afterEach(cleanup);

  it("renders per-plugin settings pages in place", () => {
    renderRoute("/settings/plugins/example");

    expect(screen.getByText("Settings plugin detail")).toBeTruthy();
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it.each(["/settings/plugins", "/settings/plugins/"])(
    "moves legacy plugin management at %s to Plugins",
    (path) => {
      renderRoute(path);

      expect(screen.getByText("Plugins")).toBeTruthy();
      expect(screen.getByTestId("plugins-location").textContent).toBe(
        "/plugins?view=installed",
      );
      expect(screen.queryByText("Settings plugin manager")).toBeNull();
    },
  );
});
