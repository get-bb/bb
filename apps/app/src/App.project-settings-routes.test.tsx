// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { AppRoutes } from "./App";

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./views/ProjectDetailSettingsView", () => ({
  ProjectDetailSettingsView: () => {
    const { projectId } = useParams();
    return <h1>Project detail: {projectId}</h1>;
  },
}));
vi.mock("./views/SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

function renderRoute(path: string) {
  render(
    <MemoryRouter initialEntries={["/settings", path]} initialIndex={1}>
      <NavigationProbe />
      <AppRoutes />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("project settings routes", () => {
  it.each([
    "proj_example",
    "proj_missing",
    "proj_personal",
    "project with spaces",
  ])("opens the existing detail for legacy project %s", async (projectId) => {
    renderRoute(
      `/projects/${encodeURIComponent(projectId)}/settings?from=bookmark#checkouts`,
    );
    expect(
      await screen.findByRole("heading", {
        name: `Project detail: ${projectId}`,
      }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      `/settings/projects/${encodeURIComponent(projectId)}?from=bookmark#checkouts`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("heading", { name: "Settings" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("/settings");
  });

  it("keeps the Settings detail destination directly accessible", async () => {
    renderRoute("/settings/projects/proj_example");
    expect(
      await screen.findByRole("heading", {
        name: "Project detail: proj_example",
      }),
    ).toBeTruthy();
  });
});
