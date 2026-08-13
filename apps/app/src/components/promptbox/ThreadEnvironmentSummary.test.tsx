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

  it("updates the active workspace directory and full-path tooltip", async () => {
    const { container, rerender } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          projectName="project-a"
          projectRootPath="/path/to/project-a"
          environmentPath="/path/to/project-b/."
          environmentLabel="Working locally"
        />
      </TooltipProvider>,
    );

    const projectLabel = container.querySelector("[data-option-display]");
    expect(
      projectLabel?.querySelector("[data-promptbox-full-label]")?.textContent,
    ).toBe("project-a / project-b");
    fireEvent.pointerMove(projectLabel?.parentElement ?? projectLabel!);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "/path/to/project-b/.",
    );

    rerender(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          projectName="project-a"
          projectRootPath="/path/to/project-a"
          environmentPath="/other/project-c"
          environmentLabel="Working locally"
        />
      </TooltipProvider>,
    );

    const updatedProjectLabel = container.querySelector(
      "[data-option-display]",
    );
    expect(
      updatedProjectLabel?.querySelector("[data-promptbox-full-label]")
        ?.textContent,
    ).toBe("project-a / project-c");
  });

  it("keeps only the project name at the project root", () => {
    const { container } = render(
      <TooltipProvider>
        <ThreadEnvironmentSummary
          projectName="project-a"
          projectRootPath="/path/to/project-a/"
          environmentPath="/path/to/project-a/child/.."
          environmentLabel="Working locally"
        />
      </TooltipProvider>,
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
