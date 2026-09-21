// @vitest-environment jsdom

import { Suspense, useEffect, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { createStore, Provider } from "jotai";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { AppRoutes } from "../App";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneContent } from "@/lib/split-layout";
import SplitWorkspaceRoute from "./SplitWorkspaceRoute";

const workspaceLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("./thread-detail/SplitThreadArea", () => ({
  SplitThreadArea: ({ routeContent }: { routeContent: PaneContent }) => {
    useEffect(() => {
      workspaceLifecycle.mounts += 1;
      return () => {
        workspaceLifecycle.unmounts += 1;
      };
    }, []);
    return <output data-testid="route-content">{routeContent.kind}</output>;
  },
}));

vi.mock("./RootComposeView", () => ({
  LegacyProjectComposeRedirect: () => <div>legacy redirect</div>,
}));

vi.mock("./ToolsView", () => ({
  PluginsView: ({ pluginId }: { pluginId?: string }) => (
    <output data-testid="tools-view">{pluginId ?? "overview"}</output>
  ),
  SkillsView: function SkillsView() {
    const { skillId, registrySkillId } = useParams();
    return (
      <output data-testid="skill-detail">
        {skillId ?? registrySkillId ?? "collection"}
      </output>
    );
  },
}));

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

afterEach(cleanup);

describe("SplitWorkspaceRoute", () => {
  beforeEach(() => {
    workspaceLifecycle.mounts = 0;
    workspaceLifecycle.unmounts = 0;
  });

  it.each([
    ["/skills/library/local-skill", "local-skill", false],
    ["/skills/registry/owner%2Fskill", "owner/skill", true],
  ])(
    "keeps standalone detail parameters at %s",
    async (path, skillId, hasPane) => {
      const store = createStore();
      store.set(
        splitLayoutAtom,
        hasPane
          ? {
              root: {
                type: "pane",
                paneId: "pane-1",
                content: { kind: "new-thread" },
              },
              focusedPaneId: "pane-1",
            }
          : null,
      );
      render(
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </Provider>,
      );
      expect((await screen.findByTestId("skill-detail")).textContent).toBe(
        skillId,
      );
    },
  );

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

  it("passes the plugin id from the full-window detail URL to PluginsView", async () => {
    render(
      <MemoryRouter initialEntries={["/plugins/github"]}>
        <Routes>
          <Route
            path="*"
            element={
              <Suspense fallback={null}>
                <SplitWorkspaceRoute />
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
