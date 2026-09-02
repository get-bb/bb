// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectSelector } from "./ProjectSelector";

describe("ProjectSelector", () => {
  it("keeps the project menu inside a short viewport and scrolls it", () => {
    render(
      <ProjectSelector
        projects={Array.from({ length: 20 }, (_, index) => ({
          id: `proj_${index}`,
          name: `Project ${index}`,
        }))}
        value="proj_0"
        onChange={() => {}}
        defaultOpen
        modal={false}
      />,
    );

    const menu = screen.getByRole("menu");
    expect(menu.className).toContain(
      "max-h-[min(var(--radix-dropdown-menu-content-available-height),calc(100dvh-0.5rem))]",
    );
    expect(menu.className).toContain("overflow-y-auto");
    expect(menu.className).toContain("overscroll-contain");
  });
});
