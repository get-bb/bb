// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerComposerPlugin } from "@/test/fixtures/composer-plugin";
import { ComposerTestProviders } from "@/test/fixtures/composer-test-providers";
import { defaultAppSettings, type AppShortcut } from "@bb/domain";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useIsAppCommandModifierHeld,
} from "@/components/commands/AppCommandProvider";
import { ComposerBox } from "./ComposerBox";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";

const testState = vi.hoisted(() => ({
  calls: [] as string[],
  composerInputLocked: false,
  sidebarHandlerResult: true,
  sidebarShortcut: {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  } as AppShortcut,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { ...defaultAppSettings },
      keybindings: [
        {
          command: "sidebar.toggle" as const,
          desktopOnly: false,
          shortcut: testState.sidebarShortcut,
          when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
        },
      ],
    },
  }),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
}));

vi.mock("@/lib/plugin-sdk-hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugin-sdk-hooks")>()),
  useComposerInputLock: () => testState.composerInputLocked,
}));

function SidebarToggleHandler() {
  useAppCommandHandler("sidebar.toggle", () => {
    testState.calls.push("sidebar.toggle");
    return testState.sidebarHandlerResult;
  });
  return null;
}

function ShortcutHintState() {
  return (
    <span>{useIsAppCommandModifierHeld() ? "hint-held" : "hint-released"}</span>
  );
}

function renderComposer(extra: React.ReactNode = null) {
  render(
    <ComposerTestProviders>
      <AppCommandProvider>
        <SidebarToggleHandler />
        {extra}
        <ComposerBox
          surface="thread"
          value=""
          mentionRanges={[]}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          mentionMenuPlacement="bottom"
          typeahead={testTypeaheadConfig()}
        />
      </AppCommandProvider>
    </ComposerTestProviders>,
  );
  const editor = document.querySelector<HTMLElement>(
    "[data-promptbox-editor-content] [contenteditable]",
  );
  if (editor === null) throw new Error("prompt editor did not render");
  editor.focus();
  return editor;
}

function pressInEditor(
  editor: HTMLElement,
  init: KeyboardEventInit,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  editor.dispatchEvent(event);
  return event;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  testState.calls.length = 0;
  testState.composerInputLocked = false;
  testState.sidebarHandlerResult = true;
  testState.sidebarShortcut = {
    key: "\\",
    mod: true,
    meta: false,
    control: false,
    alt: false,
    shift: false,
  };
});

beforeEach(async () => {
  await registerComposerPlugin();
});

describe("prompt editor app shortcuts", () => {
  it("runs the sidebar shortcut while the composer has focus", () => {
    const editor = renderComposer();

    const event = pressInEditor(editor, { ctrlKey: true, key: "\\" });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("runs a sidebar shortcut whose chord the editor keymap also claims", () => {
    testState.sidebarShortcut = {
      key: "b",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: true,
    };
    const editor = renderComposer();

    pressInEditor(editor, {
      code: "KeyB",
      ctrlKey: true,
      key: "B",
      keyCode: 66,
      shiftKey: true,
    });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
  });

  it("offers a declined chord to the handlers only once", () => {
    testState.sidebarHandlerResult = false;
    const editor = renderComposer();

    const event = pressInEditor(editor, { ctrlKey: true, key: "\\" });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps the keyboard hint until modifier release when the composer runs a shortcut", () => {
    vi.useFakeTimers();
    try {
      const editor = renderComposer(<ShortcutHintState />);
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }),
      );
      act(() => vi.advanceTimersByTime(700));
      expect(screen.getByText("hint-held")).toBeDefined();

      act(() => {
        pressInEditor(editor, { ctrlKey: true, key: "\\" });
      });

      expect(testState.calls).toEqual(["sidebar.toggle"]);
      expect(screen.getByText("hint-held")).toBeDefined();
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
      });
      expect(screen.getByText("hint-released")).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases focus on Escape while a plugin locks the composer", () => {
    testState.composerInputLocked = true;
    const editor = renderComposer();
    expect(editor.getAttribute("contenteditable")).toBe("false");
    editor.focus();
    expect(document.activeElement).toBe(editor);

    pressInEditor(editor, { key: "Escape" });

    expect(document.activeElement).not.toBe(editor);
  });

  it("keeps typed text in the composer", () => {
    const editor = renderComposer();

    const event = pressInEditor(editor, { code: "KeyB", key: "b" });

    expect(testState.calls).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });
});
