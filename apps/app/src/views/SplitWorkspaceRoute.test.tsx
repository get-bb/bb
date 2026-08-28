// @vitest-environment jsdom

import { Suspense, useEffect } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as splitThreadAreaModule from "./thread-detail/SplitThreadArea";
import * as rootComposeViewModule from "./RootComposeView";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

function TestToolsView({ pluginId }: { pluginId?: string }) {
  return <output data-testid="tools-view">{pluginId ?? "overview"}</output>;
}

const workspaceLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.spyOn(splitThreadAreaModule, "SplitThreadArea").mockImplementation(
  ({ routeContent } = {}) => {
    useEffect(() => {
      workspaceLifecycle.mounts += 1;
      return () => {
        workspaceLifecycle.unmounts += 1;
      };
    }, []);
    return (
      <output data-testid="route-content">
        {routeContent?.kind ?? "new-thread"}
      </output>
    );
  },
);

vi.spyOn(
  rootComposeViewModule,
  "LegacyProjectComposeRedirect",
).mockImplementation(() => <div>legacy redirect</div>);

function NavigationControls() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/")}>compose</button>
      <button onClick={() => navigate("/plugins/docs/docs/work/today.md")}>
        plugin
      </button>
      <button onClick={() => navigate("/threads/thread-1")}>thread</button>
    </>
  );
}

describe("SplitWorkspaceRoute", () => {
  beforeEach(() => {
    workspaceLifecycle.mounts = 0;
    workspaceLifecycle.unmounts = 0;
  });

  it("preserves the workspace mount across focus-driven page URL changes", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <NavigationControls />
        <Routes>
          <Route path="*" element={<SplitWorkspaceRoute />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("route-content").textContent).toBe("new-thread");

    fireEvent.click(screen.getByRole("button", { name: "plugin" }));
    expect(screen.getByTestId("route-content").textContent).toBe(
      "plugin-panel",
    );

    fireEvent.click(screen.getByRole("button", { name: "thread" }));
    expect(screen.getByTestId("route-content").textContent).toBe("thread");
    expect(workspaceLifecycle).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("passes the plugin id from the full-window detail URL to ToolsView", async () => {
    render(
      <MemoryRouter initialEntries={["/extensions/plugins/github"]}>
        <Routes>
          <Route
            path="*"
            element={
              <Suspense fallback={null}>
                <SplitWorkspaceRoute
                  dependencies={{ ToolsView: TestToolsView }}
                />
              </Suspense>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findByTestId("tools-view")).textContent).toBe(
      "github",
    );
  });
});
