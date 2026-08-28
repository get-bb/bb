// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultAppSettings, type AppShortcut } from "@bb/domain";
import * as bbDesktop from "@/lib/bb-desktop";
import * as pluginSdkHooks from "@/lib/plugin-sdk-hooks";
import * as systemQueries from "@/hooks/queries/system-queries";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useIsAppCommandModifierHeld,
} from "@/components/commands/AppCommandProvider";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";

let inertTypeaheadCommandConfig: typeof import("./PromptBoxInternal").INERT_TYPEAHEAD_COMMAND_CONFIG;
let PromptBoxInternal: typeof import("./PromptBoxInternal").PromptBoxInternal;

const testState = vi.hoisted(() => ({
  calls:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ [] as string[],
  composerInputLocked: false,
  sidebarHandlerResult: true,
  sidebarShortcut:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ {
      key: "\\",
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: false,
    } as AppShortcut,
}));

const systemConfigData = {
  generalSettings: { ...defaultAppSettings },
  keybindings: [
    {
      command: "thread.previous" as const,
      desktopOnly: false,
      shortcut: {
        key: "ArrowUp",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "thread.next" as const,
      desktopOnly: false,
      shortcut: {
        key: "ArrowDown",
        mod: true,
        meta: false,
        control: false,
        alt: false,
        shift: true,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
    {
      command: "sidebar.toggle" as const,
      desktopOnly: false,
      shortcut: testState.sidebarShortcut,
      when: { all: ["mainSurface" as const], none: ["modalOpen" as const] },
    },
  ],
};

// SAFETY: The test provides the fields that PromptBoxInternal reads from this query result.
vi.spyOn(systemQueries, "useSystemConfig").mockReturnValue({
  data: systemConfigData,
} as ReturnType<typeof systemQueries.useSystemConfig>);
vi.spyOn(bbDesktop, "getBbDesktopInfo").mockReturnValue(null);
vi.spyOn(pluginSdkHooks, "useComposerInputLock").mockImplementation(
  () => testState.composerInputLocked,
);

beforeAll(async () => {
  const promptBoxInternal = await import("./PromptBoxInternal");
  inertTypeaheadCommandConfig =
    promptBoxInternal.INERT_TYPEAHEAD_COMMAND_CONFIG;
  PromptBoxInternal = promptBoxInternal.PromptBoxInternal;
});

beforeEach(() => {
  vi.spyOn(pluginSdkHooks, "useComposerInputLock").mockImplementation(
    () => testState.composerInputLocked,
  );
});

function SidebarToggleHandler() {
  useAppCommandHandler("sidebar.toggle", () => {
    testState.calls.push("sidebar.toggle");
    return testState.sidebarHandlerResult;
  });
  return null;
}

function ThreadNavigationHandlers() {
  useAppCommandHandler("thread.previous", () => {
    testState.calls.push("thread.previous");
    return true;
  });
  useAppCommandHandler("thread.next", () => {
    testState.calls.push("thread.next");
    return true;
  });
  return null;
}

function ShortcutHintState() {
  return (
    <span>{useIsAppCommandModifierHeld() ? "hint-held" : "hint-released"}</span>
  );
}

function renderComposer(extra: React.ReactNode = null) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      keybindings: systemConfigData.keybindings.map((binding) =>
        binding.command === "sidebar.toggle"
          ? { ...binding, shortcut: testState.sidebarShortcut }
          : binding,
      ),
    }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppCommandProvider>
          <SidebarToggleHandler />
          {extra}
          <PromptBoxInternal
            value=""
            mentionRanges={[]}
            onChange={vi.fn()}
            onSubmit={vi.fn()}
            mentionMenuPlacement="bottom"
            typeahead={{
              mention: {
                suggestions: [],
                isLoading: false,
                isError: false,
                onQueryChange: vi.fn(),
              },
              command: inertTypeaheadCommandConfig,
            }}
          />
        </AppCommandProvider>
      </MemoryRouter>
    </QueryClientProvider>,
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
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "platform");
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

describe("prompt editor app shortcuts", () => {
  it.each([
    ["ArrowUp", "thread.previous"],
    ["ArrowDown", "thread.next"],
  ])("runs the configured Meta+Shift+%s app shortcut", (key, command) => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    const editor = renderComposer(<ThreadNavigationHandlers />);

    const event = pressInEditor(editor, {
      key,
      metaKey: true,
      shiftKey: true,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(testState.calls).toEqual([command]);
    expect(document.activeElement).toBe(editor);
  });

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
      shiftKey: true,
    });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
  });

  it("releases composer focus on Escape", () => {
    const editor = renderComposer();
    expect(document.activeElement).toBe(editor);

    pressInEditor(editor, { key: "Escape" });

    expect(document.activeElement).not.toBe(editor);
  });

  it("offers a declined chord to the handlers only once", () => {
    testState.sidebarHandlerResult = false;
    const editor = renderComposer();

    const event = pressInEditor(editor, { ctrlKey: true, key: "\\" });

    expect(testState.calls).toEqual(["sidebar.toggle"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("clears the keyboard hint when the composer runs a shortcut", () => {
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
