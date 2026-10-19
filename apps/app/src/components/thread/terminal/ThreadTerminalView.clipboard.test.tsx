// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { appToast } from "@/components/ui/app-toast";
import { makeTerminalSession } from "@/test/fixtures/terminal-sessions";
import { ThreadTerminalView } from "./ThreadTerminalView";

const preferences = vi.hoisted(() => ({ terminalCopyOnSelect: true }));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { generalSettings: preferences } }),
}));

vi.mock("@xterm/addon-webgl", () => {
  throw new Error("WebGL unavailable");
});

vi.mock("@bb/client-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@bb/client-core")>();
  return {
    ...original,
    TerminalWebSocketTransport: class {
      start() {}
      sendResize() {}
      setVisible() {}
      sendInput() {}
      dispose() {}
    },
  };
});

beforeEach(() => {
  preferences.terminalCopyOnSelect = true;
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountTerminal() {
  const terminals: Terminal[] = [];
  const open = Terminal.prototype.open;
  vi.spyOn(Terminal.prototype, "open").mockImplementation(function (
    this: Terminal,
    parent: HTMLElement,
  ) {
    terminals.push(this);
    open.call(this, parent);
  });
  const view = render(
    <ThreadTerminalView
      autoFocus={false}
      isPanelOpen
      session={makeTerminalSession({ status: "running" })}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector(".xterm-screen")).not.toBeNull(),
  );
  const mountedTerminal = terminals[0];
  if (mountedTerminal === undefined) {
    throw new Error("Expected a mounted terminal");
  }
  await act(
    () =>
      new Promise<void>((resolve) => {
        mountedTerminal.write("alpha bravo", resolve);
      }),
  );
  return { terminal: mountedTerminal, view };
}

describe("terminal clipboard interactions", () => {
  it("copies only the finished drag selection and shows one success notification", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const success = vi.spyOn(appToast, "success");
    const { terminal, view } = await mountTerminal();
    const terminalScreen = view.container.querySelector(".xterm-screen");
    if (terminalScreen === null) {
      throw new Error("Expected terminal screen");
    }

    fireEvent.pointerDown(terminalScreen, { clientX: 0, clientY: 0 });
    act(() => terminal.select(0, 0, 3));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(writeText).not.toHaveBeenCalled();
    act(() => terminal.select(0, 0, 5));
    fireEvent.pointerUp(terminalScreen, { clientX: 40, clientY: 0 });

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith("alpha"),
    );
    expect(success).toHaveBeenCalledExactlyOnceWith("Selection copied");
  });

  it("copies a drag selection released outside the terminal", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { terminal, view } = await mountTerminal();
    const terminalScreen = view.container.querySelector(".xterm-screen");
    if (terminalScreen === null) throw new Error("Expected terminal screen");
    fireEvent.pointerDown(terminalScreen, { clientX: 0, clientY: 0 });
    act(() => terminal.select(0, 0, 5));
    fireEvent.pointerUp(document.body, { clientX: 400, clientY: 0 });
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith("alpha"),
    );
  });

  it("does not copy selections or show notifications when disabled, while explicit Copy still works", async () => {
    preferences.terminalCopyOnSelect = false;
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const success = vi.spyOn(appToast, "success");
    const { terminal } = await mountTerminal();
    act(() => terminal.select(0, 0, 5));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(writeText).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    if (!terminal.textarea) throw new Error("Expected terminal textarea");
    fireEvent.keyDown(terminal.textarea, {
      key: "c",
      keyCode: 67,
      ctrlKey: true,
      shiftKey: true,
    });
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith("alpha"),
    );
  });

  it("applies preference changes to an existing terminal without remounting", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { terminal, view } = await mountTerminal();
    preferences.terminalCopyOnSelect = false;
    view.rerender(
      <ThreadTerminalView
        autoFocus={false}
        isPanelOpen
        session={makeTerminalSession({ status: "running" })}
      />,
    );
    act(() => terminal.select(0, 0, 5));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(writeText).not.toHaveBeenCalled();
    preferences.terminalCopyOnSelect = true;
    view.rerender(
      <ThreadTerminalView
        autoFocus={false}
        isPanelOpen
        session={makeTerminalSession({ status: "running" })}
      />,
    );
    act(() => terminal.select(6, 0, 5));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledExactlyOnceWith("bravo"),
    );
    expect(Terminal.prototype.open).toHaveBeenCalledTimes(1);
  });

  it("does not auto-copy selected text outside the terminal", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await mountTerminal();
    const prose = render(<p>Message text outside the terminal</p>);
    const paragraph = prose.getByText("Message text outside the terminal");
    document.getSelection()?.selectAllChildren(paragraph);
    fireEvent.pointerUp(paragraph, { button: 0 });
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(writeText).not.toHaveBeenCalled();
    document.getSelection()?.removeAllRanges();
  });

  it.each([true, false])(
    "leaves middle-click primary-selection paste native with copy-on-select=%s",
    async (enabled) => {
      preferences.terminalCopyOnSelect = enabled;
      const readText = vi.fn().mockResolvedValue("unrelated clipboard");
      const writeText = vi.fn();
      vi.stubGlobal("navigator", { clipboard: { readText, writeText } });
      const { terminal, view } = await mountTerminal();
      const onData = vi.fn();
      terminal.onData(onData);
      const terminalScreen = view.container.querySelector(".xterm-screen");
      if (terminalScreen === null || !terminal.textarea)
        throw new Error("Expected terminal screen and textarea");
      const textarea = terminal.textarea;
      textarea.blur();
      expect(fireEvent.pointerDown(terminalScreen, { button: 1 })).toBe(true);
      expect(document.activeElement).toBe(textarea);
      expect(fireEvent.pointerUp(terminalScreen, { button: 1 })).toBe(true);
      expect(
        fireEvent(
          terminalScreen,
          new MouseEvent("auxclick", {
            button: 1,
            bubbles: true,
            cancelable: true,
          }),
        ),
      ).toBe(true);
      fireEvent.paste(textarea, {
        clipboardData: { getData: () => "primary selection\n" },
      });
      await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      expect(onData).toHaveBeenCalledExactlyOnceWith("primary selection\r");
      expect(readText).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it("offers Paste on an unselected terminal and reads the clipboard", async () => {
    const readText = vi.fn().mockResolvedValue("echo hello");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const { terminal, view } = await mountTerminal();
    const paste = vi.spyOn(terminal, "paste");
    const terminalScreen = view.container.querySelector(".xterm-screen");
    if (terminalScreen === null) {
      throw new Error("Expected terminal screen");
    }

    fireEvent.contextMenu(terminalScreen);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Paste" }));

    await waitFor(() =>
      expect(paste).toHaveBeenCalledExactlyOnceWith("echo hello"),
    );
    expect(readText).toHaveBeenCalledOnce();
  });
});
