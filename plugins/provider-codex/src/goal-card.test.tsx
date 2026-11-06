// @vitest-environment jsdom

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";
import { CodexGoalBanner } from "./goal-card.js";

const THREAD_ID = "thr_goal";

const PAUSED_GOAL = {
  objective: "Ship the release notes",
  status: "paused",
  tokenBudget: 10_000,
  tokensUsed: 1_240,
  timeUsedSeconds: 185,
};

afterEach(() => {
  cleanup();
});

function renderGoal(state: unknown) {
  return renderSlot(
    { component: CodexGoalBanner },
    {},
    {
      composer: { scope: { kind: "thread", threadId: THREAD_ID } },
      threadExtensionStates: { [THREAD_ID]: { goal: state } },
      sdk: { threads: { clearGoal: async () => ({ ok: true }) } },
    },
  );
}

describe("Codex Goal banner", () => {
  it("shows a paused Goal with its usage and clears it through bb", async () => {
    const slot = renderGoal(PAUSED_GOAL);

    const card = screen.getByRole("region", { name: "Goal" });
    expect(card.dataset.active).toBe("false");
    expect(card.textContent).toContain("Goal paused");
    expect(card.textContent).toContain("Ship the release notes");
    expect(card.textContent).toContain("1,240 / 10,000 tokens");
    expect(card.textContent).toContain("3m 5s");
    fireEvent.click(screen.getByRole("button", { name: "Clear Goal" }));

    await expect
      .poll(() => slot.inspection.sdkCalls)
      .toEqual([
        { method: "threads.clearGoal", args: [{ threadId: THREAD_ID }] },
      ]);
  });

  it("draws an active Goal in the working style", () => {
    renderGoal({ ...PAUSED_GOAL, status: "active", tokenBudget: null });

    const card = screen.getByRole("region", { name: "Goal" });
    expect(card.dataset.active).toBe("true");
    expect(card.textContent).toContain("1,240 tokens");
    expect(
      screen.getByRole("button", { name: "Clear active Goal" }),
    ).not.toBeNull();
  });

  it.each([
    ["a completed Goal", { ...PAUSED_GOAL, status: "complete" }],
    ["a budget-limited Goal", { ...PAUSED_GOAL, status: "budgetLimited" }],
    ["a cleared Goal", null],
    ["a malformed state", { status: "paused" }],
  ])("shows no card for %s", (_label, state) => {
    renderGoal(state);

    expect(screen.queryByRole("region", { name: "Goal" })).toBeNull();
  });
});
