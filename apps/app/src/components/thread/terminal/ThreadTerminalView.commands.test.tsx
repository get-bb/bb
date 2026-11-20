// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import {
  AppCommandProvider,
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { ThreadTerminalView } from "./ThreadTerminalView";

const state = vi.hoisted(() => ({
  input: vi.fn(),
  acknowledged: vi.fn(),
  onMessage: null as ((message: unknown) => void) | null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { terminalCopyOnSelect: true } },
  }),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast: vi.fn(async () => true),
}));

vi.mock("@/hooks/usePluginCommandBindings", () => {
  const binding = (
    command: string,
    key: string,
    modifiers: { shift?: boolean },
    when: { all: string[]; none: string[] },
  ) => ({
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: true,
      meta: false,
      control: false,
      alt: false,
      shift: modifiers.shift ?? false,
    },
    when,
  });
  const main = { all: ["mainSurface"], none: ["modalOpen"] };
  const exact = (
    command: string,
    key: string,
    modifiers: { control?: boolean; alt?: boolean; shift?: boolean },
  ) => ({
    command,
    desktopOnly: false,
    shortcut: {
      key,
      mod: false,
      meta: false,
      control: modifiers.control ?? false,
      alt: modifiers.alt ?? false,
      shift: modifiers.shift ?? false,
    },
    when: main,
  });
  const defaults = [
    exact("sidebar.toggle", "F5", {}),
    exact("notifications.open", "n", { alt: true, shift: true }),
    exact("thread.rename", "1", { control: true, alt: true }),
    exact("thread.archive", "3", { control: true }),
    exact("panel.fullScreen.toggle", "j", { control: true }),
    exact("thread.pin", "c", { control: true }),
    exact("thread.markRead", "[", { control: true }),
    exact("app.back", "Escape", {}),
    binding("thread.search", "k", {}, main),
    binding("panel.close", "w", {}, main),
    binding(
      "terminal.find",
      "f",
      {},
      {
        all: ["mainSurface", "terminalFocus", "macPlatform"],
        none: ["modalOpen"],
      },
    ),
    binding(
      "terminal.find",
      "f",
      { shift: true },
      {
        all: ["mainSurface", "terminalFocus"],
        none: ["modalOpen", "macPlatform"],
      },
    ),
  ];
  return {
    usePluginCommandBindings: () => ({ keybindings: defaults, defaults }),
  };
});

vi.mock("@xterm/addon-webgl", () => {
  throw new Error("WebGL unavailable");
});

vi.mock("@bb/client-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/client-core")>()),
  TerminalWebSocketTransport: class {
    constructor(options: { onMessage: (message: unknown) => void }) {
      state.onMessage = options.onMessage;
    }
    sendInput = state.input;
    sendResize() {}
    setVisible() {}
    start() {}
    dispose() {}
    acknowledgeOutput = state.acknowledged;
  },
}));

const appCommands = vi.hoisted(() => ({
  threadSearch: vi.fn(() => true),
  panelClose: vi.fn(() => true),
  ran: [] as string[],
}));

const BOUND_COMMANDS = [
  "sidebar.toggle",
  "notifications.open",
  "thread.rename",
  "thread.archive",
  "panel.fullScreen.toggle",
  "thread.pin",
  "thread.markRead",
  "app.back",
] as const;

function AppCommandSpies() {
  useAppCommandHandler("thread.search", appCommands.threadSearch);
  useAppCommandHandler("panel.close", appCommands.panelClose);
  useIndexedAppCommandHandlers(BOUND_COMMANDS, (index) => {
    appCommands.ran.push(BOUND_COMMANDS[index]!);
    return true;
  });
  return null;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(copyToClipboardWithToast).mockClear();
  appCommands.threadSearch.mockClear();
  appCommands.panelClose.mockClear();
  appCommands.ran.length = 0;
  state.input.mockClear();
  state.acknowledged.mockClear();
  state.onMessage = null;
});

async function writeOutput(seq: number, text: string) {
  await act(async () => {
    state.onMessage?.({
      type: "output",
      chunk: { seq, dataBase64: btoa(text) },
    });
  });
  await waitFor(() =>
    expect(state.acknowledged).toHaveBeenLastCalledWith(seq + 1),
  );
}

async function mount() {
  const view = render(
    <AppCommandProvider>
      <AppCommandSpies />
      <ThreadTerminalView
        autoFocus
        isPanelOpen
        session={makeTerminalSession({ status: "running" })}
      />
    </AppCommandProvider>,
  );
  const textarea = await waitFor(() => {
    const element = view.container.querySelector<HTMLTextAreaElement>(
      ".xterm-helper-textarea",
    );
    expect(element).not.toBeNull();
    return element!;
  });
  await waitFor(() => expect(state.onMessage).not.toBeNull());
  await writeOutput(0, "needle first\r\nother\r\nneedle last\r\n");
  await writeOutput(1, "filler\r\n".repeat(60));
  textarea.focus();
  return { textarea };
}

it("finds scrollback without copying matches, navigates them, and returns focus on Escape", async () => {
  const select = vi.spyOn(Terminal.prototype, "select");
  const { textarea } = await mount();
  fireEvent.keyDown(textarea, { key: "f", metaKey: true, keyCode: 70 });
  const input = await screen.findByRole("textbox", {
    name: "Find in terminal",
  });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "needle" } });
  const terminal = select.mock.contexts.at(-1);
  if (!(terminal instanceof Terminal)) {
    throw new Error("Expected a terminal selection");
  }
  expect(terminal.getSelection()).toBe("needle");
  const first = terminal.getSelectionPosition();
  expect(first?.start.y).toBeLessThan(terminal.buffer.active.baseY);
  expect(screen.getByRole("status").textContent).toBe("1 of 2");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(terminal.getSelectionPosition()).not.toEqual(first);
  expect(screen.getByRole("status").textContent).toBe("2 of 2");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(terminal.getSelectionPosition()).toEqual(first);
  fireEvent.click(screen.getByRole("button", { name: "Match case" }));
  fireEvent.change(input, { target: { value: "NEEDLE" } });
  expect(screen.getByText("No results")).toBeTruthy();
  await act(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
  );
  expect(copyToClipboardWithToast).not.toHaveBeenCalled();
  expect(state.input).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("search")).toBeNull();
  expect(document.activeElement).toBe(textarea);
  expect(terminal.getSelection()).toBe("");
});

it("leaves Ctrl+letter shell keys to the shell on Linux and finds with Ctrl+Shift+F", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  const { textarea } = await mount();
  fireEvent.keyDown(textarea, { key: "k", ctrlKey: true, keyCode: 75 });
  fireEvent.keyDown(textarea, { key: "w", ctrlKey: true, keyCode: 87 });
  fireEvent.keyDown(textarea, { key: "f", ctrlKey: true, keyCode: 70 });
  expect(state.input.mock.calls.map(([data]) => atob(data))).toEqual([
    "\x0b",
    "\x17",
    "\x06",
  ]);
  expect(appCommands.threadSearch).not.toHaveBeenCalled();
  expect(appCommands.panelClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("search")).toBeNull();
  fireEvent.keyDown(textarea, {
    key: "F",
    ctrlKey: true,
    shiftKey: true,
    keyCode: 70,
  });
  expect(await screen.findByRole("textbox", { name: "Find in terminal" })).toBe(
    document.activeElement,
  );
  expect(state.input).toHaveBeenCalledTimes(3);
});

const APP_COMMAND_KEYS = [
  {
    init: { key: "F5", code: "F5", keyCode: 116 },
    command: "sidebar.toggle",
  },
  {
    init: { key: "N", code: "KeyN", altKey: true, shiftKey: true, keyCode: 78 },
    command: "notifications.open",
  },
  {
    init: {
      key: "1",
      code: "Digit1",
      ctrlKey: true,
      altKey: true,
      keyCode: 49,
    },
    command: "thread.rename",
  },
  {
    init: { key: "3", code: "Digit3", ctrlKey: true, keyCode: 51 },
    command: "thread.archive",
  },
] as const;

const SHELL_KEYS = [
  { init: { key: "j", code: "KeyJ", ctrlKey: true, keyCode: 74 }, data: "\n" },
  {
    init: { key: "c", code: "KeyC", ctrlKey: true, keyCode: 67 },
    data: "\x03",
  },
  {
    init: { key: "[", code: "BracketLeft", ctrlKey: true, keyCode: 219 },
    data: "\x1b",
  },
  { init: { key: "Escape", code: "Escape", keyCode: 27 }, data: "\x1b" },
] as const;

it.each(["MacIntel", "Linux x86_64"])(
  "on %s, runs bound commands from a focused terminal but leaves shell keys to the shell",
  async (platform) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    const { textarea } = await mount();
    for (const { init, command } of APP_COMMAND_KEYS) {
      appCommands.ran.length = 0;
      fireEvent.keyDown(textarea, init);
      expect({ key: init.key, ran: appCommands.ran }).toEqual({
        key: init.key,
        ran: [command],
      });
    }
    expect(state.input).not.toHaveBeenCalled();
    appCommands.ran.length = 0;
    for (const { init } of SHELL_KEYS) {
      fireEvent.keyDown(textarea, init);
    }
    expect(appCommands.ran).toEqual([]);
    expect(state.input.mock.calls.map(([data]) => atob(data))).toEqual(
      SHELL_KEYS.map(({ data }) => data),
    );
  },
);

it("keeps a held command key's repeats out of the shell", async () => {
  const { textarea } = await mount();
  const f5 = { key: "F5", code: "F5", keyCode: 116 };
  fireEvent.keyDown(textarea, f5);
  const repeatsReachedPage = [
    fireEvent.keyDown(textarea, { ...f5, repeat: true }),
    fireEvent.keyDown(textarea, { ...f5, repeat: true }),
  ];
  fireEvent.keyUp(textarea, f5);
  expect(appCommands.ran).toEqual(["sidebar.toggle"]);
  expect(repeatsReachedPage).toEqual([false, false]);
  expect(state.input).not.toHaveBeenCalled();

  const escape = { key: "Escape", code: "Escape", keyCode: 27 };
  fireEvent.keyDown(textarea, escape);
  fireEvent.keyDown(textarea, { ...escape, repeat: true });
  expect(appCommands.ran).toEqual(["sidebar.toggle"]);
  expect(state.input.mock.calls.map(([data]) => atob(data))).toEqual([
    "\x1b",
    "\x1b",
  ]);
});
