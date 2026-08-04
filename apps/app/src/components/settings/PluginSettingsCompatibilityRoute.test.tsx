// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PluginSettingsCompatibilityRoute } from "./PluginSettingsCompatibilityRoute";

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
        <Route path="/tools/plugins" element={<div>Tools plugins</div>} />
        <Route
          path="/tools/plugins/:pluginId"
          element={<div>Tools plugin detail</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PluginSettingsCompatibilityRoute", () => {
  afterEach(cleanup);

  it("keeps the Settings manager available", () => {
    renderRoute("/settings/plugins");

    expect(screen.getByText("Settings plugin manager")).toBeTruthy();
    expect(screen.queryByText("Tools plugins")).toBeNull();
  });

  it("keeps Settings plugin detail routes available", () => {
    renderRoute("/settings/plugins/example");

    expect(screen.getByText("Settings plugin detail")).toBeTruthy();
    expect(screen.queryByText("Tools plugin detail")).toBeNull();
  });

});
