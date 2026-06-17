// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineSelectionMenu } from "./TimelineSelectionMenu";
import type { MessageProseSelection } from "./SelectableMessageProse";

afterEach(cleanup);

function makeSelection(): MessageProseSelection {
  return {
    text: "selected text",
    rect: new DOMRect(10, 10, 100, 20),
  };
}

describe("TimelineSelectionMenu", () => {
  it("renders only the actions with handlers", () => {
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onAddToChat={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Add to chat" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reply in side chat" }),
    ).toBeNull();
  });

  it("does not mount when no action handlers are supplied", () => {
    render(
      <TimelineSelectionMenu selection={makeSelection()} onDismiss={vi.fn()} />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });
});
