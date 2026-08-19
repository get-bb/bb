// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { ExperimentalUrlLink } from "./ExperimentalUrlLink";

afterEach(cleanup);

describe("ExperimentalUrlLink", () => {
  it("sends an ordinary web activation to the navigation host", () => {
    const openUrl = vi.fn(() => true);
    render(
      <MemoryRouter>
        <RouteNavigationProvider>
          <AppNavigationHostProvider capabilities={{ openUrl }}>
            <ExperimentalUrlLink href="https://example.com">
              Example
            </ExperimentalUrlLink>
          </AppNavigationHostProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Example" }));
    expect(openUrl).toHaveBeenCalledWith({ url: "https://example.com" });
  });

  it("leaves modifier clicks native", () => {
    const openUrl = vi.fn(() => true);
    render(
      <MemoryRouter>
        <AppNavigationHostProvider capabilities={{ openUrl }}>
          <ExperimentalUrlLink href="https://example.com">
            Example
          </ExperimentalUrlLink>
        </AppNavigationHostProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Example" }), {
      metaKey: true,
    });
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("routes internal links through browser history before URL preferences", () => {
    const openUrl = vi.fn(() => true);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RouteNavigationProvider>
          <AppNavigationHostProvider capabilities={{ openUrl }}>
            <ExperimentalUrlLink href="/settings">Settings</ExperimentalUrlLink>
            <Routes>
              <Route path="/settings" element={<div>Settings route</div>} />
            </Routes>
          </AppNavigationHostProvider>
        </RouteNavigationProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.getByText("Settings route")).toBeTruthy();
    expect(openUrl).not.toHaveBeenCalled();
  });
});
