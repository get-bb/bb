// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  findMessageActionTooltipCollisionBoundary,
  MessageActionBar,
} from "./MessageActionBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockMobileCoarsePointer() {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches:
      query === COMPACT_VIEWPORT_QUERY || query === POINTER_COARSE_QUERY,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

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
    expect(
      findMessageActionTooltipCollisionBoundary(sidePanel),
    ).toBeUndefined();
  });

  it("renders the send-to-main action and fires its handler when supplied", () => {
    const onSendToMain = vi.fn();
    render(
      <MessageActionBar
        messageText="An answer worth keeping."
        alignment="start"
        mobileActionDisplay="overflow"
        onSendToMain={onSendToMain}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Send to main thread",
    });
    expect(button.className).toContain("cursor-pointer");
    fireEvent.click(button);
    expect(onSendToMain).toHaveBeenCalledTimes(1);
  });

  it("renders add-to-chat as an icon action and passes the message text", () => {
    const onAddToChat = vi.fn();
    render(
      <MessageActionBar
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="overflow"
        onAddToChat={onAddToChat}
      />,
    );

    const button = screen.getByRole("button", { name: "Add to chat" });
    expect(button.className).toContain("cursor-pointer");
    fireEvent.click(button);
    expect(onAddToChat).toHaveBeenCalledWith("Quote this message.");
  });

  it("passes add-to-chat attachments with the message text", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localFile" as const,
      path: "uploads/spec.md",
      name: "spec.md",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="overflow"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onAddToChat).toHaveBeenCalledWith("Quote this message.", [
      attachment,
    ]);
  });

  it("renders add-to-chat for attachment-only messages", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localImage" as const,
      path: "uploads/screenshot.png",
      name: "screenshot.png",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        messageText=""
        alignment="end"
        mobileActionDisplay="overflow"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));
    expect(onAddToChat).toHaveBeenCalledWith("", [attachment]);
  });

  it("omits the send-to-main action when no handler is supplied", () => {
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="overflow"
      />,
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
        mobileActionDisplay="overflow"
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
        mobileActionDisplay="overflow"
        onSideChat={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Reply in side chat" });
    expect(button.className).toContain("max-md:pointer-coarse:hidden");

    const overflowTrigger = screen.getByRole("button", {
      name: "Message actions",
    });
    expect(overflowTrigger.className).toContain("cursor-pointer");
    expect(overflowTrigger.className).toContain("hidden");
    expect(overflowTrigger.className).toContain(
      "max-md:pointer-coarse:inline-flex",
    );
    expect(overflowTrigger.className).not.toContain("opacity-0");
  });

  it("uses an anchored popover instead of a bottom drawer on mobile", () => {
    mockMobileCoarsePointer();
    const onAddToChat = vi.fn();
    render(
      <MessageActionBar
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="overflow"
        onAddToChat={onAddToChat}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Message actions" });
    expect(trigger.hasAttribute("data-no-sidebar-swipe")).toBe(true);
    fireEvent.click(trigger);

    const content = document.body.querySelector<HTMLElement>(
      '[data-side="top"]',
    );
    expect(content).not.toBeNull();
    expect(document.body.querySelector("[data-vaul-drawer]")).toBeNull();

    fireEvent.click(
      within(content!).getByRole("button", { name: "Add to chat" }),
    );

    expect(onAddToChat).toHaveBeenCalledWith("Quote this message.");
    expect(document.body.querySelector('[data-side="top"]')).toBeNull();
  });

  it("confirms a mobile overflow copy on the trigger instead of toasting", async () => {
    mockMobileCoarsePointer();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <MessageActionBar
        messageText="Copy this answer."
        alignment="start"
        mobileActionDisplay="overflow"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Message actions" });
    fireEvent.click(trigger);
    const content = document.body.querySelector<HTMLElement>(
      '[data-side="top"]',
    );
    if (!content) throw new Error("Missing mobile message action menu");
    fireEvent.click(
      within(content).getByRole("button", { name: "Copy message" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Copy this answer."));
    expect(trigger.querySelector('[data-icon="Check"]')).not.toBeNull();
  });

  it("opens a side chat from the inline mobile action", () => {
    const onSideChat = vi.fn();
    render(
      <MessageActionBar
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onSideChat={onSideChat}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Reply in side chat" }));

    expect(onSideChat).toHaveBeenCalledTimes(1);
  });

  it("shows compact inline mobile actions without an overflow menu when requested", () => {
    render(
      <MessageActionBar
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onFork={vi.fn()}
        onSideChat={vi.fn()}
      />,
    );

    for (const name of [
      "Copy message",
      "Fork into new thread",
      "Reply in side chat",
    ]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("max-md:pointer-coarse:size-7");
      expect(button.className).toContain("max-md:pointer-coarse:opacity-100");
      expect(button.className).not.toContain("max-md:pointer-coarse:hidden");
    }

    expect(
      screen.queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
  });
});
