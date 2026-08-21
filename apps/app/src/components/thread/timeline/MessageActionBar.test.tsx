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
    matches: query === COMPACT_VIEWPORT_QUERY || query === POINTER_COARSE_QUERY,
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
    fireEvent.click(button);
    expect(onSendToMain).toHaveBeenCalledTimes(1);
  });

  it("orders agent actions as copy, add, then fork", () => {
    const { container } = render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
        .map((button) => button.getAttribute("aria-label"))
        .filter((label) => label !== "Message actions"),
    ).toEqual(["Copy message", "Add to chat", "Fork into new thread"]);
  });

  it("keeps the same agent action order in the mobile overflow", () => {
    mockMobileCoarsePointer();
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="overflow"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const content =
      document.body.querySelector<HTMLElement>('[data-side="top"]');
    if (!content) throw new Error("Missing mobile message action menu");
    expect(
      within(content)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Copy message", "Add to chat", "Fork into new thread"]);
  });

  it("renders plugin actions after the native ones and fires their handlers", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
        pluginActions={[
          {
            key: "demo/summarize/1",
            pluginId: "demo",
            icon: "Zap",
            label: "Summarize",
            onSelect,
          },
        ]}
      />,
    );

    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
        .map((button) => button.getAttribute("aria-label"))
        .filter((label) => label !== "Message actions"),
    ).toEqual([
      "Copy message",
      "Add to chat",
      "Fork into new thread",
      "Summarize",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders an action bar for a plugin-action-only message", () => {
    render(
      <MessageActionBar
        messageText=""
        alignment="start"
        mobileActionDisplay="inline"
        pluginActions={[
          {
            key: "demo/summarize/1",
            pluginId: "demo",
            icon: null,
            label: "Summarize",
            onSelect: vi.fn(),
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Summarize" })).toBeTruthy();
  });

  it("includes plugin actions in the mobile overflow menu", () => {
    mockMobileCoarsePointer();
    const onSelect = vi.fn();
    render(
      <MessageActionBar
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="overflow"
        onAddToChat={vi.fn()}
        pluginActions={[
          {
            key: "demo/summarize/1",
            pluginId: "demo",
            icon: "Zap",
            label: "Summarize",
            onSelect,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    const content =
      document.body.querySelector<HTMLElement>('[data-side="top"]');
    if (!content) throw new Error("Missing mobile message action menu");
    fireEvent.click(within(content).getByRole("button", { name: "Summarize" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
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

    const content =
      document.body.querySelector<HTMLElement>('[data-side="top"]');
    expect(content).not.toBeNull();
    expect(content!.getAttribute("data-bb-portaled-overlay")).toBe("");
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
    const content =
      document.body.querySelector<HTMLElement>('[data-side="top"]');
    if (!content) throw new Error("Missing mobile message action menu");
    fireEvent.click(
      within(content).getByRole("button", { name: "Copy message" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Copy this answer."),
    );
    expect(trigger.querySelector('[data-icon="Check"]')).not.toBeNull();
  });

  it("forks from the inline mobile action", () => {
    const onFork = vi.fn();
    render(
      <MessageActionBar
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onFork={onFork}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Fork into new thread" }),
    );

    expect(onFork).toHaveBeenCalledTimes(1);
  });
  it("skips the desktop tooltip trees on touch phones", () => {
    mockMobileCoarsePointer();
    render(
      <MessageActionBar
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    // Radix TooltipTrigger stamps `data-state` on its child; the mobile branch
    // must render plain buttons (no tooltip tree per action).
    const fork = screen.getByRole("button", { name: "Fork into new thread" });
    expect(fork.hasAttribute("data-state")).toBe(false);
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Copy message", "Add to chat", "Fork into new thread"]);
    expect(
      screen.queryByRole("button", { name: "Message actions" }),
    ).toBeNull();
  });

  it("mounts the tooltip bar on fine-pointer viewports", () => {
    render(
      <MessageActionBar
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onFork={vi.fn()}
      />,
    );
    const fork = screen.getByRole("button", { name: "Fork into new thread" });
    expect(fork.getAttribute("data-state")).toBe("closed");
  });
});
