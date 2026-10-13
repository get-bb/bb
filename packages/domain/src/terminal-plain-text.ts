const ESCAPE = "\u001b";
const BELL = "\u0007";

interface EscapeScanResult {
  end: number;
  eraseInLine: "after-cursor" | "before-cursor" | "whole-line" | null;
}

function scanCsiSequence(input: string, start: number): EscapeScanResult {
  let index = start + 2;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      const parameters = input.slice(start + 2, index);
      if (input[index] !== "K") {
        return { end: index + 1, eraseInLine: null };
      }
      switch (parameters) {
        case "":
        case "0":
          return { end: index + 1, eraseInLine: "after-cursor" };
        case "1":
          return { end: index + 1, eraseInLine: "before-cursor" };
        case "2":
          return { end: index + 1, eraseInLine: "whole-line" };
        default:
          return { end: index + 1, eraseInLine: null };
      }
    }
    index += 1;
  }
  return { end: input.length, eraseInLine: null };
}

function scanStringSequence(input: string, start: number): number {
  for (let index = start + 2; index < input.length; index += 1) {
    if (input[index] === BELL) {
      return index + 1;
    }
    if (input[index] === ESCAPE && input[index + 1] === "\\") {
      return index + 2;
    }
  }
  return input.length;
}

function scanEscapeSequence(input: string, start: number): EscapeScanResult {
  const introducer = input[start + 1];
  if (introducer === undefined) {
    return { end: input.length, eraseInLine: null };
  }
  if (introducer === "[") {
    return scanCsiSequence(input, start);
  }
  if (
    introducer === "]" ||
    introducer === "P" ||
    introducer === "^" ||
    introducer === "_"
  ) {
    return { end: scanStringSequence(input, start), eraseInLine: null };
  }
  if (
    introducer === "(" ||
    introducer === ")" ||
    introducer === "#" ||
    introducer === "%"
  ) {
    return { end: start + 3, eraseInLine: null };
  }
  return { end: start + 2, eraseInLine: null };
}

export function terminalTextToPlainLines(text: string): string[] {
  const lines: string[] = [];
  let current: string[] = [];
  let column = 0;

  const commitLine = (): void => {
    lines.push(current.join("").replace(/\s+$/u, ""));
    current = [];
    column = 0;
  };

  const writeCharacter = (character: string): void => {
    while (current.length < column) {
      current.push(" ");
    }
    current[column] = character;
    column += 1;
  };

  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (character === undefined) {
      break;
    }
    if (character === ESCAPE) {
      const scan = scanEscapeSequence(text, index);
      if (scan.eraseInLine === "after-cursor") {
        current = current.slice(0, column);
      }
      if (scan.eraseInLine === "before-cursor") {
        for (let position = 0; position < column; position += 1) {
          current[position] = " ";
        }
      }
      if (scan.eraseInLine === "whole-line") {
        current = [];
      }
      index = scan.end;
      continue;
    }
    if (character === "\n") {
      commitLine();
      index += 1;
      continue;
    }
    if (character === "\r") {
      column = 0;
      index += 1;
      continue;
    }
    if (character === "\b") {
      column = Math.max(0, column - 1);
      index += 1;
      continue;
    }
    if (character === "\t") {
      const nextStop = column + (8 - (column % 8));
      while (column < nextStop) {
        writeCharacter(" ");
      }
      index += 1;
      continue;
    }
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      index += 1;
      continue;
    }
    writeCharacter(character);
    index += 1;
  }

  if (current.length > 0 || column > 0) {
    commitLine();
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  while (lines.length > 0 && lines[0] === "") {
    lines.shift();
  }
  return lines;
}

export function terminalTextToPlainText(text: string): string {
  return terminalTextToPlainLines(text).join("\n");
}
