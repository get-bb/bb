import { Buffer } from "node:buffer";
import type { Command } from "commander";
import { z } from "zod";
import { BbHttpError, type BbSdk, type TerminalCreateScope } from "@bb/sdk";
import type { TerminalSession } from "@bb/server-contract";
import { action, CliExitError, CliUsageError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { durationHelp, parseDurationMs } from "../duration.js";
import { outputJson } from "./helpers.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";
import {
  parseTerminalOutputCondition,
  terminalOutputConditionMatches,
  terminalPlainText,
  waitForTerminalCondition,
  type TerminalOutputCondition,
} from "./terminal-wait.js";

const EXEC_COLS = 200;
const EXEC_ROWS = 50;
const DEFAULT_YIELD_AFTER = "30s";
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const EXEC_STILL_RUNNING_EXIT_CODE = 124;
const EXEC_POLL_DELAYS_MS = [100, 200, 400, 800, 1000] as const;
const httpErrorMessageBodySchema = z.object({ message: z.string().min(1) });
const EXEC_USAGE_EXAMPLE =
  "For example: bb exec --machine <id-or-name> --cwd /path/to/repo -- pnpm test";

interface ExecObserveOptions {
  contains?: string;
  json?: boolean;
  maxOutputBytes: string;
  regex?: string;
  yieldAfter: string;
}

interface ExecRunOptions extends ExecObserveOptions {
  cwd?: string;
  environment?: string;
  host?: string;
  id?: string;
  machine?: string;
  title?: string;
}

interface ExecWaitOptions extends ExecObserveOptions {
  sinceSeq?: string;
}

interface ExecResult {
  closeReason: TerminalSession["closeReason"];
  cwd: string;
  environmentId: string | null;
  exitCode: number | null;
  hostId: string;
  nextSeq: number;
  observation: "exited" | "matched" | "yielded";
  output: string | null;
  status: TerminalSession["status"];
  terminalId: string;
  truncated: boolean;
}

interface ExecReport {
  outputUnavailable: string | null;
  result: ExecResult;
}

type ExecOutputRead =
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

interface ExecObservePlan {
  condition: TerminalOutputCondition | null;
  maxOutputBytes: number;
  yieldAfterMs: number;
}

export function registerExecCommands(
  program: Command,
  getUrl: () => string,
): void {
  const exec = addObserveOptions(
    program
      .command("exec")
      .enablePositionalOptions()
      .argument("[command...]", "Program and arguments, after --")
      .description(
        "Run a command on another machine and return its output and exit code",
      )
      .option("--machine <id-or-name>", "Machine to run on")
      .option("--host <id-or-name>", "Alias for --machine")
      .option(
        "--cwd <path>",
        "Absolute working directory on that machine (required with --machine)",
      )
      .option(
        "--environment <id>",
        "Run in this environment's workspace on its machine",
      )
      .option(
        "--id <terminal-id>",
        "Run in a terminal with this ID (term_ plus 10 characters); a retry with the same ID fails instead of running twice",
      )
      .option("--title <title>", "Terminal title (default: the command)"),
  ).action(
    action(async (commandParts: string[], opts: ExecRunOptions) => {
      const plan = parseObservePlan(opts);
      if (commandParts.length === 0) {
        throw new CliUsageError({
          code: "missing_required",
          hint: EXEC_USAGE_EXAMPLE,
          message: "Provide the command to run after --",
        });
      }
      const sdk = createCliBbSdk(getUrl());
      const scope = await resolveExecScope(opts, getUrl());
      const session = await createExecTerminal({
        argv: commandParts,
        id: opts.id,
        scope,
        sdk,
        title: opts.title,
      });
      const report = await observeExec({
        plan,
        sdk,
        sinceSeq: 0,
        terminalId: session.id,
      });
      reportExecResult({ json: opts.json === true, plan, report });
    }),
  );

  addObserveOptions(
    exec
      .command("wait <terminalId>")
      .description(
        "Keep observing a command that bb exec left running and return its output and exit code",
      )
      .option(
        "--since-seq <n>",
        "Only return and match output from this sequence (the previous result's nextSeq)",
      ),
  ).action(
    action(async (terminalId: string, opts: ExecWaitOptions) => {
      const plan = parseObservePlan(opts);
      const report = await observeExec({
        plan,
        sdk: createCliBbSdk(getUrl()),
        sinceSeq:
          opts.sinceSeq === undefined ? 0 : parseSinceSeq(opts.sinceSeq),
        terminalId,
      });
      reportExecResult({ json: opts.json === true, plan, report });
    }),
  );
}

function addObserveOptions(command: Command): Command {
  return command
    .option(
      "--yield-after <duration>",
      `Return a still-running command after ${durationHelp("s")}; it keeps running`,
      DEFAULT_YIELD_AFTER,
    )
    .option(
      "--contains <text>",
      "Return once the output contains this text instead of waiting for exit",
    )
    .option(
      "--regex <pattern>",
      "Return once the output matches this regular expression instead of waiting for exit",
    )
    .option(
      "--max-output-bytes <n>",
      "Return at most the last N bytes of output",
      String(DEFAULT_MAX_OUTPUT_BYTES),
    )
    .option("--json", "Print machine-readable JSON output");
}

function parseObservePlan(opts: ExecObserveOptions): ExecObservePlan {
  return {
    condition: parseTerminalOutputCondition(opts),
    maxOutputBytes: parseMaxOutputBytes(opts.maxOutputBytes),
    yieldAfterMs: parseDurationMs({
      allowZero: true,
      defaultUnit: "s",
      label: "--yield-after",
      value: opts.yieldAfter,
    }),
  };
}

function parseMaxOutputBytes(value: string): number {
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

function parseSinceSeq(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (String(parsed) !== value || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: "--since-seq must be a non-negative integer",
    });
  }
  return parsed;
}

async function resolveExecScope(
  opts: ExecRunOptions,
  serverUrl: string,
): Promise<TerminalCreateScope> {
  const machine = resolveMachineTargetOption(opts);
  if ((machine === undefined) === (opts.environment === undefined)) {
    throw new CliUsageError({
      code: machine === undefined ? "missing_required" : "invalid_value",
      hint: EXEC_USAGE_EXAMPLE,
      message:
        "Provide exactly one target: --machine (or --host) with --cwd, or --environment.",
    });
  }
  if (opts.environment !== undefined) {
    if (opts.cwd !== undefined) {
      throw new CliUsageError({
        code: "invalid_value",
        hint: null,
        message:
          "--cwd cannot be combined with --environment; the environment already selects its workspace.",
      });
    }
    return { kind: "environment", environmentId: opts.environment };
  }
  if (opts.cwd === undefined) {
    throw new CliUsageError({
      code: "missing_required",
      hint: EXEC_USAGE_EXAMPLE,
      message: "--cwd is required with --machine",
    });
  }
  return {
    kind: "host_path",
    hostId: await resolveMachineHostId({ serverUrl, target: machine ?? "" }),
    cwd: opts.cwd,
  };
}

async function createExecTerminal(args: {
  argv: string[];
  id: string | undefined;
  scope: TerminalCreateScope;
  sdk: BbSdk;
  title: string | undefined;
}): Promise<TerminalSession> {
  try {
    return await args.sdk.terminals.create({
      cols: EXEC_COLS,
      id: args.id,
      rows: EXEC_ROWS,
      scope: args.scope,
      start: { mode: "argv", argv: args.argv },
      title: args.title,
    });
  } catch (error) {
    if (
      args.id !== undefined &&
      error instanceof BbHttpError &&
      error.code === "terminal_id_conflict"
    ) {
      throw new CliExitError(
        `Terminal ${args.id} already exists, so the command was not run again.`,
        1,
        {
          code: "terminal_id_conflict",
          hint: `Observe the earlier run with \`bb exec wait ${args.id}\`.`,
        },
      );
    }
    throw error;
  }
}

async function observeExec(args: {
  plan: ExecObservePlan;
  sdk: BbSdk;
  sinceSeq: number;
  terminalId: string;
}): Promise<ExecReport> {
  const { condition } = args.plan;
  const outcome = await waitForTerminalCondition({
    condition,
    outputBounds: {},
    pollDelaysMs: EXEC_POLL_DELAYS_MS,
    sdk: args.sdk,
    sinceSeq: args.sinceSeq,
    terminalId: args.terminalId,
    timeoutMs: args.plan.yieldAfterMs,
  });
  const session = await args.sdk.terminals.get({
    terminalId: args.terminalId,
  });
  const output = await readExecOutput({
    maxOutputBytes: args.plan.maxOutputBytes,
    sdk: args.sdk,
    sinceSeq: args.sinceSeq,
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
              ? `Continue with \`bb exec wait ${session.id}\` once its machine reconnects.`
              : `Inspect it with \`bb terminal show ${session.id}\`.`,
        },
      );
    }
    return {
      outputUnavailable: output.message,
      result: {
        ...location,
        closeReason: session.closeReason,
        exitCode: session.exitCode,
        nextSeq: args.sinceSeq,
        observation: outcome.kind === "matched" ? "matched" : "exited",
        output: null,
        status: session.status,
        truncated: false,
      },
    };
  }
  const matched =
    outcome.kind === "matched" ||
    (condition !== null &&
      terminalOutputConditionMatches(condition, output.rawText));
  return {
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
          : "yielded",
      output: terminalPlainText(output.rawText),
      status: output.status,
      truncated: output.truncated,
    },
  };
}

async function readExecOutput(args: {
  maxOutputBytes: number;
  sdk: BbSdk;
  sinceSeq: number;
  terminalId: string;
}): Promise<ExecOutputRead> {
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

function describeTerminalState(
  state: Pick<ExecResult, "exitCode" | "status" | "terminalId">,
): string {
  switch (state.status) {
    case "exited":
      return state.exitCode === null
        ? `${state.terminalId} exited`
        : `${state.terminalId} exited with code ${state.exitCode}`;
    case "disconnected":
      return `${state.terminalId} lost its connection to its machine`;
    case "starting":
    case "running":
      return `${state.terminalId} is still running`;
  }
}

function execExitCode(result: ExecResult, plan: ExecObservePlan): number {
  switch (result.observation) {
    case "matched":
      return 0;
    case "yielded":
      return EXEC_STILL_RUNNING_EXIT_CODE;
    case "exited":
      if (
        plan.condition !== null ||
        result.closeReason !== "process-exit" ||
        result.exitCode === null
      ) {
        return 1;
      }
      return result.exitCode;
  }
}

function execStatusLines(report: ExecReport, plan: ExecObservePlan): string[] {
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
          ? `${id} printed the expected output, then exited.`
          : `${id} printed the expected output and is still running. Stop it with \`bb terminal close ${id}\`.`,
      );
      break;
    case "yielded":
      lines.push(
        `${id} is still running. Continue with \`bb exec wait ${id} --since-seq ${result.nextSeq}\`, or stop it with \`bb terminal close ${id}\`.`,
      );
      break;
    case "exited":
      if (result.closeReason !== "process-exit") {
        lines.push(
          `${id} was closed (${result.closeReason ?? "unknown reason"}) before the command finished.`,
        );
      } else if (plan.condition !== null) {
        lines.push(
          `${describeTerminalState(result)} before the expected output appeared.`,
        );
      } else if (result.exitCode !== 0) {
        lines.push(`${describeTerminalState(result)}.`);
      }
      break;
  }
  return lines;
}

function reportExecResult(args: {
  json: boolean;
  plan: ExecObservePlan;
  report: ExecReport;
}): void {
  const { result } = args.report;
  if (!outputJson({ json: args.json }, result)) {
    if (result.output !== null) {
      process.stdout.write(result.output);
    }
    for (const line of execStatusLines(args.report, args.plan)) {
      console.error(line);
    }
  }
  process.exitCode = execExitCode(result, args.plan);
}
