import { rawThreadIdSchema } from "@bb/domain";
import type { EventProjectionToolParsedIntent } from "./event-projection-types.js";

const SHELL_WRAPPER_NAMES = new Set(["sh", "bash", "zsh"]);

const SHELL_SEGMENT_BREAK_TOKENS = new Set(["&&", "||", "|", ";", "\n"]);

function unwrapQuotedShellArg(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return value;
  }
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;

  let result = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1]!;
      if (
        next === "$" ||
        next === "`" ||
        next === '"' ||
        next === "\\" ||
        next === "\n"
      ) {
        result += next;
        i += 1;
        continue;
      }
    }
    result += ch;
  }
  return result;
}

function isKnownShellWrapper(value: string): boolean {
  const shellName = value.split("/").pop() ?? value;
  return SHELL_WRAPPER_NAMES.has(shellName);
}

export function extractShellCommandFromString(
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const match = /^(\S+)\s+(-lc|-c)\s+([\s\S]+)$/.exec(trimmed);
  if (!match) return trimmed;

  const shellProgram = match[1];
  const commandArg = match[3];
  if (!shellProgram || !commandArg || !isKnownShellWrapper(shellProgram)) {
    return trimmed;
  }

  return unwrapQuotedShellArg(commandArg.trim());
}

const DOUBLE_QUOTE_ESCAPABLE = new Set(["$", "`", '"', "\\", "\n"]);

interface ShellToken {
  readonly value: string;
  readonly quoted: boolean;
}

function visitShellCommandSegments(
  command: string,
  visit: (segment: ShellToken[]) => boolean,
): void {
  let segment: ShellToken[] = [];
  const appendToken = (token: ShellToken): boolean => {
    if (!token.quoted && SHELL_SEGMENT_BREAK_TOKENS.has(token.value)) {
      const completed = segment;
      segment = [];
      return completed.length === 0 || visit(completed);
    }
    segment.push(token);
    return true;
  };
  let current = "";
  let currentHasQuoted = false;
  let currentHasUnquoted = false;
  let quote: "'" | '"' | null = null;
  let escaping = false;

  const recordQuoted = (): void => {
    currentHasQuoted = true;
  };
  const recordUnquoted = (): void => {
    currentHasUnquoted = true;
  };

  const flushCurrent = (): boolean => {
    const fullyQuoted = currentHasQuoted && !currentHasUnquoted;
    const hasContent = current.length > 0;
    if (!hasContent && !fullyQuoted) {
      currentHasQuoted = false;
      currentHasUnquoted = false;
      return true;
    }
    const keepGoing = appendToken({ value: current, quoted: fullyQuoted });
    current = "";
    currentHasQuoted = false;
    currentHasUnquoted = false;
    return keepGoing;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (!character) continue;

    if (escaping) {
      current += character;
      if (quote !== null) recordQuoted();
      else recordUnquoted();
      escaping = false;
      continue;
    }

    if (character === "\\") {
      if (quote === "'") {
        current += character;
        recordQuoted();
        continue;
      }
      if (quote === '"') {
        const next = command[index + 1];
        if (next === undefined || !DOUBLE_QUOTE_ESCAPABLE.has(next)) {
          current += character;
          recordQuoted();
          continue;
        }
      }
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
        if (current.length === 0) recordQuoted();
        continue;
      }
      current += character;
      recordQuoted();
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "\n") {
      if (!flushCurrent()) return;
      if (!appendToken({ value: "\n", quoted: false })) return;
      continue;
    }

    if (/\s/u.test(character)) {
      if (!flushCurrent()) return;
      continue;
    }

    if (character === "|" || character === "&" || character === ";") {
      if (character === "&" && command[index + 1] === ">") {
        if (!flushCurrent()) return;
        if (command[index + 2] === ">") {
          if (!appendToken({ value: "&>>", quoted: false })) return;
          index += 2;
        } else {
          if (!appendToken({ value: "&>", quoted: false })) return;
          index += 1;
        }
        continue;
      }

      if (!flushCurrent()) return;

      const nextCharacter = command[index + 1];
      if (
        nextCharacter &&
        ((character === "|" && nextCharacter === "|") ||
          (character === "&" && nextCharacter === "&"))
      ) {
        if (
          !appendToken({
            value: `${character}${nextCharacter}`,
            quoted: false,
          })
        )
          return;
        index += 1;
        continue;
      }

      if (!appendToken({ value: character, quoted: false })) return;
      continue;
    }

    if (character === "<" || character === ">") {
      let prefix = "";
      const currentIsUnquoted = currentHasUnquoted && !currentHasQuoted;
      if (currentIsUnquoted && (current === "&" || /^\d+$/u.test(current))) {
        prefix = current;
        current = "";
        currentHasUnquoted = false;
      } else if (current.length > 0 || currentHasQuoted) {
        if (!flushCurrent()) return;
      }

      const next1 = command[index + 1];
      const next2 = command[index + 2];

      let op = character;
      let consumed = 1;

      if (character === ">") {
        if (next1 === ">") {
          op = ">>";
          consumed = 2;
        } else if (next1 === "|") {
          op = ">|";
          consumed = 2;
        } else if (next1 === "(") {
          op = ">(";
          consumed = 2;
        } else if (next1 === "&") {
          op = ">&";
          consumed = 2;
        }
      } else {
        if (next1 === "<" && next2 === "<") {
          op = "<<<";
          consumed = 3;
        } else if (next1 === "<" && next2 === "-") {
          op = "<<-";
          consumed = 3;
        } else if (next1 === "<") {
          op = "<<";
          consumed = 2;
        } else if (next1 === "(") {
          op = "<(";
          consumed = 2;
        } else if (next1 === ">") {
          op = "<>";
          consumed = 2;
        }
      }

      if (!appendToken({ value: `${prefix}${op}`, quoted: false })) return;
      index += consumed - 1;
      continue;
    }

    current += character;
    recordUnquoted();
  }

  if (escaping) {
    current += "\\";
    recordUnquoted();
  }
  if (!flushCurrent()) return;

  if (segment.length > 0) visit(segment);
}

const ENV_ASSIGNMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;

const SEARCH_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set([
  "-g",
  "--glob",
  "-t",
  "--type",
  "-T",
  "--type-not",
  "-A",
  "--after-context",
  "-B",
  "--before-context",
  "-C",
  "--context",
  "-m",
  "--max-count",
]);

const FIND_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-type",
  "-maxdepth",
  "-mindepth",
  "-size",
  "-mtime",
  "-mmin",
  "-user",
  "-group",
  "-perm",
  "-regex",
  "-iregex",
]);

const HEAD_TAIL_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set(["-n", "-c"]);
const NO_FLAGS_WITH_VALUE: ReadonlySet<string> = new Set();

type SegmentClassification =
  | { kind: "write" }
  | { kind: "intent"; intent: EventProjectionToolParsedIntent }
  | { kind: "none" };

interface RedirectScan {
  isWrite: boolean;
  consumedExtra: number;
}

function baseExecutableName(token: string): string {
  const slash = token.lastIndexOf("/");
  return slash >= 0 ? token.slice(slash + 1) : token;
}

function isSedInPlaceFlag(token: string): boolean {
  if (token === "--in-place") return true;
  if (token.startsWith("--in-place=")) return true;
  return /^-i(?:$|[^-])/u.test(token);
}

function scanRedirectAt(
  tokens: readonly ShellToken[],
  index: number,
): RedirectScan | null {
  const token = tokens[index];
  if (token === undefined) return null;
  if (token.quoted) return null;

  const value = token.value;
  const nextValue = tokens[index + 1]?.value;

  if (/^(?:\d+|&)?<<-?$/u.test(value)) {
    return { isWrite: true, consumedExtra: 1 };
  }

  if (/^(?:\d+|&)?<<<$/u.test(value)) {
    return { isWrite: false, consumedExtra: 1 };
  }

  if (value === "<(" || value === ">(") {
    let extra = 0;
    for (let j = index + 1; j < tokens.length; j += 1) {
      extra += 1;
      if (tokens[j]!.value.endsWith(")")) break;
    }
    return { isWrite: false, consumedExtra: extra };
  }

  if (/^(?:\d+|&)?<>$/u.test(value)) {
    return { isWrite: true, consumedExtra: 1 };
  }

  if (/^(?:\d+|&)?<$/u.test(value)) {
    return { isWrite: false, consumedExtra: 1 };
  }

  if (/^(?:\d+|&)?>\|$/u.test(value)) {
    if (nextValue === "/dev/null") return { isWrite: false, consumedExtra: 1 };
    return { isWrite: true, consumedExtra: 1 };
  }

  if (/^(\d*|&)>>?&$/u.test(value)) {
    if (nextValue === undefined) return { isWrite: false, consumedExtra: 0 };
    return { isWrite: false, consumedExtra: 1 };
  }

  const opMatch = /^(\d+|&)?>>?$/u.exec(value);
  if (opMatch) {
    const prefix = opMatch[1] ?? "";
    if (nextValue === undefined) return { isWrite: false, consumedExtra: 0 };

    if (/^[2-9]/u.test(prefix)) return { isWrite: false, consumedExtra: 1 };

    if (nextValue === "/dev/null") return { isWrite: false, consumedExtra: 1 };

    return { isWrite: true, consumedExtra: 1 };
  }

  return null;
}

function getCommandTokenIndex(tokens: readonly ShellToken[]): number {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined || token.quoted) break;
    if (!ENV_ASSIGNMENT_PATTERN.test(token.value)) break;
    index += 1;
  }
  return index;
}

function segmentHasWriteShape(argTokens: readonly ShellToken[]): boolean {
  let i = 0;
  while (i < argTokens.length) {
    const redir = scanRedirectAt(argTokens, i);
    if (redir) {
      if (redir.isWrite) return true;
      i += 1 + redir.consumedExtra;
      continue;
    }
    i += 1;
  }
  return false;
}

function collectPositionals(
  argTokens: readonly ShellToken[],
  flagsWithValue: ReadonlySet<string>,
): string[] {
  const positionals: string[] = [];
  let i = 0;
  while (i < argTokens.length) {
    const token = argTokens[i]!;

    const redir = scanRedirectAt(argTokens, i);
    if (redir) {
      i += 1 + redir.consumedExtra;
      continue;
    }

    if (!token.quoted && token.value.startsWith("-") && token.value !== "-") {
      if (flagsWithValue.has(token.value)) {
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    positionals.push(token.value);
    i += 1;
  }
  return positionals;
}

function classifyShellSegment(
  tokens: readonly ShellToken[],
  fullCommand: string,
): SegmentClassification {
  const commandIndex = getCommandTokenIndex(tokens);
  const commandToken = tokens[commandIndex];
  if (commandToken === undefined) return { kind: "none" };

  const argTokens = tokens.slice(commandIndex + 1);
  const commandName = baseExecutableName(commandToken.value);

  if (commandName === "tee") return { kind: "write" };
  if (
    commandName === "sed" &&
    argTokens.some((t) => !t.quoted && isSedInPlaceFlag(t.value))
  ) {
    return { kind: "write" };
  }
  if (segmentHasWriteShape(argTokens)) return { kind: "write" };

  switch (commandName) {
    case "rg":
    case "grep": {
      const positionals = collectPositionals(
        argTokens,
        SEARCH_FLAGS_WITH_VALUE,
      );
      return {
        kind: "intent",
        intent: {
          type: "search",
          cmd: fullCommand,
          query: positionals[0] ?? null,
          path:
            positionals.length > 1
              ? positionals[positionals.length - 1]!
              : null,
        },
      };
    }
    case "find": {
      const positionals = collectPositionals(argTokens, FIND_FLAGS_WITH_VALUE);
      const path = positionals[0];
      if (!path) return { kind: "none" };
      return {
        kind: "intent",
        intent: { type: "list_files", cmd: fullCommand, path },
      };
    }
    case "ls": {
      const positionals = collectPositionals(argTokens, NO_FLAGS_WITH_VALUE);
      const path = positionals[0] ?? ".";
      return {
        kind: "intent",
        intent: { type: "list_files", cmd: fullCommand, path },
      };
    }
    case "cat":
    case "nl": {
      const positionals = collectPositionals(argTokens, NO_FLAGS_WITH_VALUE);
      const path = positionals[0];
      if (!path) return { kind: "none" };
      return {
        kind: "intent",
        intent: { type: "read", cmd: fullCommand, name: commandName, path },
      };
    }
    case "head":
    case "tail": {
      const positionals = collectPositionals(
        argTokens,
        HEAD_TAIL_FLAGS_WITH_VALUE,
      );
      const path = positionals[0];
      if (!path) return { kind: "none" };
      return {
        kind: "intent",
        intent: { type: "read", cmd: fullCommand, name: commandName, path },
      };
    }
    case "sed": {
      if (!argTokens.some((t) => !t.quoted && t.value === "-n")) {
        return { kind: "none" };
      }
      const positionals = collectPositionals(argTokens, NO_FLAGS_WITH_VALUE);
      const path = positionals[1];
      if (!path) return { kind: "none" };
      return {
        kind: "intent",
        intent: { type: "read", cmd: fullCommand, name: "sed", path },
      };
    }
    default:
      return { kind: "none" };
  }
}

export function parseShellCommandIntents(
  command: string | undefined,
): EventProjectionToolParsedIntent[] {
  if (!command) return [];

  let intents: EventProjectionToolParsedIntent[] = [];
  visitShellCommandSegments(command, (segment) => {
    const classification = classifyShellSegment(segment, command);
    if (classification.kind === "write") {
      intents = [];
      return false;
    }
    if (classification.kind === "intent" && intents.length === 0) {
      intents.push(classification.intent);
    }
    return true;
  });
  return intents;
}

const THREAD_TELL_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--message-file",
  "--model",
  "--service-tier",
  "--reasoning-level",
  "--permission-mode",
  "--mode",
]);

const THREAD_TELL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "--json",
  "--plan",
]);

const THREAD_TELL_HINT = /\bthread\s+(?:tell|message)\b/u;
const BB_CLI_TOKEN = /^\$\{?BB_CLI(?::-[^}]*)?\}?$/u;
const SHELL_VARIABLE_TOKEN = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/u;
const SHELL_EXPANSION = /[$`]/u;
const HEREDOC_ASSIGNMENT =
  /^([A-Za-z_][A-Za-z0-9_]*)=\$\(cat <<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3[ \t]*\n([\s\S]*?)\n(\t*)\4\n[ \t]*\)[ \t]*\n([^\n]*)$/u;
const STDIN_HEREDOC =
  /^([^\n]*?)<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3[ \t]*\n([\s\S]*?)\n(\t*)\4$/u;

export interface ThreadTellCommand {
  threadId: string;
  message: string;
}

interface ThreadTellScript {
  line: string;
  stdin: string | null;
  variable: { name: string; value: string } | null;
}

interface HeredocMatch {
  body: string;
  dash: string;
  quote: string;
  terminatorTabs: string;
}

function heredocBody({
  body,
  dash,
  quote,
  terminatorTabs,
}: HeredocMatch): string | null {
  if (terminatorTabs !== "" && dash !== "-") return null;
  if (quote === "" && /[$`\\]/u.test(body)) return null;
  return dash === "-" ? body.replace(/^\t+/gmu, "") : body;
}

function splitThreadTellScript(script: string): ThreadTellScript | null {
  let line = script.trim();
  let variable: ThreadTellScript["variable"] = null;
  const assignment = HEREDOC_ASSIGNMENT.exec(line);
  if (assignment) {
    const [, name, dash, quote, , body, terminatorTabs, rest] = assignment;
    const value = heredocBody({
      body: body!,
      dash: dash!,
      quote: quote!,
      terminatorTabs: terminatorTabs!,
    });
    if (value === null) return null;
    variable = { name: name!, value };
    line = rest!.trim();
  }
  let stdin: string | null = null;
  const piped = STDIN_HEREDOC.exec(line);
  if (piped) {
    const [, head, dash, quote, , body, terminatorTabs] = piped;
    stdin = heredocBody({
      body: body!,
      dash: dash!,
      quote: quote!,
      terminatorTabs: terminatorTabs!,
    });
    if (stdin === null) return null;
    line = head!.trim();
  }
  return { line, stdin, variable };
}

function resolveThreadTellMessage(
  value: string,
  variable: ThreadTellScript["variable"],
): string | null {
  const name = SHELL_VARIABLE_TOKEN.exec(value)?.[1];
  if (name !== undefined) {
    return variable !== null && variable.name === name ? variable.value : null;
  }
  return SHELL_EXPANSION.test(value) ? null : value;
}

function parseThreadTellSegment(
  tokens: readonly ShellToken[],
  script: ThreadTellScript,
): ThreadTellCommand | null {
  const commandIndex = getCommandTokenIndex(tokens);
  const [cli, group, verb, ...argTokens] = tokens.slice(commandIndex);
  if (
    cli === undefined ||
    (baseExecutableName(cli.value) !== "bb" && !BB_CLI_TOKEN.test(cli.value)) ||
    group?.value !== "thread" ||
    (verb?.value !== "tell" && verb?.value !== "message")
  ) {
    return null;
  }
  const positionals: string[] = [];
  let messageFile: string | null = null;
  for (let index = 0; index < argTokens.length; index += 1) {
    const token = argTokens[index]!;
    const redirect = scanRedirectAt(argTokens, index);
    if (redirect) {
      index += redirect.consumedExtra;
      continue;
    }
    if (!token.quoted && token.value.startsWith("-") && token.value !== "-") {
      const equals = token.value.indexOf("=");
      const flag = equals === -1 ? token.value : token.value.slice(0, equals);
      if (THREAD_TELL_BOOLEAN_FLAGS.has(flag) && equals === -1) continue;
      if (!THREAD_TELL_VALUE_FLAGS.has(flag)) return null;
      let value: string | undefined = token.value.slice(equals + 1);
      if (equals === -1) {
        index += 1;
        value = argTokens[index]?.value;
      }
      if (flag === "--message-file") messageFile = value ?? null;
      continue;
    }
    positionals.push(token.value);
  }
  const [threadId, messageArg, ...extra] = positionals;
  let message: string | null = null;
  if (messageArg !== undefined && messageFile === null) {
    message = resolveThreadTellMessage(messageArg, script.variable);
  } else if (messageArg === undefined && messageFile === "-") {
    message = script.stdin;
  }
  if (
    extra.length > 0 ||
    threadId === undefined ||
    !rawThreadIdSchema.safeParse(threadId).success ||
    message === null ||
    message.trim().length === 0
  ) {
    return null;
  }
  return { threadId, message };
}

export function parseThreadTellCommand(
  command: string,
): ThreadTellCommand | null {
  if (!THREAD_TELL_HINT.test(command)) return null;
  const unwrapped = extractShellCommandFromString(command);
  if (unwrapped === undefined) return null;
  const script = splitThreadTellScript(unwrapped);
  if (script === null) return null;
  const segments: ShellToken[][] = [];
  visitShellCommandSegments(script.line, (segment) => {
    segments.push(segment);
    return segments.length < 2;
  });
  return segments.length === 1
    ? parseThreadTellSegment(segments[0]!, script)
    : null;
}

interface CommandCall {
  command: string;
  exitCode: number | null;
  status: string;
}

export function parseSentThreadMessage({
  command,
  exitCode,
  status,
}: CommandCall): ThreadTellCommand | null {
  if (status !== "completed" || (exitCode !== null && exitCode !== 0)) {
    return null;
  }
  return parseThreadTellCommand(command);
}
