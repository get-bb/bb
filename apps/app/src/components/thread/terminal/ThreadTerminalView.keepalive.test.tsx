// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import {
  applyTerminalSessionClose,
  applyTerminalSessionMissing,
} from "@/hooks/cache-owners/terminal-cache-owner";
import { applyAppThemeCss } from "@/lib/themes";
import { QueryClient } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import { ThreadTerminalView } from "./ThreadTerminalView";

const state = vi.hoisted(() => ({
  dispatchAppCommandKey: vi.fn<(event: KeyboardEvent) => boolean>(() => false),
  transports: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    onMessage: (message: unknown) => void;
    setVisible: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    suspend: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: { generalSettings: { terminalCopyOnSelect: false } },
  }),
}));

vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/commands/AppCommandProvider")
  >()),
  useAppCommandKeyDispatch: () => state.dispatchAppCommandKey,
}));

vi.mock("@xterm/addon-webgl", () => {
  throw new Error("WebGL unavailable");
});

vi.mock("@bb/client-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/client-core")>()),
  TerminalWebSocketTransport: class {
    dispose = vi.fn();
    setVisible = vi.fn();
    start = vi.fn();
    suspend = vi.fn();
    onMessage: (message: unknown) => void;
    constructor(options: { onMessage: (message: unknown) => void }) {
      this.onMessage = options.onMessage;
      state.transports.push(this);
    }
    acknowledgeOutput() {}
    sendInput() {}
    sendResize() {}
  },
}));

const session = makeTerminalSession({ status: "running" });

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  applyTerminalSessionMissing({
    queryClient: new QueryClient(),
    terminalId: session.id,
  });
  vi.restoreAllMocks();
  state.dispatchAppCommandKey = vi.fn(() => false);
  state.transports = [];
});

function renderTerminal(keepAlive: boolean) {
  return render(
    <ThreadTerminalView
      autoFocus={false}
      isPanelOpen
      keepAlive={keepAlive}
      session={session}
    />,
  );
}

function nextFrame(): Promise<void> {
  return act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

async function mountTerminal(keepAlive: boolean) {
  const view = renderTerminal(keepAlive);
  const xterm = await waitFor(() => {
    const element = view.container.querySelector(".xterm");
    expect(element).not.toBeNull();
    return element!;
  });
  return { view, xterm };
}

function captureOpenedTerminals(): Terminal[] {
  const opened: Terminal[] = [];
  const open = Terminal.prototype.open;
  vi.spyOn(Terminal.prototype, "open").mockImplementation(function (
    this: Terminal,
    parent: HTMLElement,
  ) {
    opened.push(this);
    open.call(this, parent);
  });
  return opened;
}

it("closes the socket of a parked terminal and resumes it when the same session remounts", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  expect(transport.start).toHaveBeenCalledTimes(1);
  first.view.unmount();
  expect(transport.suspend).toHaveBeenCalledTimes(1);
  expect(transport.dispose).not.toHaveBeenCalled();
  const second = renderTerminal(true);
  await nextFrame();
  expect(second.container.querySelector(".xterm")).toBe(first.xterm);
  expect(state.transports).toHaveLength(1);
  expect(transport.start).toHaveBeenCalledTimes(2);
  expect(transport.setVisible).toHaveBeenLastCalledWith(true);
  expect(transport.dispose).not.toHaveBeenCalled();
});

it("attaches a remounted parked terminal in the next animation frame, not in the React commit", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  first.view.unmount();
  const second = renderTerminal(true);
  expect(second.container.querySelector(".xterm")).toBeNull();
  expect(transport.start).toHaveBeenCalledTimes(1);
  await nextFrame();
  expect(second.container.querySelector(".xterm")).toBe(first.xterm);
  expect(transport.start).toHaveBeenCalledTimes(2);
});

it("keeps a terminal parked when its view unmounts before the attach frame", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  first.view.unmount();
  renderTerminal(true).unmount();
  await nextFrame();
  expect(transport.dispose).not.toHaveBeenCalled();
  expect(transport.start).toHaveBeenCalledTimes(1);
  const third = renderTerminal(true);
  await nextFrame();
  expect(third.container.querySelector(".xterm")).toBe(first.xterm);
  expect(state.transports).toHaveLength(1);
  expect(transport.start).toHaveBeenCalledTimes(2);
});

it("sends app command keys of a remounted parked terminal to the new view", async () => {
  const parkedDispatch = vi.fn<(event: KeyboardEvent) => boolean>(() => true);
  state.dispatchAppCommandKey = parkedDispatch;
  const first = await mountTerminal(true);
  first.view.unmount();
  const dispatch = vi.fn<(event: KeyboardEvent) => boolean>(() => true);
  state.dispatchAppCommandKey = dispatch;
  const second = renderTerminal(true);
  await nextFrame();
  const textarea = second.container.querySelector<HTMLTextAreaElement>(
    ".xterm-helper-textarea",
  );
  expect(textarea).not.toBeNull();
  fireEvent.keyDown(textarea!, { key: "F5", code: "F5", keyCode: 116 });
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(parkedDispatch).not.toHaveBeenCalled();
});

it("keeps the selection of a parked terminal when the same session remounts", async () => {
  const opened = captureOpenedTerminals();
  const first = await mountTerminal(true);
  const terminal = opened[0]!;
  await new Promise<void>((resolve) => terminal.write("hello", resolve));
  terminal.select(0, 0, 5);
  expect(terminal.getSelection()).toBe("hello");
  first.view.unmount();
  renderTerminal(true);
  await nextFrame();
  expect(opened).toHaveLength(1);
  expect(terminal.getSelection()).toBe("hello");
});

it("does not rebuild the theme of a parked terminal when it remounts with the same theme", async () => {
  const opened = captureOpenedTerminals();
  const first = await mountTerminal(true);
  const terminal = opened[0]!;
  const theme = terminal.options.theme;
  first.view.unmount();
  const computedStyle = vi.spyOn(window, "getComputedStyle");
  renderTerminal(true);
  await nextFrame();
  expect(terminal.options.theme).toBe(theme);
  expect(
    computedStyle.mock.calls.some(
      ([element]) => element === document.documentElement,
    ),
  ).toBe(false);
});

it("applies a theme change made while the terminal was parked when it remounts", async () => {
  const opened = captureOpenedTerminals();
  const first = await mountTerminal(true);
  const terminal = opened[0]!;
  first.view.unmount();
  document.documentElement.style.setProperty("--sidebar", "rgb(1, 2, 3)");
  try {
    applyAppThemeCss(":root { --parked-theme-change: 1; }");
    renderTerminal(true);
    await waitFor(() =>
      expect(terminal.options.theme?.background).toBe("rgb(1, 2, 3)"),
    );
  } finally {
    document.documentElement.style.removeProperty("--sidebar");
    applyAppThemeCss("");
  }
});

function installFontSet() {
  const listeners = new Set<() => void>();
  const fontSet = {
    readReads: 0,
    get ready() {
      fontSet.readReads += 1;
      return Promise.resolve();
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    finishLoading: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: fontSet,
  });
  return fontSet;
}

it("does not read document.fonts.ready again when a parked terminal remounts", async () => {
  const fontSet = installFontSet();
  try {
    const first = await mountTerminal(true);
    expect(fontSet.readReads).toBe(1);
    first.view.unmount();
    renderTerminal(true);
    await nextFrame();
    expect(fontSet.readReads).toBe(1);
  } finally {
    Reflect.deleteProperty(document, "fonts");
  }
});

it("measures the font again on remount when fonts loaded while the terminal was parked", async () => {
  const fontSet = installFontSet();
  try {
    const first = await mountTerminal(true);
    await act(async () => {});
    first.view.unmount();
    fontSet.finishLoading();
    const clearTextureAtlas = vi.spyOn(Terminal.prototype, "clearTextureAtlas");
    expect(clearTextureAtlas).not.toHaveBeenCalled();
    renderTerminal(true);
    await nextFrame();
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.deleteProperty(document, "fonts");
  }
});

it("disposes a parked terminal that closes as exited and creates a new one on return", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  first.view.unmount();
  act(() => {
    applyTerminalSessionClose({
      queryClient: new QueryClient(),
      session: { ...session, status: "exited", exitCode: 0 },
      terminalId: session.id,
    });
  });
  expect(transport.dispose).toHaveBeenCalledTimes(1);
  await mountTerminal(true);
  expect(state.transports).toHaveLength(2);
});

it("does not park a terminal that exited while it was shown", async () => {
  const first = await mountTerminal(true);
  const transport = state.transports[0]!;
  act(() => {
    transport.onMessage({
      type: "exited",
      session: { ...session, status: "exited", exitCode: 0 },
    });
  });
  first.view.unmount();
  expect(transport.suspend).not.toHaveBeenCalled();
  expect(transport.dispose).toHaveBeenCalledTimes(1);
});

it("disposes the terminal on unmount without keepAlive", async () => {
  const first = await mountTerminal(false);
  first.view.unmount();
  expect(state.transports[0]!.dispose).toHaveBeenCalledTimes(1);
  await mountTerminal(true);
  expect(state.transports).toHaveLength(2);
});

it("never parks a terminal unmounted before its async mount finishes", async () => {
  renderTerminal(true).unmount();
  await mountTerminal(true);
  expect(state.transports).toHaveLength(1);
  expect(state.transports[0]!.dispose).not.toHaveBeenCalled();
});
