import { describe, expect, it } from "vitest";
import {
  ansiToLines,
  ansiToSpans,
  nearestPaletteIndex,
  paletteIndexFrom256,
  stripAnsi,
  type AnsiSpan,
} from "./ansi-to-spans";

const ESC = "\u001b";
const plain = (text: string): AnsiSpan => ({
  text,
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
});

describe("ansiToSpans", () => {
  it("returns one plain span for text without escapes", () => {
    expect(ansiToSpans("hello\nworld")).toEqual([plain("hello\nworld")]);
    expect(ansiToSpans("")).toEqual([]);
  });

  it("applies 16-color foreground/background and resets", () => {
    const spans = ansiToSpans(
      `${ESC}[31mred ${ESC}[1;42mbold on green${ESC}[0m plain ${ESC}[94mbright blue${ESC}[m end`,
    );
    expect(spans).toEqual([
      { ...plain("red "), fg: 1 },
      { ...plain("bold on green"), fg: 1, bg: 2, bold: true },
      plain(" plain "),
      { ...plain("bright blue"), fg: 12 },
      plain(" end"),
    ]);
  });

  it("handles individual attribute toggles and default color resets", () => {
    const spans = ansiToSpans(
      `${ESC}[2;3;4;9mA${ESC}[22;23mB${ESC}[24;29mC${ESC}[33;44mD${ESC}[39mE${ESC}[49mF${ESC}[7mG${ESC}[27mH`,
    );
    expect(spans.map((span) => span.text)).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
    ]);
    expect(spans[0]).toMatchObject({
      dim: true,
      italic: true,
      underline: true,
      strikethrough: true,
    });
    expect(spans[1]).toMatchObject({
      dim: false,
      italic: false,
      underline: true,
      strikethrough: true,
    });
    expect(spans[2]).toMatchObject({ underline: false, strikethrough: false });
    expect(spans[3]).toMatchObject({ fg: 3, bg: 4 });
    expect(spans[4]).toMatchObject({ fg: null, bg: 4 });
    expect(spans[5]).toMatchObject({ fg: null, bg: null });
    expect(spans[6]).toMatchObject({ inverse: true });
    expect(spans[7]).toMatchObject({ inverse: false });
  });

  it("snaps 256-color and truecolor to the nearest of the 16 palette slots", () => {
    const spans = ansiToSpans(
      `${ESC}[38;5;196mR${ESC}[48;5;21mB${ESC}[38;2;0;200;0mG${ESC}[38:5:226mY${ESC}[38;5;244mgray${ESC}[0m`,
    );
    expect(spans.map((span) => [span.text, span.fg, span.bg])).toEqual([
      ["R", 9, null],
      ["B", 9, 4],
      ["G", 2, 4],
      ["Y", 11, 4],
      ["gray", 8, 4],
    ]);
    expect(paletteIndexFrom256(0)).toBe(0);
    expect(paletteIndexFrom256(15)).toBe(15);
    expect(paletteIndexFrom256(16)).toBe(0);
    expect(paletteIndexFrom256(231)).toBe(15);
    expect(paletteIndexFrom256(232)).toBe(0);
    expect(paletteIndexFrom256(255)).toBe(7);
    expect(paletteIndexFrom256(999)).toBe(7);
    expect(nearestPaletteIndex(255, 255, 255)).toBe(15);
    expect(nearestPaletteIndex(130, 0, 0)).toBe(1);
  });

  it("ignores malformed extended color sequences without crashing", () => {
    expect(ansiToSpans(`${ESC}[38;5mX`)).toEqual([plain("X")]);
    expect(ansiToSpans(`${ESC}[38;2;1;2mX`)).toEqual([plain("X")]);
    expect(ansiToSpans(`${ESC}[38mX`)).toEqual([plain("X")]);
  });

  it("strips cursor, erase, OSC, and other non-SGR sequences", () => {
    const input =
      `${ESC}[2J${ESC}[H${ESC}[?25l${ESC}[1A${ESC}[2K` +
      `${ESC}]0;window title` +
      `${ESC}]8;;https://example.com${ESC}\\link${ESC}]8;;${ESC}\\` +
      `${ESC}(B${ESC}7${ESC}[31m text${ESC}[0m${ESC}[?25h`;
    expect(ansiToSpans(input)).toEqual([
      plain("link"),
      { ...plain(" text"), fg: 1 },
    ]);
    expect(stripAnsi(input)).toBe("link text");
  });

  it("keeps an unterminated escape from swallowing nothing but itself", () => {
    expect(stripAnsi(`abc${ESC}[31`)).toBe("abc");
    expect(stripAnsi(`abc${ESC}`)).toBe("abc");
  });

  it("rewinds the current line on a lone carriage return and keeps CRLF", () => {
    expect(stripAnsi("10%\r50%\r100%\ndone\r\n")).toBe("100%\ndone\n");
    expect(stripAnsi("a\b")).toBe("a");
    const spans = ansiToSpans(
      `${ESC}[32mfirst${ESC}[0m\n${ESC}[33mprogress 1${ESC}[0m\rfinal`,
    );
    expect(spans).toEqual([{ ...plain("first"), fg: 2 }, plain("\nfinal")]);
  });

  it("merges adjacent spans with identical style", () => {
    expect(ansiToSpans(`${ESC}[31ma${ESC}[31mb${ESC}[1m${ESC}[22mc`)).toEqual([
      { ...plain("abc"), fg: 1 },
    ]);
  });
});

describe("ansiToLines", () => {
  it("splits styled spans into lines and drops the trailing empty line", () => {
    const lines = ansiToLines(`${ESC}[1mbold\nstill bold${ESC}[0m plain\n`);
    expect(lines).toEqual([
      [{ ...plain("bold"), bold: true }],
      [{ ...plain("still bold"), bold: true }, plain(" plain")],
    ]);
    expect(ansiToLines("a\n\nb")).toEqual([[plain("a")], [], [plain("b")]]);
    expect(ansiToLines("")).toEqual([[]]);
  });
});
