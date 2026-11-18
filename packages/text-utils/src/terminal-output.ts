const ESC = 0x1b;
const BEL = 0x07;
const BACKSPACE = 0x08;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const DELETE = 0x7f;

const CONTROL_OR_ESCAPE_PATTERN = /[\u0000-\u0008\u000b-\u001f\u007f]/u;

interface TerminalStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  hidden: boolean;
  strike: boolean;
  overline: boolean;
  foreground: string | null;
  background: string | null;
}

interface TerminalRun {
  text: string;
  style: number;
}

interface TerminalLine {
  runs: TerminalRun[];
  length: number;
}

interface TerminalCells {
  chars: string[];
  styles: number[];
}

type ExtendedColorTarget = "foreground" | "background" | "ignored";

function defaultTerminalStyle(): TerminalStyle {
  return {
    bold: false,
    italic: false,
    underline: false,
    hidden: false,
    strike: false,
    overline: false,
    foreground: null,
    background: null,
  };
}

function styleToSgr(style: TerminalStyle): string {
  let sgr = "";
  if (style.bold) sgr += "\u001b[1m";
  if (style.italic) sgr += "\u001b[3m";
  if (style.underline) sgr += "\u001b[4m";
  if (style.hidden) sgr += "\u001b[8m";
  if (style.strike) sgr += "\u001b[9m";
  if (style.overline) sgr += "\u001b[53m";
  if (style.foreground !== null) sgr += `\u001b[${style.foreground}m`;
  if (style.background !== null) sgr += `\u001b[${style.background}m`;
  return sgr;
}

function parseColorComponent(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,3}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed <= 255 ? parsed : null;
}

function basicColorCode(
  target: "foreground" | "background",
  index: number,
): string {
  const base = target === "foreground" ? 30 : 40;
  return String(index < 8 ? base + index : base + 60 + index - 8);
}

function extendedColorCode(
  target: "foreground" | "background",
  args: readonly string[],
): string | null {
  const prefix = target === "foreground" ? "38" : "48";
  if (args[0] === "5") {
    const index = parseColorComponent(args[1]);
    if (index === null) return null;
    return index < 16 ? basicColorCode(target, index) : `${prefix};5;${index}`;
  }
  if (args[0] === "2") {
    const red = parseColorComponent(args[1]);
    const green = parseColorComponent(args[2]);
    const blue = parseColorComponent(args[3]);
    if (red === null || green === null || blue === null) return null;
    return `${prefix};2;${red};${green};${blue}`;
  }
  return null;
}

function colonColorArgs(subparams: readonly string[]): string[] {
  if (subparams[0] === "2" && subparams.length >= 5) {
    return ["2", ...subparams.slice(-3)];
  }
  return subparams.slice();
}

function semicolonColorArgCount(mode: string | undefined): number {
  if (mode === "5") return 2;
  if (mode === "2") return 4;
  return 1;
}

function applyExtendedColor(
  style: TerminalStyle,
  target: ExtendedColorTarget,
  args: readonly string[],
): void {
  if (target === "ignored") return;
  const code = extendedColorCode(target, args);
  if (code !== null) style[target] = code;
}

function extendedColorTarget(code: number): ExtendedColorTarget | null {
  if (code === 38) return "foreground";
  if (code === 48) return "background";
  if (code === 58) return "ignored";
  return null;
}

function applySgrCode(
  style: TerminalStyle,
  code: number,
  subparams: readonly string[],
): void {
  if (code === 0) {
    Object.assign(style, defaultTerminalStyle());
  } else if (code === 1) {
    style.bold = true;
  } else if (code === 22) {
    style.bold = false;
  } else if (code === 3) {
    style.italic = true;
  } else if (code === 23) {
    style.italic = false;
  } else if (code === 4) {
    style.underline = subparams[0] !== "0";
  } else if (code === 24) {
    style.underline = false;
  } else if (code === 8) {
    style.hidden = true;
  } else if (code === 28) {
    style.hidden = false;
  } else if (code === 9) {
    style.strike = true;
  } else if (code === 29) {
    style.strike = false;
  } else if (code === 53) {
    style.overline = true;
  } else if (code === 55) {
    style.overline = false;
  } else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
    style.foreground = String(code);
  } else if (code === 39) {
    style.foreground = null;
  } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
    style.background = String(code);
  } else if (code === 49) {
    style.background = null;
  }
}

function applySgr(style: TerminalStyle, params: string): void {
  const groups = params.length === 0 ? [""] : params.split(";");
  let index = 0;
  while (index < groups.length) {
    const [codeText = "", ...subparams] = groups[index]!.split(":");
    index += 1;
    if (codeText !== "" && !/^\d+$/u.test(codeText)) continue;
    const code = codeText === "" ? 0 : Number(codeText);
    const colorTarget = extendedColorTarget(code);
    if (colorTarget !== null) {
      if (subparams.length > 0) {
        applyExtendedColor(style, colorTarget, colonColorArgs(subparams));
      } else {
        const argCount = semicolonColorArgCount(groups[index]);
        applyExtendedColor(
          style,
          colorTarget,
          groups.slice(index, index + argCount),
        );
        index += argCount;
      }
      continue;
    }
    applySgrCode(style, code, subparams);
  }
}

function parseCount(params: string): number {
  const parsed = Number.parseInt(params.split(";")[0] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseMode(params: string): number {
  const parsed = Number.parseInt(params.split(";")[0] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SURROGATE_PATTERN = /[\uD800-\uDFFF]/u;

function codePointLength(text: string): number {
  return SURROGATE_PATTERN.test(text) ? Array.from(text).length : text.length;
}

function emptyLine(): TerminalLine {
  return { runs: [], length: 0 };
}

function appendRun(line: TerminalLine, text: string, style: number): void {
  if (text.length === 0) return;
  const last = line.runs.at(-1);
  if (last !== undefined && last.style === style) {
    last.text += text;
  } else {
    line.runs.push({ text, style });
  }
  line.length += codePointLength(text);
}

function explodeLine(line: TerminalLine): TerminalCells {
  const chars: string[] = [];
  const styles: number[] = [];
  for (const run of line.runs) {
    for (const char of run.text) {
      chars.push(char);
      styles.push(run.style);
    }
  }
  return { chars, styles };
}

function truncateLine(line: TerminalLine, col: number): void {
  if (col >= line.length) return;
  let remaining = col;
  let keep = 0;
  while (keep < line.runs.length && remaining > 0) {
    const run = line.runs[keep]!;
    const runLength = codePointLength(run.text);
    if (runLength > remaining) {
      run.text = SURROGATE_PATTERN.test(run.text)
        ? Array.from(run.text).slice(0, remaining).join("")
        : run.text.slice(0, remaining);
      remaining = 0;
    } else {
      remaining -= runLength;
    }
    keep += 1;
  }
  line.runs.length = keep;
  line.length = col;
}

function rebuildLine(line: TerminalLine, cells: TerminalCells): void {
  line.runs.length = 0;
  line.length = 0;
  let start = 0;
  for (let index = 1; index <= cells.chars.length; index += 1) {
    if (
      index === cells.chars.length ||
      cells.styles[index] !== cells.styles[start]
    ) {
      appendRun(
        line,
        cells.chars.slice(start, index).join(""),
        cells.styles[start]!,
      );
      start = index;
    }
  }
}

class TerminalScreen {
  private readonly lines: TerminalLine[] = [emptyLine()];
  private readonly styleIds = new Map<string, number>([["", 0]]);
  private readonly styleSgr: string[] = [""];
  private readonly styles: TerminalStyle[] = [defaultTerminalStyle()];
  private readonly sgrTransitions = new Map<string, number>();
  private styleId = 0;
  private row = 0;
  private col = 0;

  write(text: string): void {
    const line = this.currentLine();
    if (this.col > line.length) {
      appendRun(line, " ".repeat(this.col - line.length), 0);
    }
    const textLength = codePointLength(text);
    if (this.col + textLength >= line.length) {
      truncateLine(line, this.col);
      appendRun(line, text, this.styleId);
      this.col = line.length;
      return;
    }
    const cells = explodeLine(line);
    for (const char of text) {
      cells.chars[this.col] = char;
      cells.styles[this.col] = this.styleId;
      this.col += 1;
    }
    rebuildLine(line, cells);
  }

  lineFeed(): void {
    this.row += 1;
    this.col = 0;
    this.ensureRow();
  }

  carriageReturn(): void {
    this.col = 0;
  }

  moveColumn(col: number): void {
    this.col = Math.max(0, col);
  }

  moveColumnBy(delta: number): void {
    this.moveColumn(this.col + delta);
  }

  moveRowBy(delta: number): void {
    this.row = Math.max(0, this.row + delta);
    this.ensureRow();
  }

  eraseInLine(mode: number): void {
    const line = this.currentLine();
    if (mode === 2) {
      line.runs.length = 0;
      line.length = 0;
      return;
    }
    if (mode === 0) {
      truncateLine(line, this.col);
      return;
    }
    if (mode !== 1) return;
    const cells = explodeLine(line);
    const end = Math.min(cells.chars.length, this.col + 1);
    cells.chars.fill(" ", 0, end);
    cells.styles.fill(0, 0, end);
    rebuildLine(line, cells);
  }

  eraseBelow(): void {
    this.eraseInLine(0);
    this.lines.length = this.row + 1;
  }

  applySgr(params: string): void {
    const transitionKey = `${this.styleId}:${params}`;
    const cached = this.sgrTransitions.get(transitionKey);
    if (cached !== undefined) {
      this.styleId = cached;
      return;
    }
    const style = { ...this.styles[this.styleId]! };
    applySgr(style, params);
    const sgr = styleToSgr(style);
    let id = this.styleIds.get(sgr);
    if (id === undefined) {
      id = this.styleSgr.length;
      this.styleIds.set(sgr, id);
      this.styleSgr.push(sgr);
      this.styles.push(style);
    }
    this.sgrTransitions.set(transitionKey, id);
    this.styleId = id;
  }

  render(keepStyles: boolean): string {
    return this.lines
      .map((line) =>
        keepStyles
          ? this.renderStyledLine(line)
          : line.runs.map((run) => run.text).join(""),
      )
      .join("\n");
  }

  private renderStyledLine(line: TerminalLine): string {
    let out = "";
    for (const run of line.runs) {
      out +=
        run.style === 0
          ? run.text
          : `${this.styleSgr[run.style]}${run.text}\u001b[0m`;
    }
    return out;
  }

  private currentLine(): TerminalLine {
    return this.lines[this.row]!;
  }

  private ensureRow(): void {
    while (this.lines.length <= this.row) {
      this.lines.push(emptyLine());
    }
  }
}

function applyCsi(
  screen: TerminalScreen,
  params: string,
  intermediates: string,
  final: string,
): void {
  if (intermediates.length > 0 || /^[<=>?]/u.test(params)) return;
  switch (final) {
    case "m":
      screen.applySgr(params);
      return;
    case "K":
      screen.eraseInLine(parseMode(params));
      return;
    case "J":
      if (parseMode(params) === 0) screen.eraseBelow();
      return;
    case "G":
    case "`":
      screen.moveColumn(parseCount(params) - 1);
      return;
    case "C":
      screen.moveColumnBy(parseCount(params));
      return;
    case "D":
      screen.moveColumnBy(-parseCount(params));
      return;
    case "A":
      screen.moveRowBy(-parseCount(params));
      return;
    case "B":
      screen.moveRowBy(parseCount(params));
      return;
    case "E":
      screen.moveRowBy(parseCount(params));
      screen.carriageReturn();
      return;
    case "F":
      screen.moveRowBy(-parseCount(params));
      screen.carriageReturn();
      return;
    default:
      return;
  }
}

function isStringIntroducer(code: number): boolean {
  return (
    code === 0x5d ||
    code === 0x50 ||
    code === 0x58 ||
    code === 0x5e ||
    code === 0x5f
  );
}

function skipControlString(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === BEL) return index + 1;
    if (code === LINE_FEED) return index;
    if (code === ESC) {
      return text.charCodeAt(index + 1) === 0x5c ? index + 2 : index;
    }
  }
  return text.length;
}

function consumeCsi(
  screen: TerminalScreen,
  text: string,
  start: number,
): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x30 || code > 0x3f) break;
    index += 1;
  }
  const params = text.slice(start, index);
  const intermediateStart = index;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x2f) break;
    index += 1;
  }
  const intermediates = text.slice(intermediateStart, index);
  if (index >= text.length) return text.length;
  const finalCode = text.charCodeAt(index);
  if (finalCode < 0x40 || finalCode > 0x7e) return index;
  applyCsi(screen, params, intermediates, text[index]!);
  return index + 1;
}

function consumeEscape(
  screen: TerminalScreen,
  text: string,
  start: number,
): number {
  if (start >= text.length) return text.length;
  const code = text.charCodeAt(start);
  if (code === 0x5b) return consumeCsi(screen, text, start + 1);
  if (isStringIntroducer(code)) return skipControlString(text, start + 1);
  let index = start;
  while (index < text.length) {
    const intermediate = text.charCodeAt(index);
    if (intermediate < 0x20 || intermediate > 0x2f) break;
    index += 1;
  }
  if (index >= text.length) return text.length;
  const finalCode = text.charCodeAt(index);
  return finalCode >= 0x30 && finalCode <= 0x7e ? index + 1 : index;
}

function renderTerminalOutput(text: string, keepStyles: boolean): string {
  if (!CONTROL_OR_ESCAPE_PATTERN.test(text)) return text;
  const screen = new TerminalScreen();
  let index = 0;
  let textStart = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if ((code >= 0x20 && code !== DELETE) || code === TAB) {
      index += 1;
      continue;
    }
    if (index > textStart) screen.write(text.slice(textStart, index));
    index += 1;
    if (code === LINE_FEED) {
      screen.lineFeed();
    } else if (code === CARRIAGE_RETURN) {
      screen.carriageReturn();
    } else if (code === BACKSPACE) {
      screen.moveColumnBy(-1);
    } else if (code === ESC) {
      index = consumeEscape(screen, text, index);
    }
    textStart = index;
  }
  if (index > textStart) screen.write(text.slice(textStart, index));
  return screen.render(keepStyles);
}

export function sanitizeTerminalOutput(text: string): string {
  return renderTerminalOutput(text, true);
}

export function terminalOutputToPlainText(text: string): string {
  return renderTerminalOutput(text, false);
}

interface TerminalOutputLineReader {
  flush(): string[];
  push(text: string): string[];
}

export function createTerminalOutputLineReader(): TerminalOutputLineReader {
  let pending = "";

  const readLines = (text: string): string[] =>
    terminalOutputToPlainText(text)
      .split("\n")
      .filter((line) => line.trim().length > 0);

  return {
    flush(): string[] {
      const lines = readLines(pending);
      pending = "";
      return lines;
    },
    push(text: string): string[] {
      pending += text;
      const lastLineFeed = pending.lastIndexOf("\n");
      if (lastLineFeed === -1) return [];
      const complete = pending.slice(0, lastLineFeed);
      pending = pending.slice(lastLineFeed + 1);
      return readLines(complete);
    },
  };
}

export function readTerminalOutputLines(text: string): string[] {
  const reader = createTerminalOutputLineReader();
  return [...reader.push(text), ...reader.flush()];
}
