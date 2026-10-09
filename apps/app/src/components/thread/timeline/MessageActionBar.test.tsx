// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createStore, getDefaultStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  computeMessageActionRowLayout,
  findMessageActionTooltipCollisionBoundary,
  MessageActionBar,
} from "./MessageActionBar";
import {
  MESSAGE_ACTION_USAGE_STORAGE_KEY,
  messageActionUsageAtom,
} from "./message-action-usage";

const TIMESTAMP = Date.UTC(2026, 8, 30, 16, 5);

afterEach(() => {
  cleanup();
  getDefaultStore().set(messageActionUsageAtom, {});
  window.localStorage.clear();
  resetPluginLogoStoreForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

function inlineActionLabels(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
    .map((button) => button.getAttribute("aria-label"))
    .filter((label) => label !== "Message actions");
}

function menuItemLabels(menu: HTMLElement) {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

function openDesktopMenu() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Message actions" }),
  );
  return screen.getByRole("menu");
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

  it("keeps candidates inline in priority order and reserves the menu for trailing actions", () => {
    const resizeObserver = installControlledResizeObserver();
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
    const onPluginSelect = vi.fn();
    const onCopyLink = vi.fn();
    const { container } = render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onEdit={vi.fn()}
        onCopyLink={onCopyLink}
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
        pluginActions={[
          {
            key: "demo/summarize/1",
            usageKey: "demo/summarize/1",
            pluginId: "demo",
            icon: "Zap",
            label: "Summarize",
            onSelect: onPluginSelect,
          },
        ]}
      />,
    );
    resizeObserver.reportWidth(100);

    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")]
        .map((button) => button.getAttribute("aria-label"))
        .filter((label) => label !== "Message actions"),
    ).toEqual(["Copy message", "Edit message", "Summarize"]);
    expect(
      screen
        .getByRole("button", { name: "Summarize" })
        .querySelector('[data-icon="Zap"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Summarize" }));
    expect(onPluginSelect).toHaveBeenCalledTimes(1);

    const menu = openDesktopMenu();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Copy link", "Add to chat", "Fork into new thread"]);
    expect(menu.getAttribute("data-side")).toBe("bottom");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Copy link" }),
    );
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("moves candidates that do not fit into the menu from the end", () => {
    const resizeObserver = installControlledResizeObserver();
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="end"
        mobileActionDisplay="inline"
        onEdit={vi.fn()}
        onCopyLink={vi.fn()}
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
        pluginActions={[
          {
            key: "demo/summarize/1",
            usageKey: "demo/summarize/1",
            pluginId: null,
            icon: "Zap",
            label: "Summarize",
            onSelect: vi.fn(),
          },
          {
            key: "demo/translate/1",
            usageKey: "demo/translate/1",
            pluginId: null,
            icon: "Languages",
            label: "Translate",
            onSelect: vi.fn(),
          },
        ]}
      />,
    );
    resizeObserver.reportWidth(72);

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit message" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Summarize" })).toBeNull();

    expect(
      within(openDesktopMenu())
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Copy link",
      "Summarize",
      "Translate",
      "Add to chat",
      "Fork into new thread",
    ]);
  });

  it("puts every candidate in the menu when none fit", () => {
    const resizeObserver = installControlledResizeObserver();
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="end"
        mobileActionDisplay="inline"
        onEdit={vi.fn()}
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );
    resizeObserver.reportWidth(30);

    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(
      within(openDesktopMenu())
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Copy message",
      "Edit message",
      "Add to chat",
      "Fork into new thread",
    ]);
  });

  it("shows a timestamp-only footer in the menu", () => {
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
      />,
    );

    const menu = openDesktopMenu();
    const metadata = menu.querySelector<HTMLElement>("[data-message-metadata]");
    const time = within(metadata!).getByRole("time");
    expect(time.getAttribute("datetime")).toBe("2026-09-30T16:05:00.000Z");
    expect(time.textContent).not.toBe("");
    expect(metadata?.textContent).not.toMatch(/model|reasoning/i);
  });

  it("lists every action in the latest touch message drawer even when actions fit inline", async () => {
    mockMobileCoarsePointer();
    const resizeObserver = installControlledResizeObserver();
    const onFork = vi.fn();
    const onPluginSelect = vi.fn();
    render(
      <main data-testid="app-root">
        <MessageActionBar
          timestamp={TIMESTAMP}
          messageText="An answer."
          alignment="start"
          mobileActionDisplay="inline"
          onEdit={vi.fn()}
          onAddToChat={vi.fn()}
          onFork={onFork}
          pluginActions={[
            {
              key: "demo/summarize/1",
              usageKey: "demo/summarize/1",
              pluginId: null,
              icon: "Zap",
              label: "Summarize",
              onSelect: onPluginSelect,
            },
          ]}
        />
      </main>,
    );
    resizeObserver.reportWidth(200);

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit message" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Summarize" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

    const drawer = await screen.findByRole("dialog", {
      name: "Message actions",
    });
    const menuItems = await within(drawer).findAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Copy message",
      "Edit message",
      "Summarize",
      "Add to chat",
      "Fork into new thread",
    ]);
    resizeObserver.reportWidth(60);
    expect(screen.queryByRole("button", { name: "Summarize" })).toBeNull();
    expect(
      within(drawer)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Copy message",
      "Edit message",
      "Summarize",
      "Add to chat",
      "Fork into new thread",
    ]);
    expect(document.body.querySelector('[data-side="top"]')).toBeNull();
    expect(screen.getByTestId("app-root").hasAttribute("inert")).toBe(false);
    expect(screen.getByTestId("app-root").hasAttribute("aria-hidden")).toBe(
      false,
    );
    fireEvent.click(
      within(drawer).getByRole("menuitem", { name: "Fork into new thread" }),
    );
    expect(onFork).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));
    fireEvent.click(
      await within(drawer).findByRole("menuitem", { name: "Summarize" }),
    );
    expect(onPluginSelect).toHaveBeenCalledTimes(1);
  });

  it("shows only the menu trigger on older touch messages", async () => {
    mockMobileCoarsePointer();
    const onCopyLink = vi.fn();
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An earlier answer."
        alignment="start"
        mobileActionDisplay="overflow"
        onEdit={vi.fn()}
        onCopyLink={onCopyLink}
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Message actions" }));

    const drawer = await screen.findByRole("dialog", {
      name: "Message actions",
    });
    const menuItems = await within(drawer).findAllByRole("menuitem");
    expect(menuItems.map((item) => item.textContent)).toEqual([
      "Copy link",
      "Copy message",
      "Edit message",
      "Add to chat",
      "Fork into new thread",
    ]);
    fireEvent.click(
      within(drawer).getByRole("menuitem", { name: "Copy link" }),
    );
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("passes message text and attachments from Add to chat", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localFile" as const,
      path: "uploads/spec.md",
      name: "spec.md",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="Quote this message."
        alignment="end"
        mobileActionDisplay="inline"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    fireEvent.click(
      within(openDesktopMenu()).getByRole("menuitem", { name: "Add to chat" }),
    );
    expect(onAddToChat).toHaveBeenCalledWith("Quote this message.", [
      attachment,
    ]);
  });

  it("offers Add to chat for attachment-only messages", () => {
    const onAddToChat = vi.fn();
    const attachment = {
      type: "localImage" as const,
      path: "uploads/screenshot.png",
      name: "screenshot.png",
      sizeBytes: 0,
    };
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText=""
        alignment="end"
        mobileActionDisplay="inline"
        addToChatAttachments={[attachment]}
        onAddToChat={onAddToChat}
      />,
    );

    fireEvent.click(
      within(openDesktopMenu()).getByRole("menuitem", { name: "Add to chat" }),
    );
    expect(onAddToChat).toHaveBeenCalledWith("", [attachment]);
  });

  it("offers Copy for an image-only message", () => {
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText=""
        copyImageUrl="/attachments/screenshot.png"
        alignment="end"
        mobileActionDisplay="inline"
      />,
    );

    expect(screen.getByRole("button", { name: "Copy message" })).toBeTruthy();
  });

  it("marks the action row while the menu is open", () => {
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="end"
        mobileActionDisplay="inline"
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
});

describe("MessageActionBar usage ordering", () => {
  function renderAssistantBar(onFork = vi.fn()) {
    const resizeObserver = installControlledResizeObserver();
    const result = render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onCopyLink={vi.fn()}
        onAddToChat={vi.fn()}
        onFork={onFork}
      />,
    );
    resizeObserver.reportWidth(200);
    return result;
  }

  it("promotes a menu action into the row after repeated use", () => {
    const onFork = vi.fn();
    const { container } = renderAssistantBar(onFork);

    expect(inlineActionLabels(container)).toEqual(["Copy message"]);
    fireEvent.click(
      within(openDesktopMenu()).getByRole("menuitem", {
        name: "Fork into new thread",
      }),
    );
    expect(inlineActionLabels(container)).toEqual(["Copy message"]);
    fireEvent.click(
      within(openDesktopMenu()).getByRole("menuitem", {
        name: "Fork into new thread",
      }),
    );

    expect(onFork).toHaveBeenCalledTimes(2);
    expect(inlineActionLabels(container)).toEqual([
      "Copy message",
      "Fork into new thread",
    ]);
    expect(menuItemLabels(openDesktopMenu())).toEqual([
      "Copy link",
      "Add to chat",
    ]);
    expect(
      JSON.parse(
        window.localStorage.getItem(MESSAGE_ACTION_USAGE_STORAGE_KEY) ?? "{}",
      ),
    ).toHaveProperty("fork");
  });

  it("keeps canonical order and moves the least-used action into the menu when the row is full", () => {
    const now = Date.now();
    getDefaultStore().set(messageActionUsageAtom, {
      "add-to-chat": { score: 5, usedAt: now },
      fork: { score: 4, usedAt: now },
      copy: { score: 3.5, usedAt: now },
      "copy-link": { score: 3, usedAt: now },
    });
    const { container } = renderAssistantBar();

    expect(inlineActionLabels(container)).toEqual([
      "Copy message",
      "Add to chat",
      "Fork into new thread",
    ]);
    expect(menuItemLabels(openDesktopMenu())).toEqual(["Copy link"]);
  });

  it("keeps every default inline beside promoted actions", () => {
    const now = Date.now();
    getDefaultStore().set(messageActionUsageAtom, {
      "add-to-chat": { score: 2, usedAt: now },
      "copy-link": { score: 2, usedAt: now },
    });
    const resizeObserver = installControlledResizeObserver();
    const { container } = render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="A question."
        alignment="end"
        mobileActionDisplay="inline"
        onEdit={vi.fn()}
        onCopyLink={vi.fn()}
        onAddToChat={vi.fn()}
        pluginActions={[
          {
            key: "demo/reply/1",
            usageKey: "demo/reply",
            pluginId: null,
            icon: "Zap",
            label: "Reply in side chat",
            onSelect: vi.fn(),
          },
        ]}
      />,
    );
    resizeObserver.reportWidth(200);

    expect(inlineActionLabels(container)).toEqual([
      "Copy message",
      "Edit message",
      "Reply in side chat",
      "Copy link",
      "Add to chat",
    ]);
  });

  it("overflows the lowest-scoring action first when the row is narrow", () => {
    const now = Date.now();
    getDefaultStore().set(messageActionUsageAtom, {
      fork: { score: 6, usedAt: now },
      copy: { score: 4, usedAt: now },
      "add-to-chat": { score: 2, usedAt: now },
    });
    const resizeObserver = installControlledResizeObserver();
    const { container } = render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
      />,
    );
    resizeObserver.reportWidth(72);

    expect(inlineActionLabels(container)).toEqual([
      "Copy message",
      "Fork into new thread",
    ]);
    expect(menuItemLabels(openDesktopMenu())).toEqual(["Add to chat"]);
  });

  it("keeps a promoted action inline and disabled when it is unavailable", () => {
    getDefaultStore().set(messageActionUsageAtom, {
      fork: { score: 3, usedAt: Date.now() },
    });
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onFork={vi.fn()}
        disabled
      />,
    );

    expect(
      screen
        .getByRole("button", { name: "Fork into new thread" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("records copies from the inline copy button", async () => {
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    });

    expect(getDefaultStore().get(messageActionUsageAtom).copy?.score).toBe(1);
  });

  it("falls back to the default row when stored usage is malformed", () => {
    window.localStorage.setItem(
      MESSAGE_ACTION_USAGE_STORAGE_KEY,
      JSON.stringify({
        fork: { score: 9, usedAt: Date.now() },
        copy: { score: "lots" },
      }),
    );
    const { container } = render(
      <Provider store={createStore()}>
        <MessageActionBar
          timestamp={TIMESTAMP}
          messageText="An answer."
          alignment="start"
          mobileActionDisplay="inline"
          onFork={vi.fn()}
        />
      </Provider>,
    );

    expect(inlineActionLabels(container)).toEqual(["Copy message"]);
  });
});

describe("computeMessageActionRowLayout", () => {
  const metrics = { actionWidth: 20 };

  it("renders every candidate inline before the slot is measured", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 5,
        availableWidth: undefined,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 5, overflowCount: 0 });
  });

  it("reserves space for the always-present menu trigger", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 100,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 3, overflowCount: 0 });
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 99,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 2, overflowCount: 1 });
  });

  it("moves candidates into overflow from the end", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 72,
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

  it("puts every candidate in the menu when none fit beside the trigger", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 3,
        availableWidth: 30,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 3 });
  });

  it("returns an empty layout for zero candidates", () => {
    expect(
      computeMessageActionRowLayout({
        actionCount: 0,
        availableWidth: 400,
        ...metrics,
      }),
    ).toEqual({ inlineCount: 0, overflowCount: 0 });
  });
});
