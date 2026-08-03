// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppBreadcrumbs } from "./AppBreadcrumbs";

afterEach(cleanup);

function LocationProbe() {
  return (
    <output aria-label="Current location">{useLocation().pathname}</output>
  );
}

describe("AppBreadcrumbs", () => {
  it("navigates through ancestors while keeping the resource passive", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/plugins/automations/automations/proj_personal/weekly-review",
        ]}
      >
        <AppBreadcrumbs
          breadcrumbs={[
            {
              label: "Automations",
              to: "/plugins/automations/automations",
            },
            {
              label: "Installed",
              to: "/plugins/automations/automations",
            },
            { label: "Weekly review" },
          ]}
          usesDesktopChrome={false}
        />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByText("Weekly review").getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.queryByRole("link", { name: "Weekly review" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Installed" }));
    expect(screen.getByLabelText("Current location").textContent).toBe(
      "/plugins/automations/automations",
    );
  });

  it("keeps ancestors fixed and truncates only the current crumb in narrow layouts", () => {
    render(
      <MemoryRouter>
        <div className="w-48 overflow-hidden">
          <AppBreadcrumbs
            breadcrumbs={[
              {
                label: "Automations",
                to: "/plugins/automations/automations",
              },
              {
                label: "Installed",
                to: "/plugins/automations/automations",
              },
              {
                label:
                  "A very long automation name that must fit a narrow header",
              },
            ]}
            usesDesktopChrome
          />
        </div>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole("navigation", { name: "Breadcrumb" });
    const current = screen.getByText(
      "A very long automation name that must fit a narrow header",
    );

    expect(navigation.className).toContain("min-w-0");
    expect(navigation.querySelector("ol")?.className).toContain("min-w-0");
    expect(
      screen.getByRole("link", { name: "Automations" }).className,
    ).toContain("shrink-0");
    expect(current.className).toContain("min-w-0");
    expect(current.className).toContain("truncate");
  });
});
