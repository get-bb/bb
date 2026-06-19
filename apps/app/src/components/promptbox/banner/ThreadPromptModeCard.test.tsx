// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

afterEach(() => {
  cleanup();
});

describe("ThreadPromptModeCard", () => {
  it("shows the creating-plan state for active plan mode", () => {
    render(
      <ThreadPromptModeCard
        activePromptMode={{ mode: "plan", providerId: "claude-code" }}
      />,
    );

    expect(screen.getByLabelText("Prompt mode").textContent).toContain(
      "Creating plan",
    );
  });

  it("hides when there is no active prompt mode", () => {
    const { container } = render(
      <ThreadPromptModeCard activePromptMode={null} />,
    );

    expect(container.textContent).toBe("");
  });
});
