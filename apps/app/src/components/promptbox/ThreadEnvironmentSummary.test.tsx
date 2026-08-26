// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { describe, expect, it, vi } from "vitest";
import { ThreadEnvironmentSummary } from "./ThreadEnvironmentSummary";

describe("ThreadEnvironmentSummary", () => {
  it("uses a host-free environment label in compact prompt boxes", () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Mac Studio · New worktree"
          environmentCompactLabel="Worktree"
        />
      </TooltipProvider>,
    );

    expect(
      container.querySelector('[data-promptbox-full-label=""]')?.textContent,
    ).toBe("Mac Studio · New worktree");
    expect(
      container.querySelector('[data-promptbox-compact-label=""]')?.textContent,
    ).toBe("Worktree");
  });

  it("reveals the full host and mode when the environment label is constrained", async () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ThreadEnvironmentSummary
          environmentLabel="Bersabel's MacBook Pro"
          environmentCompactLabel="Bersabel's MacBook Pro"
        />
      </TooltipProvider>,
    );

    const environmentDisplay = container.querySelector<HTMLElement>(
      '[data-option-display=""]',
    );
    expect(environmentDisplay).not.toBeNull();
    expect(environmentDisplay!.className).not.toContain("max-w-[10rem]");
    fireEvent.focus(environmentDisplay!);

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Bersabel's MacBook Pro",
    );
  });

  it.each(["Local worktree", "Remote worktree", "Local", "Remote"] as const)(
    "shows the %s environment type from the environment icon",
    async (environmentTypeLabel) => {
      render(
        <TooltipProvider delayDuration={0}>
          <ThreadEnvironmentSummary
            environmentLabel="Bersabel's MacBook Pro"
            environmentCompactLabel="Bersabel's MacBook Pro"
            environmentIcon="Laptop"
            environmentTypeLabel={environmentTypeLabel}
          />
        </TooltipProvider>,
      );

      fireEvent.focus(
        screen.getByLabelText(`Environment type: ${environmentTypeLabel}`),
      );

      expect((await screen.findByRole("tooltip")).textContent).toBe(
        environmentTypeLabel,
      );
    },
  );

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
        name: "Create thread in worktree",
      }),
    );

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Create thread in worktree",
    );
  });
});
