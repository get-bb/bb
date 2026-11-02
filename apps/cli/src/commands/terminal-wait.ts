import { Buffer } from "node:buffer";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import {
  BbHttpError,
  type BbSdk,
  type TerminalOutputArgs,
  type TerminalOutputResult,
  type TerminalGetResult,
} from "@bb/sdk";
import type { TerminalSession } from "@bb/server-contract";
import { CliExitError, CliUsageError } from "../action.js";
import { outputJson } from "./helpers.js";

const MATCH_WINDOW_CHARS = 256 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const STILL_RUNNING_EXIT_CODE = 124;
const UNREADABLE_OUTPUT_ERROR_CODES = new Set([
  "host_disconnected",
  "terminal_output_unavailable",
]);
const httpErrorMessageBodySchema = z.object({ message: z.string().min(1) });

export const DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES = String(64 * 1024);

export type TerminalOutputCondition =
  | { kind: "contains"; text: string }
  | { kind: "regex"; pattern: RegExp };

type TerminalWaitOutcome = "exited" | "matched" | "timed-out";

export interface TerminalObservePlan {
  condition: TerminalOutputCondition | null;
  maxOutputBytes: number;
  outputBounds: Pick<TerminalOutputArgs, "limitChunks" | "tailBytes">;
  pollDelaysMs: readonly [number, ...number[]];
  sinceSeq: number;
  timeoutMs: number;
}

interface TerminalObservation {
  closeReason: TerminalSession["closeReason"];
  cwd: string;
  environmentId: string | null;
  exitCode: number | null;
  hostId: string;
  nextSeq: number;
  observation: TerminalWaitOutcome;
  output: string | null;
  status: TerminalSession["status"];
  terminalId: string;
  truncated: boolean;
}

interface TerminalObservationReport {
  condition: TerminalOutputCondition | null;
  outputUnavailable: string | null;
  result: TerminalObservation;
}

type TerminalOutputRead =
  | {
      closeReason: TerminalSession["closeReason"];
      exitCode: number | null;
      kind: "read";
      nextSeq: number;
      rawText: string;
      status: TerminalSession["status"];
      truncated: boolean;
    }
  | { kind: "unavailable"; message: string };

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

export function parseMaxOutputBytes(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (
    String(parsed) !== value ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_OUTPUT_BYTES
  ) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: `--max-output-bytes must be an integer from 1 to ${MAX_OUTPUT_BYTES}`,
    });
  }
  return parsed;
}

export function describeTerminalExit(
  terminalId: string,
  exitCode: number | null,
): string {
  return exitCode === null
    ? `Terminal ${terminalId} exited`
    : `Terminal ${terminalId} exited with code ${exitCode}`;
}

export function terminalPlainText(text: string): string {
  return stripVTControlCharacters(text)
    .split("\n")
    .map((line) => line.replace(/\r+$/u, "").split("\r").at(-1) ?? "")
    .join("\n");
}

function terminalOutputConditionMatches(
  condition: TerminalOutputCondition,
  rawText: string,
): boolean {
  const text = terminalPlainText(rawText);
  return condition.kind === "contains"
    ? text.includes(condition.text)
    : condition.pattern.test(text);
}

export async function observeTerminal(args: {
  plan: TerminalObservePlan;
  sdk: BbSdk;
  terminalId: string;
}): Promise<TerminalObservationReport> {
  const { condition } = args.plan;
  const outcome = await waitForTerminalCondition(args);
  const session = await args.sdk.terminals.get({
    terminalId: args.terminalId,
  });
  const output = await readTerminalOutputTail({
    maxOutputBytes: args.plan.maxOutputBytes,
    sdk: args.sdk,
    sinceSeq: args.plan.sinceSeq,
    terminalId: session.id,
  });
  const location = {
    cwd: session.initialCwd,
    environmentId: session.environmentId,
    hostId: session.hostId,
    terminalId: session.id,
  };
  if (output.kind === "unavailable") {
    if (session.status !== "exited") {
      throw new CliExitError(
        `${describeTerminalState({
          exitCode: session.exitCode,
          status: session.status,
          terminalId: session.id,
        })}, but its output is unavailable: ${output.message}`,
        1,
        {
          code: "terminal_output_unavailable",
          hint:
            session.status === "disconnected"
              ? `Continue with \`bb terminal wait ${session.id}\` once its machine reconnects.`
              : `Inspect it with \`bb terminal show ${session.id}\`.`,
        },
      );
    }
    return {
      condition,
      outputUnavailable: output.message,
      result: {
        ...location,
        closeReason: session.closeReason,
        exitCode: session.exitCode,
        nextSeq: args.plan.sinceSeq,
        observation: outcome === "matched" ? "matched" : "exited",
        output: null,
        status: session.status,
        truncated: false,
      },
    };
  }
  const matched =
    outcome === "matched" ||
    (condition !== null &&
      terminalOutputConditionMatches(condition, output.rawText));
  return {
    condition,
    outputUnavailable: null,
    result: {
      ...location,
      closeReason: output.closeReason,
      exitCode: output.exitCode,
      nextSeq: output.nextSeq,
      observation: matched
        ? "matched"
        : output.status === "exited"
          ? "exited"
          : "timed-out",
      output: terminalPlainText(output.rawText),
      status: output.status,
      truncated: output.truncated,
    },
  };
}

export function reportTerminalObservation(args: {
  json: boolean;
  report: TerminalObservationReport;
}): void {
  const { result } = args.report;
  if (!outputJson({ json: args.json }, result)) {
    if (result.output !== null) {
      process.stdout.write(result.output);
    }
    for (const line of observationStatusLines(args.report)) {
      console.error(line);
    }
  }
  process.exitCode = observationExitCode(args.report);
}

function observationExitCode(report: TerminalObservationReport): number {
  const { result } = report;
  switch (result.observation) {
    case "matched":
      return 0;
    case "timed-out":
      return STILL_RUNNING_EXIT_CODE;
    case "exited":
      if (
        report.condition !== null ||
        result.closeReason !== "process-exit" ||
        result.exitCode === null
      ) {
        return 1;
      }
      return result.exitCode;
  }
}

function observationStatusLines(report: TerminalObservationReport): string[] {
  const { result } = report;
  const id = result.terminalId;
  const lines: string[] = [];
  if (report.outputUnavailable !== null) {
    lines.push(`Its output is unavailable: ${report.outputUnavailable}`);
  }
  if (result.truncated) {
    lines.push(
      `Earlier output is not shown; read what the machine still has with \`bb terminal output ${id}\`.`,
    );
  }
  switch (result.observation) {
    case "matched":
      lines.push(
        result.status === "exited"
          ? `Terminal ${id} printed the expected output, then exited.`
          : `Terminal ${id} printed the expected output and is still running. Stop it with \`bb terminal close ${id}\`.`,
      );
      break;
    case "timed-out":
      lines.push(
        `Terminal ${id} is still running. Continue with \`bb terminal wait ${id} --since-seq ${result.nextSeq}${conditionFlag(report.condition)}\`, or stop it with \`bb terminal close ${id}\`.`,
      );
      break;
    case "exited":
      if (result.closeReason !== "process-exit") {
        lines.push(
          `Terminal ${id} was closed (${result.closeReason ?? "unknown reason"}) before the command finished.`,
        );
      } else if (report.condition !== null) {
        lines.push(
          `${describeTerminalExit(id, result.exitCode)} before the expected output appeared.`,
        );
      } else if (result.exitCode !== 0) {
        lines.push(`${describeTerminalExit(id, result.exitCode)}.`);
      }
      break;
  }
  return lines;
}

function conditionFlag(condition: TerminalOutputCondition | null): string {
  if (condition === null) {
    return "";
  }
  return condition.kind === "contains"
    ? ` --contains ${shellWord(condition.text)}`
    : ` --regex ${shellWord(condition.pattern.source)}`;
}

function shellWord(value: string): string {
  return /^[\w@%+=:,./-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function describeTerminalState(
  state: Pick<TerminalObservation, "exitCode" | "status" | "terminalId">,
): string {
  switch (state.status) {
    case "exited":
      return describeTerminalExit(state.terminalId, state.exitCode);
    case "disconnected":
      return `Terminal ${state.terminalId} lost its connection to its machine`;
    case "starting":
    case "running":
      return `Terminal ${state.terminalId} is still running`;
  }
}

async function readTerminalOutputTail(args: {
  maxOutputBytes: number;
  sdk: BbSdk;
  sinceSeq: number;
  terminalId: string;
}): Promise<TerminalOutputRead> {
  try {
    const output = await args.sdk.terminals.output({
      sinceSeq: args.sinceSeq,
      tailBytes: args.maxOutputBytes,
      terminalId: args.terminalId,
    });
    const bytes = Buffer.concat(
      output.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64")),
    );
    const tail = lastUtf8Bytes(bytes, args.maxOutputBytes);
    return {
      closeReason: output.closeReason,
      exitCode: output.exitCode,
      kind: "read",
      nextSeq: output.nextSeq,
      rawText: tail.toString("utf8"),
      status: output.status,
      truncated: output.truncated || tail.length < bytes.length,
    };
  } catch (error) {
    if (
      error instanceof BbHttpError &&
      error.code === "terminal_output_unavailable"
    ) {
      return { kind: "unavailable", message: serverErrorMessage(error) };
    }
    throw error;
  }
}

function lastUtf8Bytes(bytes: Buffer, maxBytes: number): Buffer {
  if (bytes.length <= maxBytes) {
    return bytes;
  }
  let start = bytes.length - maxBytes;
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
    start += 1;
  }
  return bytes.subarray(start);
}

function serverErrorMessage(error: BbHttpError): string {
  const body = httpErrorMessageBodySchema.safeParse(error.body);
  return body.success ? body.data.message : error.message;
}

interface WaitArgs {
  plan: TerminalObservePlan;
  sdk: BbSdk;
  terminalId: string;
}

interface OutputWatch {
  decoder: TextDecoder;
  nextSeq: number;
  seen: string;
}

async function waitForTerminalCondition(
  args: WaitArgs,
): Promise<TerminalWaitOutcome> {
  const { condition, pollDelaysMs } = args.plan;
  const deadline = Date.now() + args.plan.timeoutMs;
  const watch: OutputWatch = {
    decoder: new TextDecoder(),
    nextSeq: args.plan.sinceSeq,
    seen: "",
  };
  for (let attempt = 0; ; attempt += 1) {
    const outcome =
      condition === null
        ? await checkExited(args)
        : await checkOutput(args, condition, watch);
    if (outcome !== null) {
      return outcome;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return "timed-out";
    }
    const delayMs =
      pollDelaysMs[Math.min(attempt, pollDelaysMs.length - 1)] ??
      pollDelaysMs[0];
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(delayMs, remainingMs)),
    );
  }
}

async function checkExited(
  args: WaitArgs,
): Promise<TerminalWaitOutcome | null> {
  const session = await args.sdk.terminals.get({
    terminalId: args.terminalId,
  });
  return session.status === "exited" ? "exited" : null;
}

async function checkOutput(
  args: WaitArgs,
  condition: TerminalOutputCondition,
  watch: OutputWatch,
): Promise<TerminalWaitOutcome | null> {
  const read = await readOutputOrSession(args, watch.nextSeq);
  if (read.kind === "session") {
    return read.session.status === "exited" ? "exited" : null;
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
    return "matched";
  }
  return output.status === "exited" ? "exited" : null;
}

async function readOutputOrSession(
  args: WaitArgs,
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
        ...args.plan.outputBounds,
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
