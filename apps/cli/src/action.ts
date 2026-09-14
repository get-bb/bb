import { getErrorMessage } from "./commands/helpers.js";

export class CliExitError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode: number) {
    super(message);
    this.name = "CliExitError";
    this.exitCode = exitCode;
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
    try {
      await fn(...args);
    } catch (err: unknown) {
      if (isProcessExitError(err)) {
        throw err;
      }
      if (err instanceof CliExitError) {
        console.error(`Error: ${err.message}`);
        // bb-fork(windows): process.exit truncates pending stdout on Windows;
        // rethrow and set exitCode in main() instead.
        throw err;
      }
      console.error(`Error: ${getErrorMessage(err)}`);
      throw new CliExitError(getErrorMessage(err), 1);
    }
  };
}

function isProcessExitError(err: unknown): boolean {
  return err instanceof Error && err.message.startsWith("process.exit:");
}
