// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandContext,
  useAppCommandHandler,
  useAppCommandShortcut,
} from "./AppCommandProvider";

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  keybindings: [
    {
      command: "thread.new" as const,
      desktopOnly: false,
      shortcut: {
        key: "o",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "thread.new" as const,
      desktopOnly: true,
      shortcut: {
        key: "n",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "thread.search" as const,
      desktopOnly: false,
      shortcut: {
        key: "k",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "question.select.1" as const,
      desktopOnly: false,
      shortcut: {
        key: "k",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface" as const, "questionOpen" as const],
        none: [],
      },
    },
    {
      command: "browser.reload" as const,
      desktopOnly: false,
      shortcut: {
        key: "r",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: false,
      },
      when: {
        all: ["mainSurface" as const, "browserFocus" as const],
        none: [],
      },
    },
  ],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { keybindings: testState.keybindings } }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

interface HandlerProps {
  command?: AppCommandId;
  name: string;
  priority?: number;
  result: boolean;
}

function Handler({
  command = "thread.search",
  name,
  priority,
  result,
}: HandlerProps) {
  useAppCommandHandler(
    command,
    () => {
      testState.calls.push(name);
      return result;
    },
    priority,
  );
  return null;
}

function QuestionContext() {
  useAppCommandContext("questionOpen", true);
  return <Handler command="question.select.1" name="question" result={true} />;
}

function FocusScopedHandler({ name }: { name: string }) {
  useAppCommandHandler("thread.search", ({ target }) => {
    if (
      !(target instanceof HTMLElement) ||
      target.closest(`[data-command-scope="${name}"]`) === null
    ) {
      return false;
    }
    testState.calls.push(name);
    return true;
  });
  return (
    <div data-command-scope={name}>
      <button type="button">{name}</button>
    </div>
  );
}

function ShortcutLabel() {
  const shortcut = useAppCommandShortcut("thread.new");
  return <span>{shortcut?.label}</span>;
}

function renderProvider(children: ReactNode) {
  return render(
    <MemoryRouter>
      <AppCommandProvider>{children}</AppCommandProvider>
    </MemoryRouter>,
  );
}

function dispatchShortcut(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
    key: "k",
  });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  testState.calls.length = 0;
});

describe("AppCommandProvider", () => {
  it("presents the web-capable alias when the primary binding is desktop-only", () => {
    renderProvider(<ShortcutLabel />);

    expect(screen.getByText("Ctrl+Shift+O")).toBeDefined();
  });

  it("falls through declining handlers in priority order", () => {
    renderProvider(
      <>
        <Handler name="low" result={true} />
        <Handler name="high" priority={10} result={false} />
      </>,
    );

    expect(dispatchShortcut().defaultPrevented).toBe(true);
    expect(testState.calls).toEqual(["high", "low"]);
  });

  it("gives later scoped bindings precedence on the same chord", () => {
    renderProvider(
      <>
        <Handler name="global" result={true} />
        <QuestionContext />
      </>,
    );

    dispatchShortcut();
    expect(testState.calls).toEqual(["question"]);
  });

  it("unregisters handlers on unmount and preserves native behavior when unhandled", () => {
    const rendered = renderProvider(<Handler name="removed" result={true} />);
    rendered.rerender(
      <MemoryRouter>
        <AppCommandProvider>{null}</AppCommandProvider>
      </MemoryRouter>,
    );

    expect(dispatchShortcut().defaultPrevented).toBe(false);
    expect(testState.calls).toEqual([]);
  });

  it("lets equal-priority handlers fall through to the focus-owning instance", () => {
    renderProvider(
      <>
        <FocusScopedHandler name="main" />
        <FocusScopedHandler name="side" />
      </>,
    );
    const mainButton = document.querySelector<HTMLButtonElement>(
      '[data-command-scope="main"] button',
    );
    expect(mainButton).not.toBeNull();
    mainButton?.focus();

    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    });
    mainButton?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(testState.calls).toEqual(["main"]);
  });

  it("derives browser focus only from events inside browser DOM chrome", () => {
    renderProvider(
      <>
        <Handler command="browser.reload" name="browser" result={true} />
        <button type="button">Outside</button>
        <div data-app-browser>
          <button type="button">Inside browser</button>
        </div>
      </>,
    );
    const outside = document.querySelector<HTMLButtonElement>("button");
    const inside = document.querySelector<HTMLButtonElement>(
      "[data-app-browser] button",
    );
    const dispatchReload = (target: HTMLButtonElement | null) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "r",
      });
      target?.dispatchEvent(event);
      return event;
    };

    expect(dispatchReload(outside).defaultPrevented).toBe(false);
    expect(testState.calls).toEqual([]);
    expect(dispatchReload(inside).defaultPrevented).toBe(true);
    expect(testState.calls).toEqual(["browser"]);
  });
});
