import type {
  CarriesFailureState,
  OperationResponse,
} from "@bb/server-contract";
import { CliExitError } from "./action.js";
import { noteJsonPayloadWritten } from "./cli-error-output.js";

export interface JsonOutputOptions {
  json?: boolean;
}

export interface CommandFailure {
  message: string;
  code: string;
  hint: string | null;
  exitCode?: number;
}

export interface CommandOutcome {
  text: readonly string[] | (() => void);
  failure: CommandFailure | null;
}

type IsUntyped<T> = 0 extends 1 & T
  ? true
  : unknown extends T
    ? true
    : T extends object
      ? string extends keyof T
        ? unknown extends T[keyof T]
          ? true
          : false
        : [keyof T] extends [never]
          ? true
          : false
      : false;

export type ReportableWithoutFailure<T> =
  IsUntyped<T> extends true
    ? {
        "Give this result a concrete type, or print it with reportCommandResult": never;
      }
    : true extends CarriesFailureState<T>
      ? {
          "This result can report a failure; print it with reportCommandResult": never;
        }
      : unknown;

function writeJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
  noteJsonPayloadWritten();
}

export function outputJson<const T>(
  opts: JsonOutputOptions,
  data: T & ReportableWithoutFailure<T>,
): boolean {
  if (!opts.json) return false;
  writeJson(data);
  return true;
}

export function printJsonResult<const T>(
  data: T & ReportableWithoutFailure<T>,
): void {
  writeJson(data);
}

export function printJsonLine<const T>(
  data: T & ReportableWithoutFailure<T>,
): void {
  console.log(JSON.stringify(data));
  noteJsonPayloadWritten();
}

export function reportCommandResult(
  opts: JsonOutputOptions,
  result: unknown,
  outcome: CommandOutcome,
): void {
  if (opts.json) {
    writeJson(result);
  } else if (typeof outcome.text === "function") {
    outcome.text();
  } else {
    for (const line of outcome.text) console.log(line);
  }
  if (outcome.failure !== null) {
    throw new CliExitError(
      outcome.failure.message,
      outcome.failure.exitCode ?? 1,
      { code: outcome.failure.code, hint: outcome.failure.hint },
    );
  }
}

export function passThroughExitCode(exitCode: number): void {
  process.exitCode = exitCode;
}

export interface OperationText {
  complete: string;
  inProgress: string;
}

export function reportOperation<
  Result extends OperationResponse & { warnings?: readonly string[] },
>(opts: JsonOutputOptions, result: Result, text: OperationText): void {
  for (const warning of result.warnings ?? []) {
    console.error(`Warning: ${warning}`);
  }
  reportCommandResult(opts, result, {
    text: [result.progress === "complete" ? text.complete : text.inProgress],
    failure: null,
  });
}
