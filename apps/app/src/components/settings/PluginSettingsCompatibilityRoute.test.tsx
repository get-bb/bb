// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { defaultExperiments } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PluginSettingsCompatibilityRoute } from "./PluginSettingsCompatibilityRoute";

const mocks = vi.hoisted(() => ({
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

function renderRoute(path: string, toolsHub: boolean | undefined) {
  mocks.useSystemConfig.mockReturnValue({
    data:
      toolsHub === undefined
        ? undefined
        : {
            experiments: { ...defaultExperiments, toolsHub },
          },
  });

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
  beforeEach(() => {
    mocks.useSystemConfig.mockReset();
  });

  afterEach(cleanup);

  it("keeps the existing Settings manager available while Tools Hub is off", () => {
    renderRoute("/settings/plugins", false);

    expect(screen.getByText("Settings plugin manager")).toBeTruthy();
    expect(screen.queryByText("Tools plugins")).toBeNull();
  });

  it("keeps existing Settings plugin detail routes available while Tools Hub is off", () => {
    renderRoute("/settings/plugins/example", false);

    expect(screen.getByText("Settings plugin detail")).toBeTruthy();
    expect(screen.queryByText("Tools plugin detail")).toBeNull();
  });

  it("redirects legacy Settings plugin routes to Tools Hub when enabled", () => {
    renderRoute("/settings/plugins/example", true);

    expect(screen.getByText("Tools plugin detail")).toBeTruthy();
    expect(screen.queryByText("Settings plugin detail")).toBeNull();
  });

  it("renders neither management surface while configuration is loading", () => {
    renderRoute("/settings/plugins", undefined);

    expect(screen.queryByText("Settings plugin manager")).toBeNull();
    expect(screen.queryByText("Tools plugins")).toBeNull();
  });
});
