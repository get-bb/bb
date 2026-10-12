// @vitest-environment jsdom

import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTerminalClipboardShortcuts } from "./terminal-clipboard-shortcuts";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  vi.restoreAllMocks();
});

async function openTerminal(isMac: boolean) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const terminal = new Terminal({ cols: 20, rows: 5 });
  const copy = vi.fn<(text: string) => void>();
  const sent: string[] = [];
  attachTerminalClipboardShortcuts({ copy, isMac, terminal });
  terminal.onData((data) => sent.push(data));
  terminal.open(host);
  disposers.push(() => {
    terminal.dispose();
    host.remove();
  });
  await new Promise<void>((resolve) => {
    terminal.write("alpha bravo", resolve);
  });
  const textarea = terminal.textarea;
  if (textarea === undefined) {
    throw new Error("Expected xterm textarea");
  }
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    textarea.dispatchEvent(event);
    return event;
  };
  return { copy, press, sent, terminal };
}

const COPY_CHORDS = [
  {
    name: "Ctrl+Shift+C on Linux and Windows",
    isMac: false,
    init: {
      code: "KeyC",
      ctrlKey: true,
      key: "C",
      keyCode: 67,
      shiftKey: true,
    },
  },
  {
    name: "Cmd+C on macOS",
    isMac: true,
    init: { code: "KeyC", key: "c", keyCode: 67, metaKey: true },
  },
  {
    name: "Ctrl+Shift+C on a non-Latin layout",
    isMac: false,
    init: {
      code: "KeyC",
      ctrlKey: true,
      key: "С",
      keyCode: 67,
      shiftKey: true,
    },
  },
] as const;

const PASTE_CHORDS = [
  {
    name: "Ctrl+Shift+V on Linux and Windows",
    isMac: false,
    init: {
      code: "KeyV",
      ctrlKey: true,
      key: "V",
      keyCode: 86,
      shiftKey: true,
    },
  },
  {
    name: "Cmd+V on macOS",
    isMac: true,
    init: { code: "KeyV", key: "v", keyCode: 86, metaKey: true },
  },
] as const;

describe("terminal clipboard shortcuts", () => {
  it.each(COPY_CHORDS)(
    "copies the selection with $name without sending input",
    async ({ init, isMac }) => {
      const { copy, press, sent, terminal } = await openTerminal(isMac);
      terminal.select(0, 0, 5);

      const event = press(init);

      expect(copy).toHaveBeenCalledExactlyOnceWith("alpha");
      expect(event.defaultPrevented).toBe(true);
      expect(sent).toEqual([]);
    },
  );

  it("claims the copy shortcut without writing an empty selection", async () => {
    const { copy, press, sent } = await openTerminal(false);

    const event = press(COPY_CHORDS[0].init);

    expect(copy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
  });

  it.each([false, true])(
    "keeps Ctrl+C as an interrupt while text is selected (isMac: %s)",
    async (isMac) => {
      const { copy, press, sent, terminal } = await openTerminal(isMac);
      terminal.select(0, 0, 5);

      press({ code: "KeyC", ctrlKey: true, key: "c", keyCode: 67 });

      expect(sent).toEqual(["\x03"]);
      expect(copy).not.toHaveBeenCalled();
    },
  );

  it.each(PASTE_CHORDS)(
    "leaves $name to the browser paste action",
    async ({ init, isMac }) => {
      const { press, sent } = await openTerminal(isMac);

      const event = press(init);

      expect(event.defaultPrevented).toBe(false);
      expect(sent).toEqual([]);
    },
  );
});
