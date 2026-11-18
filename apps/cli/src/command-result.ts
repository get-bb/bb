import { CliExitError } from "./action.js";
import { noteJsonPayloadWritten } from "./cli-error-output.js";
import type { JsonOutputOptions } from "./commands/helpers.js";

export interface CommandFailure {
  message: string;
  code: string;
  hint: string | null;
}

export interface CommandOutcome {
  text: readonly string[] | (() => void);
  failure: CommandFailure | null;
}

export function reportCommandResult(
  opts: JsonOutputOptions,
  result: unknown,
  outcome: CommandOutcome,
): void {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    noteJsonPayloadWritten();
  } else if (typeof outcome.text === "function") {
    outcome.text();
  } else {
    for (const line of outcome.text) console.log(line);
  }
  if (outcome.failure !== null) {
    throw new CliExitError(outcome.failure.message, 1, {
      code: outcome.failure.code,
      hint: outcome.failure.hint,
    });
  }
}
