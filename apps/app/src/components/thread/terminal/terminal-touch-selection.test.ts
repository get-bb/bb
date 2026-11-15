import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  terminalCellFromClientPoint,
  terminalEdgeScrollDirection,
  terminalSelectionForDrag,
  terminalWordRangeAt,
} from "./terminal-touch-selection";

function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

describe("terminal touch selection", () => {
  it("maps a touch point to the buffer cell under it, offset by scrollback", () => {
    const geometry = {
      cols: 10,
      rows: 5,
      screenRect: { left: 20, top: 40, width: 100, height: 100 },
      viewportY: 30,
    };
    expect(terminalCellFromClientPoint({ x: 55, y: 65 }, geometry)).toEqual({
      col: 3,
      row: 31,
    });
    expect(terminalCellFromClientPoint({ x: 0, y: 500 }, geometry)).toEqual({
      col: 0,
      row: 34,
    });
  });

  it("scrolls while the finger is within a row of the top or bottom edge", () => {
    const geometry = {
      cols: 10,
      rows: 5,
      screenRect: { left: 0, top: 100, width: 100, height: 100 },
      viewportY: 0,
    };
    expect(terminalEdgeScrollDirection(90, geometry)).toBe(-1);
    expect(terminalEdgeScrollDirection(110, geometry)).toBe(-1);
    expect(terminalEdgeScrollDirection(150, geometry)).toBe(0);
    expect(terminalEdgeScrollDirection(185, geometry)).toBe(1);
    expect(terminalEdgeScrollDirection(400, geometry)).toBe(1);
  });

  it("expands a long press to the whole word, including wide characters", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 20 });
    try {
      await writeTerminal(terminal, "ls src/中文.ts  ok");
      const buffer = terminal.buffer.active;
      expect(terminalWordRangeAt(buffer, 20, { col: 6, row: 0 })).toEqual({
        start: { col: 3, row: 0 },
        end: { col: 13, row: 0 },
      });
      expect(terminalWordRangeAt(buffer, 20, { col: 14, row: 0 })).toEqual({
        start: { col: 14, row: 0 },
        end: { col: 14, row: 0 },
      });
    } finally {
      terminal.dispose();
    }
  });

  it("selects the words between the long-pressed word and the finger", async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 10 });
    try {
      await writeTerminal(terminal, "alpha beta\r\ngamma");
      const word = terminalWordRangeAt(terminal.buffer.active, 10, {
        col: 7,
        row: 0,
      });

      expect(terminalSelectionForDrag(word, { col: 4, row: 1 }, 10)).toEqual({
        column: 6,
        row: 0,
        length: 9,
      });
      expect(terminalSelectionForDrag(word, { col: 0, row: 0 }, 10)).toEqual({
        column: 0,
        row: 0,
        length: 10,
      });
      expect(terminalSelectionForDrag(word, { col: 8, row: 0 }, 10)).toEqual({
        column: 6,
        row: 0,
        length: 4,
      });
    } finally {
      terminal.dispose();
    }
  });
});
