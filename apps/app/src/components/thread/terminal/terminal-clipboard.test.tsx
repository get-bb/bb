// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import {
  createTerminalClipboardKeyHandler,
  createTerminalSelectionClipboardHandler,
  pasteTerminalClipboard,
} from "./terminal-clipboard";

let terminal: Terminal;
let host: HTMLDivElement;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  host = document.createElement("div");
  document.body.append(host);
  terminal = new Terminal({ cols: 40, rows: 5 });
  terminal.open(host);
});

afterEach(() => {
  terminal.dispose();
  host.remove();
  vi.restoreAllMocks();
});

function textarea(): HTMLTextAreaElement {
  if (!terminal.textarea) {
    throw new Error("Expected terminal textarea");
  }
  return terminal.textarea;
}

function write(text: string): Promise<void> {
  return new Promise((resolve) => terminal.write(text, resolve));
}

function attachClipboardHandler() {
  const copy = vi.fn();
  const paste = vi.fn();
  terminal.attachCustomKeyEventHandler(
    createTerminalClipboardKeyHandler({ terminal, copy, paste }),
  );
  return { copy, paste };
}

describe("terminal clipboard shortcuts", () => {
  it.each([
    { ctrlKey: true, shiftKey: true },
    { ctrlKey: true, shiftKey: true, key: "С", code: "KeyC" },
    { metaKey: true },
  ])(
    "copies the exact selection without sending input: %j",
    async (modifiers) => {
      const { copy } = attachClipboardHandler();
      const onData = vi.fn();
      terminal.onData(onData);
      await write("  alpha  ");
      terminal.select(0, 0, 9);

      fireEvent.keyDown(textarea(), { key: "c", keyCode: 67, ...modifiers });
      fireEvent.keyUp(textarea(), { key: "c", keyCode: 67, ...modifiers });

      expect(copy).toHaveBeenCalledExactlyOnceWith("  alpha  ");
      expect(onData).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "keeps Ctrl+C as an interrupt with selection=%s",
    async (selected) => {
      const { copy } = attachClipboardHandler();
      const onData = vi.fn();
      terminal.onData(onData);

      if (selected) {
        await write("alpha");
        terminal.select(0, 0, 5);
      }
      fireEvent.keyDown(textarea(), { key: "c", keyCode: 67, ctrlKey: true });

      expect(onData).toHaveBeenCalledExactlyOnceWith("\x03");
      expect(copy).not.toHaveBeenCalled();
    },
  );

  it("does not turn Ctrl+Shift+C without a selection into an interrupt", () => {
    const { copy } = attachClipboardHandler();
    const onData = vi.fn();
    terminal.onData(onData);

    fireEvent.keyDown(textarea(), {
      key: "C",
      keyCode: 67,
      ctrlKey: true,
      shiftKey: true,
    });

    expect(copy).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "allows native paste once, with bracketed-paste protection: %j",
    async (modifiers) => {
      const { paste } = attachClipboardHandler();
      const onData = vi.fn();
      terminal.onData(onData);
      await write("\x1b[?2004h");

      const allowed = fireEvent.keyDown(textarea(), {
        key: "v",
        keyCode: 86,
        ...modifiers,
      });
      expect(allowed).toBe(true);
      expect(onData).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();

      fireEvent.paste(textarea(), {
        clipboardData: { getData: () => "echo café\nnext" },
      });

      expect(onData).toHaveBeenCalledExactlyOnceWith(
        "\x1b[200~echo café\rnext\x1b[201~",
      );
    },
  );

  it.each([
    { key: "V", code: "KeyV" },
    { key: "М", code: "KeyV" },
  ])(
    "requests shifted paste only on keydown, not repeats or keyup: %j",
    ({ key, code }) => {
      const { paste } = attachClipboardHandler();
      const onData = vi.fn();
      terminal.onData(onData);
      const event = {
        key,
        code,
        keyCode: 86,
        ctrlKey: true,
        shiftKey: true,
      };

      expect(fireEvent.keyDown(textarea(), event)).toBe(false);
      fireEvent.keyDown(textarea(), { ...event, repeat: true });
      fireEvent.keyUp(textarea(), event);

      expect(paste).toHaveBeenCalledOnce();
      expect(onData).not.toHaveBeenCalled();
    },
  );

  it.each([{ altKey: true }, { isComposing: true }])(
    "does not claim composition or Alt-modified shortcuts: %j",
    (modifiers) => {
      const copy = vi.fn();
      const paste = vi.fn();
      const handler = createTerminalClipboardKeyHandler({
        terminal,
        copy,
        paste,
      });
      const event = new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: true,
        shiftKey: true,
        ...modifiers,
      });

      expect(handler(event)).toBe(true);
      expect(copy).not.toHaveBeenCalled();
      expect(paste).not.toHaveBeenCalled();
    },
  );
});

describe("terminal selection auto-copy", () => {
  it("copies the exact completed selection once across duplicate reports", async () => {
    const copy = vi.fn();
    const reportSelection = createTerminalSelectionClipboardHandler(copy);
    await write("  café  ");
    terminal.select(0, 0, 8);

    reportSelection(terminal.getSelection());
    reportSelection(terminal.getSelection());

    expect(copy).toHaveBeenCalledExactlyOnceWith("  café  ");
  });

  it("copies changed and reselected text, but does not overwrite on deselection", () => {
    const copy = vi.fn();
    const reportSelection = createTerminalSelectionClipboardHandler(copy);

    reportSelection("");
    reportSelection("first\nsecond");
    reportSelection("changed");
    reportSelection("");
    reportSelection("changed");

    expect(copy.mock.calls).toEqual([
      ["first\nsecond"],
      ["changed"],
      ["changed"],
    ]);
  });

  it("copies whitespace-only selections without trimming", () => {
    const copy = vi.fn();
    const reportSelection = createTerminalSelectionClipboardHandler(copy);

    reportSelection("  \n  ");

    expect(copy).toHaveBeenCalledExactlyOnceWith("  \n  ");
  });
});

describe("terminal clipboard reads", () => {
  it("uses xterm paste to normalize newlines and bracket multiline input", async () => {
    const onData = vi.fn();
    terminal.onData(onData);
    await write("\x1b[?2004h");
    const focus = vi.spyOn(terminal, "focus");

    await pasteTerminalClipboard({
      terminal,
      readText: async () => "  café\r\nnext\n",
      isActive: () => true,
    });

    expect(focus).toHaveBeenCalledOnce();
    expect(onData).toHaveBeenCalledExactlyOnceWith(
      "\x1b[200~  café\rnext\r\x1b[201~",
    );
  });

  it("does not paste into a closed or replaced terminal after a pending read", async () => {
    const onData = vi.fn();
    terminal.onData(onData);
    const focus = vi.spyOn(terminal, "focus");
    let active = true;
    let resolveRead = (_text: string) => {};
    const pending = pasteTerminalClipboard({
      terminal,
      readText: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      isActive: () => active,
    });
    active = false;
    resolveRead("stale clipboard");
    await pending;

    expect(focus).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
  });

  it("propagates denied clipboard access without sending input", async () => {
    const onData = vi.fn();
    terminal.onData(onData);

    await expect(
      pasteTerminalClipboard({
        terminal,
        readText: async () => {
          throw new Error("Permission denied");
        },
        isActive: () => true,
      }),
    ).rejects.toThrow("Permission denied");

    expect(onData).not.toHaveBeenCalled();
  });
});
