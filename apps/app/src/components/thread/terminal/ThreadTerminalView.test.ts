import { describe, expect, it, vi } from "vitest";
import {
  buildTerminalThemeFromCssColors,
  createTerminalOutputWriteState,
  getFittedTerminalDimensions,
  isTerminalReplayCompleteMessage,
  resolveTerminalFontFamily,
  resolveTerminalReplayDimensions,
  writeTerminalOutput,
} from "./ThreadTerminalView";

describe("buildTerminalThemeFromCssColors", () => {
  it("paints the terminal canvas and cursor cutout with the sidebar surface", () => {
    const get = vi.fn((name: string) => name);

    const theme = buildTerminalThemeFromCssColors(get);

    expect(theme.background).toBe("--sidebar");
    expect(theme.cursorAccent).toBe("--sidebar");
  });
});

describe("terminal font family", () => {
  it("uses the buffer font when one is configured", () => {
    expect(resolveTerminalFontFamily('"Berkeley Mono", monospace')).toBe(
      '"Berkeley Mono", monospace',
    );
  });

  it("keeps the existing terminal fallback when the preference is empty", () => {
    expect(resolveTerminalFontFamily("   ")).toContain("ui-monospace");
  });

  it("uses the same normalisation as other buffer surfaces", () => {
    expect(resolveTerminalFontFamily('"Berkeley Mono";\n monospace')).toBe(
      '"Berkeley Mono" monospace',
    );
  });
});

describe("terminal replay sizing", () => {
  it("reserves two fitted rows below the terminal output", () => {
    expect(getFittedTerminalDimensions({ cols: 83, rows: 43 })).toEqual({
      cols: 83,
      rows: 41,
    });
    expect(getFittedTerminalDimensions({ cols: 10, rows: 1 })).toEqual({
      cols: 10,
      rows: 1,
    });
  });

  it("uses the historical terminal default for chunks without dimensions", () => {
    expect(resolveTerminalReplayDimensions(undefined)).toEqual({
      cols: 100,
      rows: 30,
    });
    expect(resolveTerminalReplayDimensions({ cols: 77, rows: 39 })).toEqual({
      cols: 77,
      rows: 39,
    });
  });

  it("waits for the final replay write before fitting the terminal", () => {
    expect(
      isTerminalReplayCompleteMessage({
        message: { type: "attached", nextSeq: 3 },
        replayNextSeq: null,
      }),
    ).toBe(false);
    expect(
      isTerminalReplayCompleteMessage({
        message: {
          type: "output",
          chunk: { seq: 1 },
        },
        replayNextSeq: 3,
      }),
    ).toBe(false);
    expect(
      isTerminalReplayCompleteMessage({
        message: {
          type: "output",
          chunk: { seq: 2 },
        },
        replayNextSeq: 3,
      }),
    ).toBe(true);
  });

  it("fits immediately when there is no stored output to replay", () => {
    expect(
      isTerminalReplayCompleteMessage({
        message: { type: "attached", nextSeq: 0 },
        replayNextSeq: null,
      }),
    ).toBe(true);
  });

  it("replays each output chunk at its recorded dimensions in order", () => {
    const callbacks: Array<() => void> = [];
    const writes: string[] = [];
    const resizes: Array<{ cols: number; rows: number }> = [];
    const terminal = {
      cols: 77,
      rows: 39,
      resize(cols: number, rows: number) {
        this.cols = cols;
        this.rows = rows;
        resizes.push({ cols, rows });
      },
      write(text: string, callback?: () => void) {
        writes.push(text);
        if (callback) callbacks.push(callback);
      },
    };
    const outputWriteState = createTerminalOutputWriteState();
    const replayComplete = vi.fn();

    writeTerminalOutput({
      dimensions: { cols: 100, rows: 30 },
      isReplay: true,
      outputWriteState,
      terminal,
      text: "first",
    });
    writeTerminalOutput({
      dimensions: { cols: 77, rows: 39 },
      isReplay: true,
      onWriteComplete: replayComplete,
      outputWriteState,
      terminal,
      text: "second",
    });
    writeTerminalOutput({
      isReplay: false,
      outputWriteState,
      terminal,
      text: "live",
    });

    expect(resizes).toEqual([{ cols: 100, rows: 30 }]);
    expect(writes).toEqual(["first"]);
    callbacks.shift()?.();
    expect(resizes).toEqual([
      { cols: 100, rows: 30 },
      { cols: 77, rows: 39 },
    ]);
    expect(writes).toEqual(["first", "second"]);
    expect(replayComplete).not.toHaveBeenCalled();
    callbacks.shift()?.();
    expect(replayComplete).toHaveBeenCalledOnce();
    expect(writes).toEqual(["first", "second", "live"]);
  });
});
