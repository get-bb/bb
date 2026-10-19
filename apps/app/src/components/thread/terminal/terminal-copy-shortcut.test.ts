// @vitest-environment jsdom

import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTerminalCopyShortcut } from "./terminal-copy-shortcut";

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    dispose();
  }
  vi.restoreAllMocks();
});

async function openTerminal() {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 9 }),
  } as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const terminal = new Terminal({ cols: 20, rows: 5 });
  const copy = vi.fn<(text: string) => void>();
  const sent: string[] = [];
  attachTerminalCopyShortcut({ copy, terminal });
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
    name: "a Latin layout",
    init: {
      code: "KeyC",
      ctrlKey: true,
      key: "C",
      keyCode: 67,
      shiftKey: true,
    },
  },
  {
    name: "a non-Latin layout",
    init: {
      code: "KeyC",
      ctrlKey: true,
      key: "С",
      keyCode: 67,
      shiftKey: true,
    },
  },
] as const;

describe("terminal copy shortcut", () => {
  it.each(COPY_CHORDS)(
    "copies the selection with Ctrl+Shift+C on $name without sending input",
    async ({ init }) => {
      const { copy, press, sent, terminal } = await openTerminal();
      terminal.select(0, 0, 5);

      const event = press(init);

      expect(copy).toHaveBeenCalledExactlyOnceWith("alpha");
      expect(event.defaultPrevented).toBe(true);
      expect(sent).toEqual([]);
    },
  );

  it("claims Ctrl+Shift+C without writing an empty selection", async () => {
    const { copy, press, sent } = await openTerminal();

    const event = press(COPY_CHORDS[0].init);

    expect(copy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
  });

  it("keeps Ctrl+C as an interrupt while text is selected", async () => {
    const { copy, press, sent, terminal } = await openTerminal();
    terminal.select(0, 0, 5);

    press({ code: "KeyC", ctrlKey: true, key: "c", keyCode: 67 });

    expect(sent).toEqual(["\x03"]);
    expect(copy).not.toHaveBeenCalled();
  });
});
