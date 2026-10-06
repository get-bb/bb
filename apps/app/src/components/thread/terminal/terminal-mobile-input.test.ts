import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  applyTerminalControl,
  encodeTerminalArrow,
} from "./terminal-mobile-input";

describe("mobile terminal input", () => {
  it("sends cursor keys in the mode requested by the running application", async () => {
    const terminal = new Terminal({ allowProposedApi: true });
    const input: string[] = [];
    terminal.onData((data) => input.push(data));
    try {
      terminal.input(
        encodeTerminalArrow("down", terminal.modes.applicationCursorKeysMode),
      );
      await new Promise<void>((resolve) => terminal.write("\x1b[?1h", resolve));
      terminal.input(
        encodeTerminalArrow("down", terminal.modes.applicationCursorKeysMode),
      );
      await new Promise<void>((resolve) => terminal.write("\x1b[?1l", resolve));
      terminal.input(
        encodeTerminalArrow("up", terminal.modes.applicationCursorKeysMode),
      );
      expect(input).toEqual(["\x1b[B", "\x1bOB", "\x1b[A"]);
    } finally {
      terminal.dispose();
    }
  });

  it("encodes interrupt and EOF from either letter case", () => {
    expect(applyTerminalControl("c")).toBe("\x03");
    expect(applyTerminalControl("C")).toBe("\x03");
    expect(applyTerminalControl("d")).toBe("\x04");
    expect(applyTerminalControl("?")).toBe("\x7f");
  });

  it("preserves committed IME text, paste, and existing key sequences", () => {
    for (const text of [
      "你好",
      "한",
      "é",
      "😀",
      "git status",
      "\x1b[A",
      "\r",
    ]) {
      expect(applyTerminalControl(text)).toBe(text);
    }
  });
});
