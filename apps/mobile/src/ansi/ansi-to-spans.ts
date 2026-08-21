/**
 * Small SGR (Select Graphic Rendition) parser: turns terminal output with ANSI
 * escapes into styled spans whose colors are indexes into the 16-color theme
 * palette (`ansi0`…`ansi15` in theme.native.ts). 256-color and truecolor
 * sequences snap to the nearest of the 16 so every color follows the active
 * palette; cursor movement, erase, OSC (titles, hyperlinks), and other
 * non-SGR control sequences are stripped. A lone carriage return rewinds the
 * current line (progress bars render their final state).
 *
 * Pure TypeScript (no React Native), vitest-tested.
 */

/** Index into the theme's 16-color ANSI palette. */
export type AnsiPaletteIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15;

export interface AnsiSpan {
  text: string;
  fg: AnsiPaletteIndex | null;
  bg: AnsiPaletteIndex | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** Swap foreground and background when rendering. */
  inverse: boolean;
}

type SpanStyle = Omit<AnsiSpan, "text">;

const DEFAULT_STYLE: SpanStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
};

/**
 * Reference RGB values for the 16 xterm colors, used only to pick the nearest
 * palette slot for 256-color / truecolor requests. The rendered color comes
 * from the theme, not from this table.
 */
const XTERM_16: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [205, 0, 0],
  [0, 205, 0],
  [205, 205, 0],
  [0, 0, 238],
  [205, 0, 205],
  [0, 205, 205],
  [229, 229, 229],
  [127, 127, 127],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [92, 92, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255] as const;

function asPaletteIndex(value: number): AnsiPaletteIndex {
  const clamped = Math.min(15, Math.max(0, Math.trunc(value)));
  return clamped as AnsiPaletteIndex;
}

/** Nearest of the 16 reference colors by Euclidean RGB distance. */
export function nearestPaletteIndex(
  r: number,
  g: number,
  b: number,
): AnsiPaletteIndex {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < XTERM_16.length; index += 1) {
    const [cr, cg, cb] = XTERM_16[index]!;
    const distance = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return asPaletteIndex(best);
}

/** Maps an xterm 256-color index onto the 16-color palette. */
export function paletteIndexFrom256(index: number): AnsiPaletteIndex {
  if (!Number.isFinite(index)) return 7;
  const value = Math.trunc(index);
  if (value < 0) return 7;
  if (value < 16) return asPaletteIndex(value);
  if (value < 232) {
    const cube = value - 16;
    const r = CUBE_STEPS[Math.floor(cube / 36) % 6]!;
    const g = CUBE_STEPS[Math.floor(cube / 6) % 6]!;
    const b = CUBE_STEPS[cube % 6]!;
    return nearestPaletteIndex(r, g, b);
  }
  if (value < 256) {
    const gray = 8 + (value - 232) * 10;
    return nearestPaletteIndex(gray, gray, gray);
  }
  return 7;
}

function applySgr(style: SpanStyle, params: readonly number[]): SpanStyle {
  let next = { ...style };
  if (params.length === 0) {
    return { ...DEFAULT_STYLE };
  }
  for (let index = 0; index < params.length; index += 1) {
    const code = params[index]!;
    if (code === 0) {
      next = { ...DEFAULT_STYLE };
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 2) {
      next.dim = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 7) {
      next.inverse = true;
    } else if (code === 9) {
      next.strikethrough = true;
    } else if (code === 22) {
      next.bold = false;
      next.dim = false;
    } else if (code === 23) {
      next.italic = false;
    } else if (code === 24) {
      next.underline = false;
    } else if (code === 27) {
      next.inverse = false;
    } else if (code === 29) {
      next.strikethrough = false;
    } else if (code >= 30 && code <= 37) {
      next.fg = asPaletteIndex(code - 30);
    } else if (code === 39) {
      next.fg = null;
    } else if (code >= 40 && code <= 47) {
      next.bg = asPaletteIndex(code - 40);
    } else if (code === 49) {
      next.bg = null;
    } else if (code >= 90 && code <= 97) {
      next.fg = asPaletteIndex(code - 90 + 8);
    } else if (code >= 100 && code <= 107) {
      next.bg = asPaletteIndex(code - 100 + 8);
    } else if (code === 38 || code === 48) {
      const mode = params[index + 1];
      let color: AnsiPaletteIndex | null = null;
      if (mode === 5 && params.length > index + 2) {
        color = paletteIndexFrom256(params[index + 2]!);
        index += 2;
      } else if (mode === 2 && params.length > index + 4) {
        color = nearestPaletteIndex(
          params[index + 2]!,
          params[index + 3]!,
          params[index + 4]!,
        );
        index += 4;
      } else {
        // Malformed extended color: consume the rest, as terminals do.
        index = params.length;
      }
      if (color !== null) {
        if (code === 38) next.fg = color;
        else next.bg = color;
      }
    }
    // Anything else (blink, fonts, ideogram, …) is ignored.
  }
  return next;
}

function parseSgrParams(raw: string): number[] {
  if (raw.length === 0) return [];
  const params: number[] = [];
  for (const part of raw.split(/[;:]/u)) {
    params.push(part.length === 0 ? 0 : Number.parseInt(part, 10));
  }
  return params.filter((value) => Number.isFinite(value));
}

function sameStyle(a: SpanStyle, b: SpanStyle): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse
  );
}

const ESC = "\u001b";
const BEL = "\u0007";

/**
 * Length of the control sequence starting at `input[start]` (which is ESC),
 * and its SGR parameter string when it is an SGR sequence.
 */
function readEscape(
  input: string,
  start: number,
): { length: number; sgr: string | null } {
  const next = input[start + 1];
  if (next === "[") {
    // CSI: ESC [ params intermediates final (0x40–0x7E)
    let index = start + 2;
    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        const final = input[index];
        const body = input.slice(start + 2, index);
        return {
          length: index - start + 1,
          sgr: final === "m" && /^[0-9;:]*$/u.test(body) ? body : null,
        };
      }
      index += 1;
    }
    return { length: input.length - start, sgr: null };
  }
  if (next === "]") {
    // OSC: ESC ] … BEL | ESC \
    let index = start + 2;
    while (index < input.length) {
      if (input[index] === BEL) {
        return { length: index - start + 1, sgr: null };
      }
      if (input[index] === ESC && input[index + 1] === "\\") {
        return { length: index - start + 2, sgr: null };
      }
      index += 1;
    }
    return { length: input.length - start, sgr: null };
  }
  if (next === "(" || next === ")" || next === "#" || next === "%") {
    // Character-set designations and similar two-byte intermediates.
    return { length: Math.min(3, input.length - start), sgr: null };
  }
  if (next === undefined) {
    return { length: 1, sgr: null };
  }
  // Other two-byte escapes (ESC 7, ESC 8, ESC =, ESC M, …).
  return { length: 2, sgr: null };
}

class SpanBuilder {
  readonly spans: AnsiSpan[] = [];
  private buffer = "";
  private style: SpanStyle = { ...DEFAULT_STYLE };

  append(text: string): void {
    this.buffer += text;
  }

  setStyle(style: SpanStyle): void {
    if (sameStyle(style, this.style)) return;
    this.flush();
    this.style = style;
  }

  currentStyle(): SpanStyle {
    return this.style;
  }

  /** Drops everything after the last newline: terminal `\r` overwrite. */
  rewindLine(): void {
    const bufferBreak = this.buffer.lastIndexOf("\n");
    if (bufferBreak !== -1) {
      this.buffer = this.buffer.slice(0, bufferBreak + 1);
      return;
    }
    this.buffer = "";
    while (this.spans.length > 0) {
      const last = this.spans[this.spans.length - 1]!;
      const lineBreak = last.text.lastIndexOf("\n");
      if (lineBreak !== -1) {
        last.text = last.text.slice(0, lineBreak + 1);
        return;
      }
      this.spans.pop();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const last = this.spans[this.spans.length - 1];
    if (last && sameStyle(last, this.style)) {
      last.text += this.buffer;
    } else {
      this.spans.push({ text: this.buffer, ...this.style });
    }
    this.buffer = "";
  }
}

/** Parses terminal output into styled spans. */
export function ansiToSpans(input: string): AnsiSpan[] {
  const builder = new SpanBuilder();
  let index = 0;
  let plainStart = 0;

  const flushPlain = (end: number) => {
    if (end > plainStart) builder.append(input.slice(plainStart, end));
  };

  while (index < input.length) {
    const char = input[index]!;
    if (char === ESC) {
      flushPlain(index);
      const { length, sgr } = readEscape(input, index);
      if (sgr !== null) {
        builder.setStyle(applySgr(builder.currentStyle(), parseSgrParams(sgr)));
      }
      index += length;
      plainStart = index;
      continue;
    }
    if (char === "\r") {
      flushPlain(index);
      if (input[index + 1] !== "\n") {
        builder.rewindLine();
      }
      index += 1;
      plainStart = index;
      continue;
    }
    if (char === "\b" || char === BEL) {
      flushPlain(index);
      index += 1;
      plainStart = index;
      continue;
    }
    index += 1;
  }
  flushPlain(input.length);
  builder.flush();
  return builder.spans;
}

/** Splits spans into lines (each line is a list of spans without `\n`). */
function splitSpansIntoLines(spans: readonly AnsiSpan[]): AnsiSpan[][] {
  const lines: AnsiSpan[][] = [[]];
  for (const span of spans) {
    const parts = span.text.split("\n");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      if (index > 0) lines.push([]);
      if (part.length > 0) {
        lines[lines.length - 1]!.push({ ...span, text: part });
      }
    }
  }
  return lines;
}

/** Lines of styled spans; a trailing newline does not produce an empty last line. */
export function ansiToLines(input: string): AnsiSpan[][] {
  const lines = splitSpansIntoLines(ansiToSpans(input));
  if (lines.length > 1 && lines[lines.length - 1]!.length === 0) {
    lines.pop();
  }
  return lines;
}

/** The text with every escape sequence removed (and `\r` overwrites applied). */
export function stripAnsi(input: string): string {
  let out = "";
  for (const span of ansiToSpans(input)) out += span.text;
  return out;
}
