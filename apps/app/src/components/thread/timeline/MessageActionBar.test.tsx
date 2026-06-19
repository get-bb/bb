// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findMessageActionTooltipCollisionBoundary,
  MessageActionBar,
} from "./MessageActionBar";

afterEach(cleanup);

describe("MessageActionBar", () => {
  it("uses the nearest thread window as the tooltip collision boundary", () => {
    const threadWindow = document.createElement("div");
    threadWindow.setAttribute("data-thread-window", "");
    const sidePanel = document.createElement("aside");
    const actionBar = document.createElement("div");
    threadWindow.append(actionBar);
    document.body.append(threadWindow, sidePanel);

    expect(findMessageActionTooltipCollisionBoundary(actionBar)).toBe(
      threadWindow,
    );
    expect(findMessageActionTooltipCollisionBoundary(sidePanel)).toBeUndefined();
  });

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

  it("uses a single overflow trigger on coarse pointers", () => {
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        onSideChat={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Reply in side chat" });
    expect(button.className).toContain("max-md:pointer-coarse:hidden");

    const overflowTrigger = screen.getByRole("button", {
      name: "Message actions",
    });
    expect(overflowTrigger.className).toContain("hidden");
    expect(overflowTrigger.className).toContain(
      "max-md:pointer-coarse:inline-flex",
    );
    expect(overflowTrigger.className).not.toContain("opacity-0");
  });
});
