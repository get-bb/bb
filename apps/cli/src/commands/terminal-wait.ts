import { Buffer } from "node:buffer";
import { stripVTControlCharacters } from "node:util";
import {
  BbHttpError,
  type BbSdk,
  type TerminalOutputArgs,
  type TerminalOutputResult,
  type TerminalGetResult,
} from "@bb/sdk";
import { CliUsageError } from "../action.js";

const MATCH_WINDOW_CHARS = 256 * 1024;
const UNREADABLE_OUTPUT_ERROR_CODES = new Set([
  "host_disconnected",
  "terminal_output_unavailable",
]);

export type TerminalOutputCondition =
  | { kind: "contains"; text: string }
  | { kind: "regex"; pattern: RegExp };

export type TerminalWaitOutcome =
  | { kind: "exited"; exitCode: number | null; nextSeq: number; text: string }
  | { kind: "matched"; exitCode: number | null; nextSeq: number }
  | { kind: "timed-out"; nextSeq: number; text: string };

export interface WaitForTerminalConditionArgs {
  condition: TerminalOutputCondition | null;
  outputBounds: Pick<TerminalOutputArgs, "limitChunks" | "tailBytes">;
  pollDelaysMs: readonly [number, ...number[]];
  sdk: BbSdk;
  sinceSeq: number;
  terminalId: string;
  timeoutMs: number;
}

export function parseTerminalOutputCondition(args: {
  contains?: string;
  regex?: string;
}): TerminalOutputCondition | null {
  if (args.contains !== undefined && args.regex !== undefined) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: "Provide only one of --contains or --regex",
    });
  }
  if (args.contains !== undefined) {
    return { kind: "contains", text: args.contains };
  }
  if (args.regex !== undefined) {
    return { kind: "regex", pattern: new RegExp(args.regex, "u") };
  }
  return null;
}

export function terminalPlainText(text: string): string {
  return stripVTControlCharacters(text)
    .split("\n")
    .map((line) => line.replace(/\r+$/u, "").split("\r").at(-1) ?? "")
    .join("\n");
}

export function terminalOutputConditionMatches(
  condition: TerminalOutputCondition,
  rawText: string,
): boolean {
  const text = terminalPlainText(rawText);
  return condition.kind === "contains"
    ? text.includes(condition.text)
    : condition.pattern.test(text);
}

interface OutputWatch {
  decoder: TextDecoder;
  nextSeq: number;
  seen: string;
}

export async function waitForTerminalCondition(
  args: WaitForTerminalConditionArgs,
): Promise<TerminalWaitOutcome> {
  const deadline = Date.now() + args.timeoutMs;
  const watch: OutputWatch = {
    decoder: new TextDecoder(),
    nextSeq: args.sinceSeq,
    seen: "",
  };
  for (let attempt = 0; ; attempt += 1) {
    const outcome =
      args.condition === null
        ? await checkExited(args, watch)
        : await checkOutput(args, args.condition, watch);
    if (outcome !== null) {
      return outcome;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        kind: "timed-out",
        nextSeq: watch.nextSeq,
        text: terminalPlainText(watch.seen),
      };
    }
    const delayMs =
      args.pollDelaysMs[Math.min(attempt, args.pollDelaysMs.length - 1)] ??
      args.pollDelaysMs[0];
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(delayMs, remainingMs)),
    );
  }
}

async function checkExited(
  args: WaitForTerminalConditionArgs,
  watch: OutputWatch,
): Promise<TerminalWaitOutcome | null> {
  const session = await args.sdk.terminals.get({
    terminalId: args.terminalId,
  });
  return session.status === "exited"
    ? {
        kind: "exited",
        exitCode: session.exitCode,
        nextSeq: watch.nextSeq,
        text: "",
      }
    : null;
}

async function checkOutput(
  args: WaitForTerminalConditionArgs,
  condition: TerminalOutputCondition,
  watch: OutputWatch,
): Promise<TerminalWaitOutcome | null> {
  const read = await readOutputOrSession(args, watch.nextSeq);
  if (read.kind === "session") {
    return read.session.status === "exited"
      ? {
          kind: "exited",
          exitCode: read.session.exitCode,
          nextSeq: watch.nextSeq,
          text: terminalPlainText(watch.seen),
        }
      : null;
  }
  const { output } = read;
  watch.nextSeq = output.nextSeq;
  const searched = `${watch.seen}${output.chunks
    .map((chunk) =>
      watch.decoder.decode(Buffer.from(chunk.dataBase64, "base64"), {
        stream: true,
      }),
    )
    .join("")}`;
  watch.seen = searched.slice(-MATCH_WINDOW_CHARS);
  if (terminalOutputConditionMatches(condition, searched)) {
    return {
      kind: "matched",
      exitCode: output.exitCode,
      nextSeq: watch.nextSeq,
    };
  }
  return output.status === "exited"
    ? {
        kind: "exited",
        exitCode: output.exitCode,
        nextSeq: watch.nextSeq,
        text: terminalPlainText(watch.seen),
      }
    : null;
}

async function readOutputOrSession(
  args: WaitForTerminalConditionArgs,
  sinceSeq: number,
): Promise<
  | { kind: "output"; output: TerminalOutputResult }
  | { kind: "session"; session: TerminalGetResult }
> {
  try {
    return {
      kind: "output",
      output: await args.sdk.terminals.output({
        terminalId: args.terminalId,
        ...args.outputBounds,
        sinceSeq,
      }),
    };
  } catch (error) {
    if (
      !(error instanceof BbHttpError) ||
      error.code === null ||
      !UNREADABLE_OUTPUT_ERROR_CODES.has(error.code)
    ) {
      throw error;
    }
    const session = await args.sdk.terminals.get({
      terminalId: args.terminalId,
    });
    if (session.status !== "exited" && session.status !== "disconnected") {
      throw error;
    }
    return { kind: "session", session };
  }
}
