const MAX_LINE_LENGTH = 80;
const CONTINUATION_INDENT = "  ";
const WORD_BOUNDARY = /[\s;&|()<>]/;
const WORD_PATTERN = /[^\s;&|()<>]+/y;

const COMPOUND_CLOSERS: ReadonlyMap<string, string> = new Map([
  ["if", "fi"],
  ["for", "done"],
  ["select", "done"],
  ["while", "done"],
  ["until", "done"],
  ["{", "}"],
  ["[[", "]]"],
]);

const COMMAND_INTRODUCERS = new Set([
  "if",
  "while",
  "until",
  "{",
  "then",
  "else",
  "elif",
  "do",
  "!",
]);

type NestedContext = "parentheses" | "double-quote" | "backtick" | "parameter";

type BreakKind = "list" | "pipe";

interface CommandBreak {
  readonly end: number;
  readonly kind: BreakKind;
}

interface ScanState {
  readonly command: string;
  readonly contexts: NestedContext[];
  readonly pendingClosers: string[];
  readonly breaks: CommandBreak[];
  expectsCommand: boolean;
}

interface TopLevelOperator {
  readonly length: number;
  readonly kind: BreakKind;
}

function isWordStart(command: string, index: number): boolean {
  const character = command[index] ?? "";
  const previous = command[index - 1];
  return (
    !WORD_BOUNDARY.test(character) &&
    (previous === undefined || WORD_BOUNDARY.test(previous))
  );
}

function readWordAt(command: string, index: number): string {
  WORD_PATTERN.lastIndex = index;
  return WORD_PATTERN.exec(command)?.[0] ?? "";
}

function applyWord(state: ScanState, word: string): boolean {
  const closer = state.pendingClosers.at(-1);
  if (word === closer && (state.expectsCommand || closer === "]]")) {
    state.pendingClosers.pop();
    state.expectsCommand = false;
    return true;
  }
  if (!state.expectsCommand) return true;
  if (word === "case") return false;
  const compoundCloser = COMPOUND_CLOSERS.get(word);
  if (compoundCloser) state.pendingClosers.push(compoundCloser);
  state.expectsCommand = COMMAND_INTRODUCERS.has(word);
  return true;
}

function topLevelOperatorAt(
  command: string,
  index: number,
): TopLevelOperator | null {
  const character = command[index];
  const next = command[index + 1];
  if ((character === "&" || character === "|") && next === character) {
    return { length: 2, kind: "list" };
  }
  if (character === ";") return { length: 1, kind: "list" };
  if (character === "|" && command[index - 1] !== ">") {
    return { length: next === "&" ? 2 : 1, kind: "pipe" };
  }
  return null;
}

function stepInDoubleQuote(state: ScanState, index: number): number {
  const { command, contexts } = state;
  const character = command[index];
  if (character === '"') {
    contexts.pop();
    return index + 1;
  }
  if (character === "`") {
    contexts.push("backtick");
    return index + 1;
  }
  if (character === "$" && command[index + 1] === "(") {
    contexts.push("parentheses");
    return index + 2;
  }
  if (character === "$" && command[index + 1] === "{") {
    contexts.push("parameter");
    return index + 2;
  }
  return index + 1;
}

function stepInBacktick(state: ScanState, index: number): number {
  if (state.command[index] === "`") state.contexts.pop();
  return index + 1;
}

function stepAtTopLevel(state: ScanState, index: number): number | null {
  const { command } = state;
  const operator = topLevelOperatorAt(command, index);
  if (operator) {
    const end = index + operator.length;
    if (state.pendingClosers.length === 0) {
      state.breaks.push({ end, kind: operator.kind });
    }
    state.expectsCommand = true;
    return end;
  }
  if (!isWordStart(command, index)) return index + 1;
  if (command[index] === "#") return command.length;
  return applyWord(state, readWordAt(command, index)) ? index + 1 : null;
}

function stepInCommand(state: ScanState, index: number): number | null {
  const { command, contexts } = state;
  const context = contexts.at(-1);
  const character = command[index];
  const next = command[index + 1];
  if (character === "'") {
    const closingQuote = command.indexOf("'", index + 1);
    return closingQuote === -1 ? null : closingQuote + 1;
  }
  if (character === '"') {
    contexts.push("double-quote");
    return index + 1;
  }
  if (character === "`") {
    contexts.push("backtick");
    return index + 1;
  }
  if (character === "$" && (next === "(" || next === "{")) {
    contexts.push(next === "(" ? "parentheses" : "parameter");
    return index + 2;
  }
  if (character === "(") {
    contexts.push("parentheses");
    return index + 1;
  }
  if (character === ")") {
    if (context !== "parentheses") return null;
    contexts.pop();
    return index + 1;
  }
  if (character === "}" && context === "parameter") {
    contexts.pop();
    return index + 1;
  }
  return context === undefined ? stepAtTopLevel(state, index) : index + 1;
}

function step(state: ScanState, index: number): number | null {
  if (state.command[index] === "\\") return index + 2;
  switch (state.contexts.at(-1)) {
    case "double-quote":
      return stepInDoubleQuote(state, index);
    case "backtick":
      return stepInBacktick(state, index);
    default:
      return stepInCommand(state, index);
  }
}

function findTopLevelBreaks(command: string): CommandBreak[] | null {
  const state: ScanState = {
    command,
    contexts: [],
    pendingClosers: [],
    breaks: [],
    expectsCommand: true,
  };
  let index: number | null = 0;
  while (index !== null && index < command.length) {
    index = step(state, index);
  }
  const balanced =
    state.contexts.length === 0 && state.pendingClosers.length === 0;
  return index !== null && balanced ? state.breaks : null;
}

function sliceAtEnds(
  command: string,
  start: number,
  ends: readonly number[],
): string[] {
  const pieces: string[] = [];
  let pieceStart = start;
  for (const end of ends) {
    pieces.push(command.slice(pieceStart, end).trim());
    pieceStart = end;
  }
  return pieces;
}

function layoutLines(
  command: string,
  breaks: readonly CommandBreak[],
): string[] {
  const lineEnds = [
    ...breaks.filter((item) => item.kind === "list").map((item) => item.end),
    command.length,
  ];
  const lines: string[] = [];
  let lineStart = 0;
  for (const lineEnd of lineEnds) {
    const line = command.slice(lineStart, lineEnd).trim();
    const pipeEnds = breaks
      .filter(
        (item) =>
          item.kind === "pipe" && item.end > lineStart && item.end < lineEnd,
      )
      .map((item) => item.end);
    lines.push(
      ...(line.length > MAX_LINE_LENGTH
        ? sliceAtEnds(command, lineStart, [...pipeEnds, lineEnd])
        : [line]),
    );
    lineStart = lineEnd;
  }
  return lines.filter((line) => line.length > 0);
}

export function formatShellCommandForDisplay(command: string): string {
  if (command.length <= MAX_LINE_LENGTH || command.includes("\n")) {
    return command;
  }
  const breaks = findTopLevelBreaks(command);
  return breaks
    ? layoutLines(command, breaks).join(`\n${CONTINUATION_INDENT}`)
    : command;
}
