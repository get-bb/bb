import type { Command, CommanderError } from "commander";
import {
  formatCommandList,
  formatOptionList,
  formatUsageLine,
  type ResolvedInvocation,
  resolveInvocation,
  suggestCommand,
  suggestOption,
} from "./command-resolution.js";
import { isJsonInvocation, writeCliErrorEnvelope } from "./cli-error-output.js";
import {
  contextProjectId,
  contextThreadId,
  missingEnvironmentHint,
  missingHostHint,
  missingProjectHint,
  missingThreadFlagHint,
  type ResolveContextHostId,
} from "./context-hints.js";

const ERROR_CODE_BY_COMMANDER_CODE: Readonly<Record<string, string>> = {
  "commander.unknownCommand": "unknown_command",
  "commander.unknownOption": "unknown_option",
  "commander.missingMandatoryOptionValue": "missing_required",
  "commander.missingArgument": "missing_required",
  "commander.excessArguments": "unexpected_argument",
  "commander.optionMissingArgument": "invalid_value",
  "commander.invalidArgument": "invalid_value",
  "commander.conflictingOption": "invalid_value",
  "commander.help": "missing_command",
};

export interface CommanderErrorSummary {
  code: string;
  hintLines: string[];
  message: string;
  token: string | null;
}

function quotedToken(message: string): string | null {
  const match = /'([^']+)'/.exec(message);
  return match === null ? null : match[1];
}

function flagName(token: string | null): string | null {
  if (token === null) return null;
  const match = /^(--[a-z][\w-]*)/.exec(token);
  return match === null ? null : match[1];
}

async function missingOptionHint(
  flag: string | null,
  resolveHostId: ResolveContextHostId,
): Promise<string | null> {
  switch (flag) {
    case "--project":
      return missingProjectHint();
    case "--thread":
      return missingThreadFlagHint();
    case "--environment":
      return missingEnvironmentHint();
    case "--host":
    case "--machine":
      return missingHostHint(flag, resolveHostId);
    case "--prompt":
      return "Pass --prompt <text>, or --prompt-file <path> (use - to read stdin).";
    case "--instance":
    case "--generation":
      return "List desktop browser instances with `bb browser instances --host <id> --json`.";
    default:
      return null;
  }
}

function missingArgumentHint(
  argumentName: string | null,
  invocation: ResolvedInvocation,
): string | null {
  const group = invocation.path[0];
  if (argumentName === "id" && group === "project") {
    const projectId = contextProjectId();
    return projectId === null
      ? "List project IDs with `bb project list`."
      : `This thread's project is ${projectId}.`;
  }
  if (argumentName === "id" && group === "thread") {
    const threadId = contextThreadId();
    return threadId === null
      ? "List thread IDs with `bb thread list`."
      : `The current thread is ${threadId}.`;
  }
  if (argumentName === "terminalId") {
    const threadId = contextThreadId();
    return threadId === null
      ? "List terminal IDs with `bb terminal list --thread <id>`."
      : `List this thread's terminal IDs with \`bb terminal list --thread ${threadId}\`.`;
  }
  return null;
}

export async function summarizeCommanderError(args: {
  argv: readonly string[];
  error: CommanderError;
  program: Command;
  resolveHostId: ResolveContextHostId;
}): Promise<CommanderErrorSummary> {
  const invocation = resolveInvocation(args.program, args.argv);
  const message = args.error.message.replace(/^error: /u, "");
  const token = quotedToken(message);
  const hintLines: string[] = [];
  switch (args.error.code) {
    case "commander.unknownCommand": {
      const suggestion = suggestCommand(invocation);
      if (suggestion !== null) hintLines.push(`Did you mean: ${suggestion}?`);
      hintLines.push(`Commands: ${formatCommandList(invocation.command)}`);
      if (invocation.path.length === 0 && token !== null) {
        hintLines.push(
          `Plugins add commands only while they are installed and enabled. If '${token}' is a plugin command, check \`bb plugin list\`.`,
        );
      }
      break;
    }
    case "commander.missingMandatoryOptionValue": {
      const hint = await missingOptionHint(flagName(token), args.resolveHostId);
      if (hint !== null) hintLines.push(hint);
      hintLines.push(formatUsageLine(invocation));
      break;
    }
    case "commander.missingArgument": {
      const hint = missingArgumentHint(token, invocation);
      if (hint !== null) hintLines.push(hint);
      hintLines.push(formatUsageLine(invocation));
      break;
    }
    case "commander.unknownOption": {
      const suggestion =
        token === null ? null : suggestOption(invocation.command, token);
      if (suggestion !== null) hintLines.push(`Did you mean ${suggestion}?`);
      hintLines.push(formatUsageLine(invocation));
      const options = formatOptionList(invocation.command);
      if (options.length > 0) hintLines.push(`Options: ${options}`);
      break;
    }
    case "commander.optionMissingArgument":
    case "commander.invalidArgument":
    case "commander.conflictingOption":
    case "commander.excessArguments": {
      hintLines.push(formatUsageLine(invocation));
      const options = formatOptionList(invocation.command);
      if (options.length > 0) hintLines.push(`Options: ${options}`);
      break;
    }
    default:
      break;
  }
  return {
    code: ERROR_CODE_BY_COMMANDER_CODE[args.error.code] ?? "usage_error",
    hintLines,
    message,
    token,
  };
}

export function commandPathLabel(
  program: Command,
  argv: readonly string[],
): string {
  return resolveInvocation(program, argv).path.join(" ");
}

export function writeCommanderErrorSummary(
  summary: CommanderErrorSummary,
  argv: readonly string[],
): void {
  for (const line of summary.hintLines) console.error(line);
  writeCliErrorEnvelope(
    {
      code: summary.code,
      hint:
        summary.hintLines.length === 0 ? null : summary.hintLines.join("\n"),
      message: summary.message,
    },
    isJsonInvocation(argv),
  );
}
