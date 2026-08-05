// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { BreadcrumbNavigation } from "./Automations.stories";

afterEach(cleanup);

describe("Automations stories", () => {
  it("uses the preview router for breadcrumb navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <BreadcrumbNavigation />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("/plugins/automations/automations/browse"),
    ).toBeDefined();
  });
});
