// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import { COMPACT_VIEWPORT_QUERY } from "@bb/shared-ui/hooks/use-compact-viewport";
import { POINTER_COARSE_QUERY } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  findMessageActionTooltipCollisionBoundary,
  MessageActionBar,
} from "./MessageActionBar";
import type { ThreadTimelineMessageAction } from "./types";

const TIMESTAMP = Date.UTC(2026, 8, 30, 16, 5);

type BarActionOptions = { run?: () => void; pluginId?: string };

function barAction(
  label: string,
  icon: string,
  placement: "inline" | "menu",
  { run = () => {}, pluginId = "bb--core" }: BarActionOptions = {},
): ThreadTimelineMessageAction {
  return {
    key: `${pluginId}/${label}`,
    pluginId,
    icon,
    label,
    placement,
    disabled: false,
    run: async () => {
      run();
      return false;
    },
  };
}

const copyLinkAction = (options?: BarActionOptions) =>
  barAction("Copy link", "Link", "menu", options);
const copyAction = (options?: BarActionOptions) =>
  barAction("Copy message", "Copy", "inline", options);
const editAction = (options?: BarActionOptions) =>
  barAction("Edit message", "Edit", "inline", options);
const pluginAction = (
  label: string,
  icon: string,
  options?: BarActionOptions,
) => barAction(label, icon, "inline", options);
const addToChatAction = (options?: BarActionOptions) =>
  barAction("Add to chat", "MessageSquarePlus", "menu", options);
const forkAction = (options?: BarActionOptions) =>
  barAction("Fork into new thread", "Fork", "menu", options);

afterEach(() => {
  cleanup();
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
        alignment="start"
        mobileActionDisplay="inline"
        actions={[
          copyLinkAction({ run: onCopyLink }),
          copyAction(),
          editAction(),
          addToChatAction(),
          forkAction(),
          pluginAction("Summarize", "Zap", {
            run: onPluginSelect,
            pluginId: "demo",
          }),
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
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("moves candidates that do not fit into the menu from the end", () => {
    const resizeObserver = installControlledResizeObserver();
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        alignment="end"
        mobileActionDisplay="inline"
        actions={[
          copyLinkAction(),
          copyAction(),
          editAction(),
          addToChatAction(),
          forkAction(),
          pluginAction("Summarize", "Zap"),
          pluginAction("Translate", "Languages"),
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

  it("re-renders only when a resize changes which actions fit", () => {
    const resizeObserver = installControlledResizeObserver();
    let commits = 0;
    render(
      <Profiler id="action-bar" onRender={() => (commits += 1)}>
        <MessageActionBar
          timestamp={TIMESTAMP}
          alignment="end"
          mobileActionDisplay="inline"
          actions={[copyAction(), editAction()]}
        />
      </Profiler>,
    );
    resizeObserver.reportWidth(400);
    const commitsAtRest = commits;
    const actionRow = screen
      .getByRole("button", { name: "Edit message" })
      .closest<HTMLElement>("div");

    for (let width = 399; width >= 300; width -= 1) {
      resizeObserver.reportWidth(width);
    }

    expect(commits).toBe(commitsAtRest);
    expect(actionRow?.style.maxWidth).toBe("300px");

    resizeObserver.reportWidth(30);

    expect(commits).toBeGreaterThan(commitsAtRest);
    expect(screen.queryByRole("button", { name: "Edit message" })).toBeNull();
  });

  it("puts every candidate in the menu when none fit", () => {
    const resizeObserver = installControlledResizeObserver();
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        alignment="end"
        mobileActionDisplay="inline"
        actions={[copyAction(), editAction(), addToChatAction(), forkAction()]}
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
        alignment="start"
        mobileActionDisplay="inline"
        actions={[copyAction()]}
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
          alignment="start"
          mobileActionDisplay="inline"
          actions={[
            copyAction(),
            editAction(),
            addToChatAction(),
            forkAction({ run: onFork }),
            pluginAction("Summarize", "Zap", { run: onPluginSelect }),
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
        alignment="start"
        mobileActionDisplay="overflow"
        actions={[
          copyLinkAction({ run: onCopyLink }),
          copyAction(),
          editAction(),
          addToChatAction(),
          forkAction(),
        ]}
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

  it("marks the action row while the menu is open", () => {
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        alignment="end"
        mobileActionDisplay="inline"
        actions={[copyAction()]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Message actions" });
    const row = trigger.parentElement?.parentElement;

    expect(row?.hasAttribute("data-menu-open")).toBe(false);
    fireEvent.pointerDown(trigger);
    expect(row?.hasAttribute("data-menu-open")).toBe(true);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(row?.hasAttribute("data-menu-open")).toBe(false);
  });

  it("confirms an inline run that resolves true with a check mark and ignores clicks meanwhile", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => true);
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        alignment="start"
        mobileActionDisplay="inline"
        actions={[{ ...copyAction(), run }]}
      />,
    );
    const button = screen.getByRole("button", { name: "Copy message" });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(run).toHaveBeenCalledWith("button");
    expect(button.querySelector('[data-icon="Check"]')).not.toBeNull();
    fireEvent.click(button);
    expect(run).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(button.querySelector('[data-icon="Check"]')).toBeNull();
    expect(button.querySelector('[data-icon="Copy"]')).not.toBeNull();
    vi.useRealTimers();
  });

  it("runs menu rows with the menu invocation and shows disabled rows inert", () => {
    const run = vi.fn(async () => true);
    render(
      <MessageActionBar
        timestamp={TIMESTAMP}
        alignment="start"
        mobileActionDisplay="inline"
        actions={[
          { ...copyLinkAction(), run },
          { ...forkAction(), disabled: true },
        ]}
      />,
    );
    const menu = openDesktopMenu();
    expect(
      within(menu)
        .getByRole("menuitem", { name: "Fork into new thread" })
        .hasAttribute("data-disabled"),
    ).toBe(true);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy link" }));
    expect(run).toHaveBeenCalledWith("menu");
  });
});
