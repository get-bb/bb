// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { Usage } from "./UsageLimitsSettingsSection.stories";

afterEach(cleanup);

describe("settings/Settings Page/Usage story", () => {
  it("renders the usage state gallery", () => {
    render(
      <TooltipProvider>
        <Usage />
      </TooltipProvider>,
    );

    expect(screen.getByText("complete usage")).toBeDefined();
    expect(screen.getAllByText("Fable").length).toBeGreaterThan(0);
    expect(screen.getByText("authentication")).toBeDefined();
    expect(screen.getByText("provider responses")).toBeDefined();
    expect(screen.getByText("loading")).toBeDefined();
    expect(screen.getByText("refreshing")).toBeDefined();
    expect(screen.getByText("unavailable")).toBeDefined();
    expect(screen.getByText("request failed")).toBeDefined();
    expect(screen.getByText("multiple machines")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Usage limits machine" }),
    ).toBeDefined();

    const providerHeadingIds = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"));
    expect(new Set(providerHeadingIds).size).toBe(providerHeadingIds.length);
  });
});
