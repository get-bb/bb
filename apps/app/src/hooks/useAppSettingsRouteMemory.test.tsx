// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { useAppSettingsRouteMemory } from "./useAppSettingsRouteMemory";

function RouteMemoryTestSurface() {
  const location = useLocation();
  const { appRoutePath, settingsRoutePath } = useAppSettingsRouteMemory();

  return (
    <>
      <div data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </div>
      <Link to={appRoutePath}>App</Link>
      <Link to={settingsRoutePath}>Settings</Link>
      <Link to="/settings/providers/codex?tab=models#preferred">
        Codex settings
      </Link>
    </>
  );
}

describe("useAppSettingsRouteMemory", () => {
  afterEach(cleanup);

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
});
