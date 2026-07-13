// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptBoxActionsMenu } from "./PromptBoxActionsMenu";

afterEach(cleanup);

describe("PromptBoxActionsMenu", () => {
  it("does not render when no prompt actions are provided", () => {
    render(<PromptBoxActionsMenu onAction={() => {}} />);

    expect(screen.queryByRole("button", { name: "Prompt actions" })).toBeNull();
  });

  it("offers file attachments even when no provider actions are available", async () => {
    const onAttach = vi.fn();
    render(<PromptBoxActionsMenu onAction={() => {}} onAttach={onAttach} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Prompt actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Attach files" }),
    );

    expect(onAttach).toHaveBeenCalledOnce();
  });

  it("keeps attachment upload progress visible on the menu trigger", () => {
    render(
      <PromptBoxActionsMenu
        isAttaching
        onAction={() => {}}
        onAttach={() => {}}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Prompt actions" });
    expect(trigger.querySelector('[data-icon="Spinner"]')).not.toBeNull();
  });
});
