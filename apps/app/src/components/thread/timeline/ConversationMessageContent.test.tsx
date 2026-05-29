// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationMessageContent } from "./ConversationMessageContent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConversationMessageContent", () => {
  it("routes assistant web links through onOpenLink and prevents default", () => {
    const onOpenLink = vi.fn(() => true);
    render(
      <ConversationMessageContent
        role="assistant"
        attachments={null}
        text="[Docs](https://example.com/docs)"
        turnRequest={null}
        onOpenLink={onOpenLink}
      />,
    );

    const link = screen.getByRole("link", { name: "Docs" });
    const notDefaultPrevented = fireEvent.click(link);

    expect(onOpenLink).toHaveBeenCalledTimes(1);
    expect(onOpenLink).toHaveBeenCalledWith({
      href: "https://example.com/docs",
    });
    expect(notDefaultPrevented).toBe(false);
  });

  it("renders user message content as plain text with no link surface", () => {
    render(
      <ConversationMessageContent
        role="user"
        initiator="user"
        attachments={null}
        text="Visit https://example.com/docs"
        turnRequest={{ kind: "message", status: "accepted" }}
      />,
    );

    // User messages are plain text (CollapsibleMessageText), never markdown —
    // so there is no anchor to route, which is why `onOpenLink` is assistant
    // only and the user variant does not accept it.
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("Visit https://example.com/docs"),
    ).toBeTruthy();
  });
});
