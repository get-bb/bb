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

  it("offers Clear for a paused Goal and hides a completed one", () => {
    const onClearGoal = vi.fn();
    const { rerender } = render(
      <ThreadGoalCard
        goal={{ ...goal, status: "paused" }}
        isExpanded={false}
        onClearGoal={onClearGoal}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Goal" }).textContent).toBe(
      "Goal paused",
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear Goal" }));
    expect(onClearGoal).toHaveBeenCalledOnce();

    rerender(
      <ThreadGoalCard
        goal={{ ...goal, status: "complete" }}
        isExpanded={false}
        onClearGoal={onClearGoal}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByRole("group", { name: "Goal controls" })).toBeNull();
  });
});
