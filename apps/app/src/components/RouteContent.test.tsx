// @vitest-environment jsdom

import { lazy, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { RouteContent } from "./RouteContent";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RouteContent", () => {
  it.each([
    "Failed to fetch dynamically imported module: /assets/settings.js",
    "Importing a module script failed.",
    "error loading dynamically imported module: /assets/settings.js",
    "Unable to preload CSS for /assets/settings.css",
  ])("contains a failed page download: %s", async (message) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const FailedPage = lazy(async () => {
      throw new TypeError(message);
    });
    render(
      <AppErrorBoundary>
        <MemoryRouter initialEntries={["/failed"]}>
          <nav>
            <Link to="/working">Working page</Link>
          </nav>
          <RouteContent>
            <Routes>
              <Route path="/failed" element={<FailedPage />} />
              <Route path="/working" element={<h1>Loaded content</h1>} />
            </Routes>
          </RouteContent>
        </MemoryRouter>
      </AppErrorBoundary>,
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Couldn't load this page.",
    );
    expect(screen.getByRole("button", { name: "Reload page" })).toBeTruthy();
    expect(screen.queryByText("bb hit an error and stopped")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "Working page" }));
    expect(
      await screen.findByRole("heading", { name: "Loaded content" }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("preserves mounted content across healthy navigation", () => {
    function Page() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    render(
      <MemoryRouter>
        <Link to="/?view=other">Change view</Link>
        <RouteContent>
          <Page />
        </RouteContent>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Count 0" }));
    fireEvent.click(screen.getByRole("link", { name: "Change view" }));
    expect(screen.getByRole("button", { name: "Count 1" })).toBeTruthy();
  });

  it("leaves ordinary render failures to the app recovery screen", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    function BrokenPage(): never {
      throw new Error("render exploded");
    }
    render(
      <AppErrorBoundary>
        <MemoryRouter>
          <RouteContent>
            <BrokenPage />
          </RouteContent>
        </MemoryRouter>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("bb hit an error and stopped")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
  });
});
