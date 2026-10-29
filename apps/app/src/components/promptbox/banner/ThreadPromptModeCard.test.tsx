// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { ThreadPromptModeCard } from "./ThreadPromptModeCard";

vi.mock("@/lib/mutation-errors", () => ({
  showMutationErrorToast: vi.fn(),
}));

const PLAN = {
  mode: "plan",
  providerId: "claude-code",
  prompt: "inspect the failing command",
} as const;

afterEach(() => {
  cleanup();
  vi.mocked(showMutationErrorToast).mockClear();
});

describe("ThreadPromptModeCard", () => {
  it("shows the plan prompt only after the card is expanded", () => {
    render(
      <ThreadPromptModeCard
        activePromptMode={PLAN}
        onExitPlanMode={async () => {}}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Plan" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(
      toggle.getAttribute("aria-controls") ?? "",
    );
    expect(body?.getAttribute("aria-hidden")).toBe("false");
    expect(body?.textContent).toContain("inspect the failing command");
  });

  it("hides when there is no active prompt mode", () => {
    const { container } = render(
      <ThreadPromptModeCard activePromptMode={null} />,
    );

    expect(container.textContent).toBe("");
  });

  it("keeps the exit button disabled until the exit settles", () => {
    const onExitPlanMode = vi.fn(() => new Promise<void>(() => {}));
    render(
      <ThreadPromptModeCard
        activePromptMode={PLAN}
        onExitPlanMode={onExitPlanMode}
      />,
    );

    const exit = screen.getByRole("button", { name: "Exit plan mode" });
    expect(exit.parentElement).toBe(
      screen.getByRole("group", { name: "Plan controls" }),
    );
    fireEvent.click(exit);
    fireEvent.click(exit);

    expect(exit.hasAttribute("disabled")).toBe(true);
    expect(onExitPlanMode).toHaveBeenCalledOnce();
  });

  it("toasts the failure and re-enables the exit button when exiting fails", async () => {
    const error = new Error("provider unavailable");
    render(
      <ThreadPromptModeCard
        activePromptMode={PLAN}
        onExitPlanMode={() => Promise.reject(error)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Exit plan mode" }));

    await vi.waitFor(() =>
      expect(showMutationErrorToast).toHaveBeenCalledWith({
        error,
        fallbackMessage: "Failed to exit Plan mode.",
      }),
    );
    expect(
      screen
        .getByRole("button", { name: "Exit plan mode" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
