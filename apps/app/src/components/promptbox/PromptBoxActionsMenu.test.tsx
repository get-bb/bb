// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PromptBoxActionsMenu,
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
];

async function openPromptActionsMenu() {
  const trigger = screen.getByRole("button", { name: "Prompt actions" });
  fireEvent.pointerDown(trigger, { button: 0 });
  return screen.findByRole("menuitem", { name: "Skills" });
}

describe("PromptBoxActionsMenu", () => {
  it("does not render when no prompt actions are provided", () => {
    render(<PromptBoxActionsMenu onAction={() => {}} />);

    expect(
      screen.queryByRole("button", { name: "Prompt actions" }),
    ).toBeNull();
  });

  it("renders only Skills, Plan, and Goal rows in compact order", async () => {
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
    ]);
    expect(screen.queryByRole("menuitem", { name: "Apps" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Create App" })).toBeNull();
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
});
