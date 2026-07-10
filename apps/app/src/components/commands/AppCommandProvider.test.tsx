// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandContext,
  useAppCommandHandler,
} from "./AppCommandProvider";

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  keybindings: [
    {
      command: "thread.search" as const,
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
  return (
    <Handler command="question.select.1" name="question" result={true} />
  );
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
});
