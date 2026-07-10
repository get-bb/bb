// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

afterEach(() => {
  cleanup();
});

describe("ThreadPromptModeCard", () => {
  it("shows the plan prompt only when expanded", () => {
    const { rerender } = render(
      <ThreadPromptModeCard
        activePromptMode={{
          mode: "plan",
          providerId: "claude-code",
          prompt: "inspect the failing command",
        }}
        isExpanded
        onExitPlanMode={() => {}}
        onToggle={() => {}}
      />,
    );

    expect(screen.getByLabelText("Prompt mode").textContent).toContain("Plan");
    expect(screen.getByLabelText("Prompt mode").textContent).toContain(
      "inspect the failing command",
    );

    rerender(
      <ThreadPromptModeCard
        activePromptMode={{
          mode: "plan",
          providerId: "claude-code",
          prompt: "inspect the failing command",
        }}
        isExpanded={false}
        onExitPlanMode={() => {}}
        onToggle={() => {}}
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
