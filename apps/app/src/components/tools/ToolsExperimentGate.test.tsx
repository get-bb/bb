// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { defaultExperiments } from "@bb/domain";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ToolsExperimentGate } from "./ToolsExperimentGate";

const mocks = vi.hoisted(() => ({
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

function renderGate(toolsHub: boolean | undefined) {
  mocks.useSystemConfig.mockReturnValue({
    data:
      toolsHub === undefined
        ? undefined
        : {
            experiments: { ...defaultExperiments, toolsHub },
          },
  });

  render(
    <MemoryRouter initialEntries={["/tools/skills"]}>
      <Routes>
        <Route path="/" element={<div>Compose</div>} />
        <Route element={<ToolsExperimentGate />}>
          <Route path="/tools/skills" element={<div>Tools Hub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("ToolsExperimentGate", () => {
  beforeEach(() => {
    mocks.useSystemConfig.mockReset();
  });

  afterEach(cleanup);

  it("renders Tools routes when the experiment is enabled", () => {
    renderGate(true);

    expect(screen.getByText("Tools Hub")).toBeTruthy();
  });

  it("redirects direct Tools routes to compose when disabled", () => {
    renderGate(false);

    expect(screen.getByText("Compose")).toBeTruthy();
    expect(screen.queryByText("Tools Hub")).toBeNull();
  });

  it("does not expose Tools routes while configuration is loading", () => {
    renderGate(undefined);

    expect(screen.queryByText("Tools Hub")).toBeNull();
    expect(screen.queryByText("Compose")).toBeNull();
  });
});
