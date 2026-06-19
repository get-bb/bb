// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

afterEach(() => {
  cleanup();
});

describe("ThreadPromptModeCard", () => {
  it("toggles plan mode and shows the prompt only when expanded", () => {
    const onToggle = vi.fn();
    const onExitPlanMode = vi.fn();
    const { rerender } = render(
      <ThreadPromptModeCard
        activePromptMode={{
          mode: "plan",
          providerId: "claude-code",
          prompt: "inspect the failing command",
        }}
        isExpanded
        onExitPlanMode={onExitPlanMode}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByLabelText("Prompt mode").textContent).toContain(
      "Plan",
    );
    expect(screen.getByLabelText("Prompt mode").textContent).toContain(
      "inspect the failing command",
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit plan mode" }));
    expect(onExitPlanMode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ThreadPromptModeCard
        activePromptMode={{
          mode: "plan",
          providerId: "claude-code",
          prompt: "inspect the failing command",
        }}
        isExpanded={false}
        onExitPlanMode={onExitPlanMode}
        onToggle={onToggle}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Plan" }).textContent,
    ).not.toContain("inspect the failing command");
  });

  it("hides when there is no active prompt mode", () => {
    const { container } = render(
      <ThreadPromptModeCard
        activePromptMode={null}
        isExpanded={false}
        onToggle={() => {}}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
