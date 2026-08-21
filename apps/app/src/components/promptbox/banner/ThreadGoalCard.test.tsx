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
    expect(clear.parentElement).toBe(controls);
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
    expect(screen.getByText("Goal")).not.toBeNull();
  });
});
