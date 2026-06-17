// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageActionBar } from "./MessageActionBar";

afterEach(cleanup);

describe("MessageActionBar", () => {
  it("renders the send-to-main action and fires its handler when supplied", () => {
    const onSendToMain = vi.fn();
    render(
      <MessageActionBar
        messageText="An answer worth keeping."
        alignment="start"
        onSendToMain={onSendToMain}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Send to main thread" }),
    );
    expect(onSendToMain).toHaveBeenCalledTimes(1);
  });

  it("omits the send-to-main action when no handler is supplied", () => {
    render(
      <MessageActionBar messageText="An answer." alignment="start" />,
    );

    expect(
      screen.queryByRole("button", { name: "Send to main thread" }),
    ).toBeNull();
  });

  it("send-to-main is not gated by the fork/side-chat depth `disabled` flag", () => {
    const onSendToMain = vi.fn();
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        onSendToMain={onSendToMain}
        disabled
      />,
    );

    const button = screen.getByRole("button", { name: "Send to main thread" });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onSendToMain).toHaveBeenCalledTimes(1);
  });

  it("keeps actions visible and tappable on coarse pointers", () => {
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        onSideChat={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Reply in side chat" });
    expect(button.className).toContain("max-md:pointer-coarse:opacity-100");
    expect(button.className).toContain("max-md:pointer-coarse:size-9");
  });
});
