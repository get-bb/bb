// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CREATE_LOOP_PROMPT,
  PromptBoxActionsMenu,
  withLoopPromptAction,
  type PromptBoxAction,
} from "./PromptBoxActionsMenu";

afterEach(cleanup);

const promptActions: readonly PromptBoxAction[] = [
  {
    kind: "goal",
    command: { trigger: "/", name: "goal", trailingText: " " },
    text: "/goal ",
  },
  { kind: "skills", text: "/" },
  {
    kind: "plan",
    command: { trigger: "/", name: "plan", trailingText: " " },
    text: "/plan ",
  },
  { kind: "loop", text: CREATE_LOOP_PROMPT },
];

async function openPromptActionsMenu() {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  return screen.findByRole("menuitem", { name: "Skills" });
}

describe("PromptBoxActionsMenu", () => {
  it("appends the Loop action to provider actions", () => {
    expect(withLoopPromptAction([])).toEqual([
      { kind: "loop", text: CREATE_LOOP_PROMPT },
    ]);
    expect(withLoopPromptAction(promptActions)).toEqual(promptActions);
  });

  it("does not render when no prompt actions are provided", () => {
    render(<PromptBoxActionsMenu onAction={() => {}} />);

    expect(
      screen.queryByRole("button", { name: "Prompt actions" }),
    ).toBeNull();
  });

  it("renders Skills, Plan, Goal, and Loop rows in compact order", async () => {
    render(
      <PromptBoxActionsMenu actions={promptActions} onAction={() => {}} />,
    );

    expect(
      screen
        .getByRole("button", { name: "Prompt actions" })
        .querySelector('[data-icon="Plus"]'),
    ).not.toBeNull();

    await openPromptActionsMenu();

    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Skills",
      "Plan",
      "Goal",
      "Loop",
    ]);
    expect(screen.queryByRole("menuitem", { name: "Apps" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Create App" })).toBeNull();
  });

  it("opens below the plus trigger aligned to the trigger start", async () => {
    render(
      <PromptBoxActionsMenu actions={promptActions} onAction={() => {}} />,
    );

    await openPromptActionsMenu();

    const menu = screen.getByRole("menu", { name: "Prompt actions" });
    expect(menu.getAttribute("data-side")).toBe("bottom");
    expect(menu.getAttribute("data-align")).toBe("start");
  });

  it("fires the selected action", async () => {
    const onAction = vi.fn();
    render(<PromptBoxActionsMenu actions={promptActions} onAction={onAction} />);

    await openPromptActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan" }));

    expect(onAction).toHaveBeenCalledWith({
      kind: "plan",
      command: { trigger: "/", name: "plan", trailingText: " " },
      text: "/plan ",
    });
  });

  it("fires the Loop action", async () => {
    const onAction = vi.fn();
    render(<PromptBoxActionsMenu actions={promptActions} onAction={onAction} />);

    await openPromptActionsMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Loop" }));

    expect(onAction).toHaveBeenCalledWith({
      kind: "loop",
      text: CREATE_LOOP_PROMPT,
    });
  });
});
