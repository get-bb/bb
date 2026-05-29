// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationCollapseToggle } from "./ConversationCollapseToggle";

afterEach(() => {
  cleanup();
});

describe("ConversationCollapseToggle", () => {
  it("labels itself as a collapse control and reports the conversation expanded", () => {
    render(<ConversationCollapseToggle collapsed={false} onToggle={vi.fn()} />);

    const button = screen.getByRole("button", {
      name: "Collapse conversation",
    });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("flips to an expand control reporting the conversation collapsed", () => {
    render(<ConversationCollapseToggle collapsed onToggle={vi.fn()} />);

    const button = screen.getByRole("button", { name: "Show conversation" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("invokes onToggle when activated", () => {
    const onToggle = vi.fn();
    render(
      <ConversationCollapseToggle collapsed={false} onToggle={onToggle} />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse conversation" }),
    );

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
