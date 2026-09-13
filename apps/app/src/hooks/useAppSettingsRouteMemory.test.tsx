// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { useAppSettingsRouteMemory } from "./useAppSettingsRouteMemory";

function RouteMemoryTestSurface() {
  const location = useLocation();
  const { appRoutePath, settingsRoutePath, toolsBackRoutePath } =
    useAppSettingsRouteMemory();

  return (
    <>
      <div data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </div>
      <Link to={appRoutePath}>App</Link>
      <Link to={settingsRoutePath}>Settings</Link>
      <Link to="/plugins">Tools</Link>
      <Link to={toolsBackRoutePath}>Tools back</Link>
      <Link to="/plugins/ui-patterns?tab=settings#source">Plugin detail</Link>
      <Link to="/settings/providers/codex?tab=models#preferred">
        Codex settings
      </Link>
      <Link to="/projects/proj_one/settings">Legacy project settings</Link>
      <Link to="/settings/projects/proj_one">Project detail</Link>
      <Link to="/settings/plugins">Legacy plugin collection</Link>
      <Link to="/settings/plugins/ui-patterns">Legacy plugin detail</Link>
    </>
  );
}

describe("useAppSettingsRouteMemory", () => {
  afterEach(cleanup);

  it.each(["/projects/proj_one/settings", "/settings/projects/proj_one"])(
    "uses a safe app destination when opening %s directly",
    (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <RouteMemoryTestSurface />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole("link", { name: "App" }));
      expect(screen.getByTestId("location").textContent).toBe("/");
    },
  );

  it("preserves the previous app route across a legacy project settings redirect", () => {
    render(
      <MemoryRouter initialEntries={["/threads/thr_one"]}>
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("link", { name: "Legacy project settings" }),
    );
    fireEvent.click(screen.getByRole("link", { name: "Project detail" }));
    fireEvent.click(screen.getByRole("link", { name: "App" }));
    expect(screen.getByTestId("location").textContent).toBe("/threads/thr_one");
  });

  it("switches between the most recent app and settings routes", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/proj_one/threads/thr_one?message=12#event-12",
        ]}
      >
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("location").textContent).toBe("/settings");

    fireEvent.click(screen.getByRole("link", { name: "Codex settings" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/providers/codex?tab=models#preferred",
    );

    fireEvent.click(screen.getByRole("link", { name: "App" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_one/threads/thr_one?message=12#event-12",
    );

    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/providers/codex?tab=models#preferred",
    );
  });

  it("resets Plugins after Back to app returns to core app context", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/proj_one/threads/thr_one?message=12#event-12",
        ]}
      >
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Tools" }));
    expect(screen.getByTestId("location").textContent).toBe("/plugins");

    fireEvent.click(screen.getByRole("link", { name: "Plugin detail" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/plugins/ui-patterns?tab=settings#source",
    );

    fireEvent.click(screen.getByRole("link", { name: "Tools back" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_one/threads/thr_one?message=12#event-12",
    );

    fireEvent.click(screen.getByRole("link", { name: "Tools" }));
    expect(screen.getByTestId("location").textContent).toBe("/plugins");
  });

  it("remembers installed plugin management as Settings and preserves the app destination", () => {
    render(
      <MemoryRouter initialEntries={["/projects/proj_one/threads/thr_one"]}>
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("link", { name: "Legacy plugin collection" }),
    );
    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
    ).toBe("/settings/plugins");
    fireEvent.click(screen.getByRole("link", { name: "App" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/projects/proj_one/threads/thr_one",
    );
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/plugins",
    );
  });

  it("uses safe defaults when opened directly at the installed plugins list", () => {
    render(
      <MemoryRouter initialEntries={["/settings/plugins"]}>
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "App" }).getAttribute("href")).toBe(
      "/",
    );
    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
    ).toBe("/settings/plugins");
    expect(
      screen.getByRole("link", { name: "Tools back" }).getAttribute("href"),
    ).toBe("/settings/plugins");
  });

  it.each([
    "/settings/plugins/ui-patterns",
    "/settings/plugins/ui-patterns?view=installed#source",
  ])("remembers %s as a Settings route", (path) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <RouteMemoryTestSurface />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Settings" }).getAttribute("href"),
    ).toBe(path);

    fireEvent.click(screen.getByRole("link", { name: "App" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByTestId("location").textContent).toBe(path);
  });
});
