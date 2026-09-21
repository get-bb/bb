import { Command } from "commander";
import { BbHttpError } from "@bb/sdk";
import {
  beginJsonOutputTracking,
  isJsonInvocation,
  writeCliErrorEnvelope,
} from "./cli-error-output.js";
import { CliUsageError } from "./cli-usage-error.js";
import { getErrorMessage } from "./commands/helpers.js";
import { resolveBbCliVersion } from "./version.js";

export { CliUsageError } from "./cli-usage-error.js";

export interface CliExitErrorDetails {
  code: string;
  hint: string | null;
}

export class CliExitError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly hint: string | null;
  constructor(
    message: string,
    exitCode: number,
    details: CliExitErrorDetails = { code: "error", hint: null },
  ) {
    super(message);
    this.name = "CliExitError";
    this.code = details.code;
    this.exitCode = exitCode;
    this.hint = details.hint;
  }
}

type CommandActionArgs = readonly unknown[];
type CommandAction<TArgs extends CommandActionArgs> = (
  ...args: TArgs
) => Promise<void>;

export function action<TArgs extends CommandActionArgs>(
  fn: CommandAction<TArgs>,
): CommandAction<TArgs> {
  return async (...args) => {
    beginJsonOutputTracking();
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (isProcessExitError(err)) {
        throw err;
      }
      const exitCode = err instanceof CliExitError ? err.exitCode : 1;
      const message =
        err instanceof CliExitError ? err.message : getErrorMessage(err);
      const hint =
        err instanceof CliUsageError || err instanceof CliExitError
          ? err.hint
          : null;
      const code = actionErrorCode(err);
      console.error(`Error: ${message}`);
      if (hint !== null) console.error(hint);
      writeCliErrorEnvelope({ code, hint, message }, wantsJson(args));
      await logActionError({ code, command: commandPath(args), exitCode });
      // bb-fork(windows): process.exit truncates pending stdout on Windows;
      // throw so main() sets process.exitCode after the streams drain.
      throw new CliExitError(message, exitCode, { code, hint });
    }
  };
}

function actionErrorCode(err: unknown): string {
  if (err instanceof CliUsageError || err instanceof CliExitError) {
    return err.code;
  }
  if (err instanceof BbHttpError) return err.code ?? `http_${err.status}`;
  return "error";
}

function invokedCommand(args: CommandActionArgs): Command | null {
  const last = args[args.length - 1];
  return last instanceof Command ? last : null;
}

function wantsJson(args: CommandActionArgs): boolean {
  const command = invokedCommand(args);
  if (command === null) return isJsonInvocation();
  const opts = command.opts<{ format?: string; json?: boolean }>();
  return opts.json === true || opts.format === "json";
}

function commandPath(args: CommandActionArgs): string {
  const last = invokedCommand(args);
  if (last === null) return "";
  const names: string[] = [];
  for (
    let current: Command | null = last;
    current !== null && current.parent !== null;
    current = current.parent
  ) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

async function logActionError(args: {
  code: string;
  command: string;
  exitCode: number;
}): Promise<void> {
  try {
    const { appendCliErrorLogEntry } = await import("./cli-error-log.js");
    appendCliErrorLogEntry({
      at: new Date().toISOString(),
      cliVersion: resolveBbCliVersion(),
      code: args.code,
      command: args.command,
      exitCode: args.exitCode,
      threadId: process.env.BB_THREAD_ID ?? null,
      token: null,
    });
  } catch {}
}

function isProcessExitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("process.exit:");
}
