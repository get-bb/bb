// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

describe("ThreadEnvironmentSummary", () => {
  it("renders a project control even without an environment", () => {
    render(
      <ThreadEnvironmentSummary
        projectControl={<button type="button">Project</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy();
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
