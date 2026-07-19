// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadGoalCard } from "./ThreadGoalCard";

const goal = {
  sourceSeq: 1,
  updatedAt: 100,
  objective: "Finish the activity model",
  status: "active" as const,
  tokenBudget: null,
  tokensUsed: 100,
  timeUsedSeconds: 10,
};

afterEach(cleanup);

describe("ThreadGoalCard", () => {
  it("requests a provider clear from its X action", () => {
    const onClearGoal = vi.fn();
    render(
      <ThreadGoalCard
        goal={goal}
        isExpanded={false}
        onClearGoal={onClearGoal}
        onToggle={() => {}}
      />,
    );

    const clear = screen.getByRole("button", { name: "Clear active Goal" });
    const controls = screen.getByRole("group", { name: "Goal controls" });
    expect(controls.classList.contains("bg-background/70")).toBe(true);
    expect(clear.parentElement).toBe(controls);
    expect(clear.classList.contains("border-l")).toBe(true);
    expect(clear.classList.contains("border-border/35")).toBe(true);
    expect(clear.classList.contains("min-h-8")).toBe(true);
    expect(clear.classList.contains("w-8")).toBe(true);
    expect(clear.classList.contains("rounded-none")).toBe(true);
    expect(clear.classList.contains("bg-transparent")).toBe(true);
    expect(clear.classList.contains("hover:bg-state-hover")).toBe(false);
    fireEvent.click(clear);
    expect(onClearGoal).toHaveBeenCalledOnce();
  });

  it("stays visible and disables repeated clear requests while pending", () => {
    render(
      <ThreadGoalCard
        goal={goal}
        isClearPending
        isExpanded={false}
        onClearGoal={() => {}}
        onToggle={() => {}}
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Clear active Goal" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Clear active Goal" })
        .classList.contains("disabled:opacity-60"),
    ).toBe(false);
    expect(screen.getByText("Goal")).not.toBeNull();
  });
});
