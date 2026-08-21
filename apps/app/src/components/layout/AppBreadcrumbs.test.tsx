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
});
