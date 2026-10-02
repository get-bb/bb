// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setPluginLogoUrls,
  resetPluginLogoStoreForTest,
} from "@/lib/plugin-logos";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  computeMessageActionRowLayout,
  findMessageActionTooltipCollisionBoundary,
  MessageActionBar,
} from "./MessageActionBar";

afterEach(() => {
  cleanup();
  resetPluginLogoStoreForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const METADATA = { timestamp: Date.UTC(2026, 8, 25, 10, 11) };

function installControlledResizeObserver() {
  const observations: { callback: ResizeObserverCallback; node: Element }[] =
    [];
  class ControlledResizeObserver {
    readonly #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe(node: Element) {
      observations.push({ callback: this.#callback, node });
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  return {
    reportWidth(width: number) {
      act(() => {
        for (const { callback, node } of observations) {
          callback(
            [
              {
                target: node,
                contentRect: { width, height: 20 },
              } as unknown as ResizeObserverEntry,
            ],
            undefined as unknown as ResizeObserver,
          );
        }
      });
    },
  };
}

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

function inlineActionLabels(): (string | null)[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"))
    .filter((label) => label !== "Message actions");
}

function openDesktopMenu(): string[] {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Message actions" }),
  );
  return screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
}

function openMobileMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
  const content = document.body.querySelector<HTMLElement>('[data-side="top"]');
  if (!content) throw new Error("Missing mobile message action menu");
  return content;
}

const SUMMARIZE_ACTION = {
  key: "demo/summarize/1",
  pluginId: "demo",
  icon: "Zap",
  label: "Summarize",
};

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

  it("keeps copy, edit and plugin actions inline and the rest in the menu", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onCopyLink={vi.fn()}
        onEdit={vi.fn()}
        onFork={vi.fn()}
        onSendToMain={vi.fn()}
        pluginActions={[{ ...SUMMARIZE_ACTION, onSelect: vi.fn() }]}
      />,
    );

    expect(inlineActionLabels()).toEqual([
      "Copy message",
      "Edit message",
      "Summarize",
    ]);
    expect(openDesktopMenu()).toEqual([
      "Copy link to message",
      "Add to chat",
      "Send to main thread",
      "Fork into new thread",
    ]);
  });

  it("shows the message time in a footer that is not a menu item", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onCopyLink={vi.fn()}
      />,
    );
    openDesktopMenu();

    const time = document.body.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-09-25T10:11:00.000Z");
    expect(time?.closest("[role=menuitem]")).toBeNull();
  });

  it("copies the message link from the menu", () => {
    const onCopyLink = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onCopyLink={onCopyLink}
      />,
    );
    openDesktopMenu();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Copy link to message" }),
    );
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("renders plugin action icons before branding and fires their handlers", () => {
    setPluginLogoUrls(
      new Map([
        [
          "demo",
          {
            displayName: "Demo",
            icon: "Check",
            compactIconUrl: "/demo.svg",
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    const onSelect = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        pluginActions={[{ ...SUMMARIZE_ACTION, onSelect }]}
      />,
    );

    const summarize = screen.getByRole("button", { name: "Summarize" });
    expect(summarize.querySelector('[data-icon="Zap"]')).not.toBeNull();
    fireEvent.click(summarize);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("renders an action bar for a plugin-action-only message", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText=""
        alignment="start"
        mobileActionDisplay="inline"
        pluginActions={[{ ...SUMMARIZE_ACTION, icon: null, onSelect: vi.fn() }]}
      />,
    );
    expect(screen.getByRole("button", { name: "Summarize" })).toBeTruthy();
  });

  it("includes explicit plugin icons in the mobile overflow menu", () => {
    setPluginLogoUrls(
      new Map([
        [
          "demo",
          {
            displayName: "Demo",
            icon: "Check",
            compactIconUrl: "/demo.svg",
            logoUrl: null,
            logoDarkUrl: null,
            icons: new Map(),
          },
        ],
      ]),
    );
    mockMobileCoarsePointer();
    const onSelect = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="overflow"
        onAddToChat={vi.fn()}
        pluginActions={[{ ...SUMMARIZE_ACTION, onSelect }]}
      />,
    );

    const content = openMobileMenu();
    const summarize = within(content).getByRole("button", {
      name: "Summarize",
    });
    expect(summarize.querySelector('[data-icon="Zap"]')).not.toBeNull();
    fireEvent.click(summarize);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("passes the message text and attachments to add-to-chat", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localFile" as const,
      path: "uploads/spec.md",
      name: "spec.md",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="overflow"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    openDesktopMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to chat" }));
    expect(onAddToChat).toHaveBeenCalledWith("Quote this message.", [
      attachment,
    ]);
  });

  it("offers add-to-chat for attachment-only messages", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localImage" as const,
      path: "uploads/screenshot.png",
      name: "screenshot.png",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText=""
        alignment="end"
        mobileActionDisplay="overflow"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    openDesktopMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to chat" }));
    expect(onAddToChat).toHaveBeenCalledWith("", [attachment]);
  });

  it("renders copy for an image-only message", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText=""
        copyImageUrl="/attachments/screenshot.png"
        alignment="end"
        mobileActionDisplay="overflow"
      />,
    );

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("does not gate send-to-main on the fork depth `disabled` flag", () => {
    const onSendToMain = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="overflow"
        onFork={vi.fn()}
        onSendToMain={onSendToMain}
        disabled
      />,
    );

    openDesktopMenu();
    expect(
      screen
        .getByRole("menuitem", { name: "Fork into new thread" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    const sendToMain = screen.getByRole("menuitem", {
      name: "Send to main thread",
    });
    expect(sendToMain.hasAttribute("data-disabled")).toBe(false);
    fireEvent.click(sendToMain);
    expect(onSendToMain).toHaveBeenCalledTimes(1);
  });

  it("uses an anchored popover with the metadata footer instead of a bottom drawer on mobile", () => {
    mockMobileCoarsePointer();
    const onAddToChat = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="overflow"
        onAddToChat={onAddToChat}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Message actions" });
    expect(trigger.hasAttribute("data-no-sidebar-swipe")).toBe(true);
    const content = openMobileMenu();
    expect(content.getAttribute("data-bb-portaled-overlay")).toBe("");
    expect(document.body.querySelector("[data-vaul-drawer]")).toBeNull();
    expect(
      content.querySelector("[data-message-metadata] time"),
    ).not.toBeNull();

    fireEvent.click(
      within(content).getByRole("button", { name: "Add to chat" }),
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
        metadata={METADATA}
        messageText="Copy this answer."
        alignment="start"
        mobileActionDisplay="overflow"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Message actions" });
    const content = openMobileMenu();
    fireEvent.click(
      within(content).getByRole("button", { name: "Copy message" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("Copy this answer."),
    );
    expect(trigger.querySelector('[data-icon="Check"]')).not.toBeNull();
  });

  it("keeps inline actions on the latest touch message and the rest in its popover", () => {
    mockMobileCoarsePointer();
    const onFork = vi.fn();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
        onEdit={vi.fn()}
        onFork={onFork}
      />,
    );

    const copy = screen.getByRole("button", { name: "Copy message" });
    expect(copy.hasAttribute("data-state")).toBe(false);
    expect(inlineActionLabels()).toEqual(["Copy message", "Edit message"]);

    const content = openMobileMenu();
    fireEvent.click(
      within(content).getByRole("button", { name: "Fork into new thread" }),
    );
    expect(onFork).toHaveBeenCalledTimes(1);
  });

  it("folds inline actions that do not fit into the top of the desktop menu", () => {
    const resizeObserver = installControlledResizeObserver();
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="end"
        mobileActionDisplay="overflow"
        onEdit={vi.fn()}
        onFork={vi.fn()}
        pluginActions={[{ ...SUMMARIZE_ACTION, onSelect: vi.fn() }]}
      />,
    );
    resizeObserver.reportWidth(44);

    expect(inlineActionLabels()).toEqual(["Copy message"]);
    expect(openDesktopMenu()).toEqual([
      "Edit message",
      "Summarize",
      "Fork into new thread",
    ]);
  });

  it("marks the action row while its menu is open", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="An answer."
        alignment="end"
        mobileActionDisplay="overflow"
        onFork={vi.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Message actions" });
    const row = trigger.parentElement;

    expect(row?.hasAttribute("data-menu-open")).toBe(false);
    fireEvent.pointerDown(trigger);
    expect(row?.hasAttribute("data-menu-open")).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(row?.hasAttribute("data-menu-open")).toBe(false);
  });

  it("mounts the tooltip bar on fine-pointer viewports", () => {
    render(
      <MessageActionBar
        metadata={METADATA}
        messageText="The latest answer."
        alignment="start"
        mobileActionDisplay="inline"
      />,
    );
    const copy = screen.getByRole("button", { name: "Copy message" });
    expect(copy.getAttribute("data-state")).toBe("closed");
  });
});

describe("computeMessageActionRowLayout", () => {
  const metrics = { actionWidth: 20 };

  it("renders everything inline before the slot is measured", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 5,
        availableWidth: undefined,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 5, overflowCount: 0 });
  });

  it("keeps all actions inline when they exactly fit", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 76,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 3, overflowCount: 0 });
  });

  it("collapses the tail once the full row would overflow", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 75,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 2, overflowCount: 1 });
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 71,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 1, overflowCount: 2 });
  });

  it("puts every action in the menu when not even one fits beside the trigger", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 30,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 3 });
  });

  it("returns an empty layout for zero actions", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 0,
        availableWidth: 400,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 0 });
  });
});
