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
      const error = err instanceof Error ? err : new Error(String(err));
      if (isProcessExitError(error)) {
        throw err;
      }
      if (error instanceof CliExitError) {
        console.error(`Error: ${error.message}`);
        process.exit(error.exitCode);
        return;
      }
      console.error(`Error: ${getErrorMessage(error)}`);
      process.exit(1);
    }
  };
}

function isProcessExitError(error: Error): boolean {
  return error.message.startsWith("process.exit:");
}
