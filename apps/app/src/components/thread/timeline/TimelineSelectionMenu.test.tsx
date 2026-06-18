// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineSelectionMenu } from "./TimelineSelectionMenu";
import type { MessageProseSelection } from "./SelectableMessageProse";

afterEach(cleanup);

function makeSelection(): MessageProseSelection {
  return {
    text: "selected text",
    rect: new DOMRect(10, 10, 100, 20),
    sourceSeqEnd: 12,
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

  it("passes the selection branch point to side-chat replies", () => {
    const onReplyInSideChat = vi.fn();
    render(
      <TimelineSelectionMenu
        selection={makeSelection()}
        onDismiss={vi.fn()}
        onReplyInSideChat={onReplyInSideChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply in side chat" }));

    expect(onReplyInSideChat).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "selected text",
        sourceSeqEnd: 12,
      }),
    );
  });
});
