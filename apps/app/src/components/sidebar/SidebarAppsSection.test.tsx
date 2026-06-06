// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AppSummary } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarAppsSection } from "./SidebarAppsSection";

const APPS: AppSummary[] = [
  {
    applicationId: "alpha",
    name: "Alpha",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data"],
    icon: { kind: "builtin", name: "GridView" },
    source: null,
  },
  {
    applicationId: "beta",
    name: "Beta",
    entry: { path: "index.html", kind: "html" },
    capabilities: ["data"],
    icon: { kind: "builtin", name: "GridView" },
    source: null,
  },
];

function LocationDisplay() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderSection(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SidebarAppsSection apps={APPS} />
      <LocationDisplay />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("SidebarAppsSection", () => {
  it("navigates to the standalone app route and stays enabled without a thread", () => {
    // Root compose screen — no thread/project selected.
    renderSection("/");

    const row = screen.getByRole("button", { name: "Open Alpha app" });
    // The row is no longer gated on a selected thread.
    expect((row as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(row);

    expect(screen.getByTestId("location").textContent).toBe("/apps/alpha");
  });

  it("marks the row for the active app route as current", () => {
    renderSection("/apps/beta");

    const activeRow = screen.getByRole("button", { name: "Open Beta app" });
    const inactiveRow = screen.getByRole("button", { name: "Open Alpha app" });

    expect(activeRow.getAttribute("aria-current")).toBe("page");
    expect(inactiveRow.getAttribute("aria-current")).toBeNull();
  });
});
