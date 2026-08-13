// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

describe("ThreadEnvironmentSummary", () => {
  it("uses a host-free environment label in compact prompt boxes", () => {
    render(
      <ThreadEnvironmentSummary
        environmentLabel="Mac Studio · New worktree"
        environmentCompactLabel="Worktree"
      />,
    );

    expect(
      document.querySelector('[data-promptbox-full-label=""]')?.textContent,
    ).toBe("Mac Studio · New worktree");
    expect(
      document.querySelector('[data-promptbox-compact-label=""]')?.textContent,
    ).toBe("Worktree");
  });

  it("updates the active workspace directory and full-path tooltip", () => {
    const { container, rerender } = render(
      <ThreadEnvironmentSummary
        projectName="project-a"
        projectRootPath="/path/to/project-a"
        environmentPath="/path/to/project-b"
        environmentLabel="Working locally"
      />,
    );

    const projectLabel = container.querySelector(
      '[data-option-display][title="/path/to/project-b"]',
    );
    expect(
      projectLabel?.querySelector("[data-promptbox-full-label]")?.textContent,
    ).toBe("project-a / project-b");

    rerender(
      <ThreadEnvironmentSummary
        projectName="project-a"
        projectRootPath="/path/to/project-a"
        environmentPath="/other/project-c"
        environmentLabel="Working locally"
      />,
    );

    const updatedProjectLabel = container.querySelector(
      '[data-option-display][title="/other/project-c"]',
    );
    expect(
      updatedProjectLabel?.querySelector("[data-promptbox-full-label]")
        ?.textContent,
    ).toBe("project-a / project-c");
  });

  it("keeps only the project name at the project root", () => {
    const { container } = render(
      <ThreadEnvironmentSummary
        projectName="project-a"
        projectRootPath="/path/to/project-a/"
        environmentPath="/path/to/project-a"
        environmentLabel="Working locally"
      />,
    );

    expect(
      container.querySelector("[data-promptbox-full-label]")?.textContent,
    ).toBe("project-a");
  });

  it("explains the create-thread action in a tooltip", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Worktree"
          onCreateNewThreadInWorktree={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.focus(
      screen.getByRole("button", {
        name: "Create new thread in this worktree",
      }),
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create new thread in this worktree",
    );
  });
});
