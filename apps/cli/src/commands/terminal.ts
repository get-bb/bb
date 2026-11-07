import { Buffer } from "node:buffer";
import { Command, Option } from "commander";
import { TERMINAL_DATA_MAX_BYTES } from "@bb/domain";
import {
  BbHttpError,
  type BbSdk,
  type TerminalCreateScope,
  type TerminalListScope,
} from "@bb/sdk";
import { createNodeWebsocketFactory } from "@bb/sdk/node-websocket";
import {
  terminalServerMessageSchema,
  type TerminalSession,
} from "@bb/server-contract";
import { action, CliExitError, CliUsageError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { terminalScopeHint } from "../context-hints.js";
import { durationHelp, parseDurationMs } from "../duration.js";
import { columnWidths, printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { resolveMachineHostId, resolveMachineTargetOption } from "./machine.js";
import {
  DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES,
  describeTerminalExit,
  observeTerminal,
  parseMaxOutputBytes,
  parseTerminalOutputCondition,
  reportTerminalObservation,
  terminalPlainText,
  type TerminalObservePlan,
} from "./terminal-wait.js";

const DEFAULT_COLS = 200;
const DEFAULT_ROWS = 50;
const WAIT_POLL_DELAYS_MS = [100, 200, 400, 800, 1000] as const;
const RUN_USAGE_EXAMPLE =
  "For example: bb terminal run --machine <id-or-name> --cwd /path/to/repo -- pnpm test";

interface TerminalJsonOptions {
  json?: boolean;
}

interface TerminalScopeOptions {
  cwd?: string;
  environment?: string;
  host?: string;
  machine?: string;
  thread?: string;
}

interface TerminalListOptions
  extends TerminalJsonOptions, TerminalScopeOptions {}

interface TerminalStartOptions
  extends TerminalJsonOptions, TerminalScopeOptions {
  attach?: boolean;
  command?: string;
  cols?: string;
  id?: string;
  rows?: string;
  title?: string;
}

interface TerminalRunOptions extends TerminalJsonOptions, TerminalScopeOptions {
  cols?: string;
  contains?: string;
  id?: string;
  maxOutputBytes: string;
  regex?: string;
  rows?: string;
  timeout: string;
  title?: string;
}

interface TerminalSendOptions extends TerminalJsonOptions {
  enter?: boolean;
  stdin?: boolean;
  text?: string;
}

interface TerminalResizeOptions extends TerminalJsonOptions {
  cols: string;
  rows: string;
}

interface TerminalOutputOptions extends TerminalJsonOptions {
  limitChunks?: string;
  sinceSeq?: string;
  tailBytes?: string;
}

interface TerminalReadOptions extends TerminalOutputOptions {
  plain?: boolean;
}

interface TerminalWaitOptions extends TerminalOutputOptions {
  contains?: string;
  exit?: boolean;
  fromStart?: boolean;
  maxOutputBytes: string;
  pollInterval?: string;
  regex?: string;
  timeout: string;
}

interface TerminalCloseOptions extends TerminalJsonOptions {
  ifClean?: boolean;
}

type TerminalStartResolution =
  | { mode: "shell" }
  | { mode: "command"; command: string }
  | { mode: "argv"; argv: string[] };

export function registerTerminalCommands(
  program: Command,
  getUrl: () => string,
): void {
  const terminal = program
    .command("terminal")
    .description(
      "Manage terminal sessions across threads, environments, and machines",
    );

  addTerminalScopeOptions(
    terminal
      .command("list")
      .description("List terminal sessions in exactly one scope")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: TerminalListOptions) => {
      const sdk = createCliBbSdk(getUrl());
      const result = await sdk.terminals.list({
        scope: await resolveTerminalListScope(opts, getUrl()),
      });
      if (outputJson(opts, result)) return;
      printTerminalTable(result.sessions);
    }),
  );

  addTerminalScopeOptions(
    terminal
      .command("create [command...]")
      .alias("start")
      .description("Create a terminal session in exactly one scope")
      .option("--title <title>", "Terminal title")
      .option(
        "--id <terminal-id>",
        "Create the terminal with this ID (term_ plus 10 characters); fails if the ID exists",
      )
      .option(
        "--command <command>",
        "Command to run instead of an interactive shell",
      )
      .option(
        "--cols <n>",
        `Initial terminal columns (default: ${DEFAULT_COLS})`,
      )
      .option("--rows <n>", `Initial terminal rows (default: ${DEFAULT_ROWS})`)
      .option("--attach", "Attach after creating")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (commandParts: string[], opts: TerminalStartOptions) => {
      const sdk = createCliBbSdk(getUrl());
      const resolvedStart = resolveTerminalStart({
        commandOption: opts.command,
        commandParts,
      });
      const session = await sdk.terminals.create({
        cols: parsePositiveInteger(opts.cols, DEFAULT_COLS, "--cols"),
        id: opts.id,
        rows: parsePositiveInteger(opts.rows, DEFAULT_ROWS, "--rows"),
        scope: await resolveTerminalCreateScope(opts, getUrl()),
        title: opts.title,
        start: resolvedStart,
      });
      if (outputJson(opts, session)) return;
      console.log(`Created terminal ${session.id} (${session.title})`);
      if (opts.attach) {
        await attachTerminal({
          baseUrl: getUrl(),
          terminalId: session.id,
        });
      }
    }),
  );

  addTerminalScopeOptions(
    terminal
      .command("run [command...]")
      .description(
        "Run a command in a new terminal and return its output and exit code",
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
        "--timeout <duration>",
        `Stop waiting after ${durationHelp("s")}; the command keeps running`,
        "30s",
      )
      .option(
        "--max-output-bytes <n>",
        "Return at most the last N bytes of output",
        DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES,
      )
      .option(
        "--id <terminal-id>",
        "Run in a terminal with this ID (term_ plus 10 characters); a retry with the same ID fails instead of running twice",
      )
      .option("--title <title>", "Terminal title (default: the command)")
      .option(
        "--cols <n>",
        `Initial terminal columns (default: ${DEFAULT_COLS})`,
      )
      .option("--rows <n>", `Initial terminal rows (default: ${DEFAULT_ROWS})`)
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (commandParts: string[], opts: TerminalRunOptions) => {
      if (commandParts.length === 0) {
        throw new CliUsageError({
          code: "missing_required",
          hint: RUN_USAGE_EXAMPLE,
          message: "Provide the command to run after --",
        });
      }
      const plan: TerminalObservePlan = {
        condition: parseTerminalOutputCondition(opts),
        maxOutputBytes: parseMaxOutputBytes(opts.maxOutputBytes),
        outputBounds: {},
        pollDelaysMs: WAIT_POLL_DELAYS_MS,
        sinceSeq: 0,
        timeoutMs: parseTimeout(opts.timeout),
      };
      const cols = parsePositiveInteger(opts.cols, DEFAULT_COLS, "--cols");
      const rows = parsePositiveInteger(opts.rows, DEFAULT_ROWS, "--rows");
      const sdk = createCliBbSdk(getUrl());
      const session = await createRunTerminal({
        argv: commandParts,
        cols,
        id: opts.id,
        rows,
        scope: await resolveTerminalCreateScope(opts, getUrl()),
        sdk,
        title: opts.title,
      });
      reportTerminalObservation({
        json: opts.json === true,
        report: await observeTerminal({ plan, sdk, terminalId: session.id }),
      });
    }),
  );

  terminal
    .command("show <terminalId>")
    .description("Show a terminal session")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalJsonOptions) => {
        const session = await createCliBbSdk(getUrl()).terminals.get({
          terminalId,
        });
        if (outputJson(opts, session)) return;
        console.log(JSON.stringify(session, null, 2));
      }),
    );

  terminal
    .command("attach <terminalId>")
    .description("Attach to a running terminal session")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalJsonOptions) => {
        if (opts.json) {
          const session = await createCliBbSdk(getUrl()).terminals.get({
            terminalId,
          });
          outputJson(opts, session);
          return;
        }
        await attachTerminal({
          baseUrl: getUrl(),
          terminalId,
        });
      }),
    );

  terminal
    .command("send <terminalId>")
    .description("Send input to a terminal session")
    .option("--text <text>", "Text to send")
    .option("--stdin", "Read bytes from stdin")
    .option("--enter", "Press Enter after the text")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalSendOptions) => {
        const data = await resolveSendData(opts);
        const sdk = createCliBbSdk(getUrl());
        let session: TerminalSession | null = null;
        for (const chunk of chunkTerminalInput(data)) {
          session = await sdk.terminals.input({
            terminalId,
            dataBase64: chunk.toString("base64"),
          });
        }
        if (session === null) {
          throw new CliExitError("Terminal input cannot be empty", 1);
        }
        if (outputJson(opts, session)) return;
        console.log(`Sent input to terminal ${terminalId}`);
      }),
    );

  terminal
    .command("resize <terminalId>")
    .description("Resize a terminal session")
    .requiredOption("--cols <n>", "Terminal columns")
    .requiredOption("--rows <n>", "Terminal rows")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalResizeOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const session = await sdk.terminals.resize({
          terminalId,
          cols: parseRequiredPositiveInteger(opts.cols, "--cols"),
          rows: parseRequiredPositiveInteger(opts.rows, "--rows"),
        });
        if (outputJson(opts, session)) return;
        console.log(
          `Resized terminal ${terminalId} to ${session.cols}x${session.rows}`,
        );
      }),
    );

  terminal
    .command("output <terminalId>")
    .alias("read")
    .description("Print terminal output from daemon scrollback")
    .option("--since-seq <n>", "Only output chunks from this sequence")
    .option("--tail-bytes <n>", "Bound output to the latest N bytes")
    .option("--limit-chunks <n>", "Bound output to the latest N chunks")
    .option(
      "--plain",
      "Print plain text, with colors and progress redraws removed",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalReadOptions) => {
        if (opts.plain === true && opts.json === true) {
          throw new CliUsageError({
            code: "invalid_value",
            hint: "--json returns the raw chunks; use terminal wait --json for plain output.",
            message: "Provide only one of --plain or --json",
          });
        }
        const sdk = createCliBbSdk(getUrl());
        const output = await sdk.terminals.output({
          terminalId,
          ...terminalOutputQuery(opts),
        });
        if (outputJson(opts, output)) return;
        if (opts.plain === true) {
          process.stdout.write(
            terminalPlainText(
              Buffer.concat(
                output.chunks.map((chunk) =>
                  Buffer.from(chunk.dataBase64, "base64"),
                ),
              ).toString("utf8"),
            ),
          );
        } else {
          writeOutputChunks(output.chunks);
        }
        if (output.status === "exited") {
          console.error(describeTerminalExit(terminalId, output.exitCode));
        }
      }),
    );

  terminal
    .command("wait <terminalId>")
    .description(
      "Wait for a terminal to exit or print text, then return its output and exit code",
    )
    .option(
      "--contains <text>",
      "Return once new output contains text, ignoring terminal escapes",
    )
    .option(
      "--regex <pattern>",
      "Return once new output matches a regular expression, ignoring terminal escapes",
    )
    .option("--exit", "Wait until the terminal exits (the default)")
    .option(
      "--since-seq <n>",
      "Start from this output sequence (default: the current end for --contains or --regex, 0 otherwise)",
    )
    .option("--from-start", "Start from sequence 0")
    .option(
      "--timeout <duration>",
      `Stop waiting after ${durationHelp("s")}; the terminal keeps running`,
      "30s",
    )
    .option(
      "--poll-interval <duration>",
      `Polling interval as ${durationHelp("ms")} (default: starts at 100ms and backs off to 1s)`,
    )
    .option(
      "--max-output-bytes <n>",
      "Return at most the last N bytes of output",
      DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES,
    )
    .option("--tail-bytes <n>", "Bound each output poll to N bytes")
    .option("--limit-chunks <n>", "Bound each output poll to N chunks")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalWaitOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const plan = await resolveTerminalWaitPlan({ opts, sdk, terminalId });
        reportTerminalObservation({
          json: opts.json === true,
          report: await observeTerminal({ plan, sdk, terminalId }),
        });
      }),
    );

  terminal
    .command("rename <terminalId> <title>")
    .description("Rename a terminal session")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          title: string,
          opts: TerminalJsonOptions,
        ) => {
          const session = await createCliBbSdk(getUrl()).terminals.rename({
            terminalId,
            title,
          });
          if (outputJson(opts, session)) return;
          console.log(`Renamed terminal ${terminalId} to ${session.title}`);
        },
      ),
    );

  terminal
    .command("restart <terminalId>")
    .description("Replace a terminal with a shell in the same scope")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalJsonOptions) => {
        const session = await createCliBbSdk(getUrl()).terminals.restart({
          terminalId,
        });
        if (outputJson(opts, session)) return;
        console.log(`Restarted terminal ${terminalId} as ${session.id}`);
      }),
    );

  terminal
    .command("close <terminalId>")
    .alias("stop")
    .description("Close a terminal session")
    .option("--if-clean", "Only close if no user input was sent")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (terminalId: string, opts: TerminalCloseOptions) => {
        const session = await createCliBbSdk(getUrl()).terminals.close({
          terminalId,
          mode: opts.ifClean ? "if-clean" : "force",
        });
        if (outputJson(opts, session)) return;
        console.log(`Closed terminal ${terminalId}`);
      }),
    );

  for (const command of terminal.commands) {
    const targetsTerminalId = command.registeredArguments.some(
      (argument) => argument.name() === "terminalId",
    );
    if (targetsTerminalId) acceptRedundantTerminalScopeOptions(command);
  }
}

function acceptRedundantTerminalScopeOptions(command: Command): void {
  for (const flags of [
    "--thread <id>",
    "--environment <id>",
    "--machine <id-or-name>",
    "--host <id-or-name>",
  ]) {
    command.addOption(new Option(flags).hideHelp());
  }
}

function addTerminalScopeOptions(command: Command): Command {
  return command
    .option("--thread <id>", "Thread-scoped terminal")
    .option("--environment <id>", "Environment-scoped terminal")
    .option("--machine <id-or-name>", "Machine-scoped terminal")
    .option("--host <id-or-name>", "Alias for --machine")
    .option("--cwd <path>", "Working directory for --machine or --host");
}

async function resolveTerminalListScope(
  opts: TerminalScopeOptions,
  serverUrl: string,
): Promise<TerminalListScope> {
  const machine = resolveTerminalMachineSelector(opts);
  assertExactlyOneTerminalScope({
    environment: opts.environment,
    machine,
    thread: opts.thread,
  });
  if (opts.cwd !== undefined && machine === undefined) {
    throw new Error("--cwd can only be used with --machine or --host.");
  }
  if (opts.thread !== undefined) {
    return { kind: "thread", threadId: opts.thread };
  }
  if (opts.environment !== undefined) {
    return { kind: "environment", environmentId: opts.environment };
  }
  return {
    kind: "host_path",
    hostId: await resolveMachineHostId({
      serverUrl,
      target: machine ?? "",
    }),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  };
}

async function resolveTerminalCreateScope(
  opts: TerminalScopeOptions,
  serverUrl: string,
): Promise<TerminalCreateScope> {
  const scope = await resolveTerminalListScope(opts, serverUrl);
  if (scope.kind !== "host_path") return scope;
  return { ...scope, cwd: scope.cwd ?? null };
}

function resolveTerminalMachineSelector(
  opts: TerminalScopeOptions,
): string | undefined {
  return resolveMachineTargetOption({
    machine: opts.machine,
    host: opts.host,
  });
}

function assertExactlyOneTerminalScope(args: {
  environment?: string;
  machine?: string;
  thread?: string;
}): void {
  const count = [args.thread, args.environment, args.machine].filter(
    (value) => value !== undefined,
  ).length;
  if (count !== 1) {
    throw new CliUsageError({
      code: count === 0 ? "missing_required" : "invalid_value",
      hint: count === 0 ? terminalScopeHint() : null,
      message:
        "Provide exactly one terminal scope: --thread, --environment, or --machine/--host.",
    });
  }
}

function resolveTerminalStart(args: {
  commandOption?: string;
  commandParts: readonly string[];
}): TerminalStartResolution {
  if (args.commandOption !== undefined && args.commandParts.length > 0) {
    throw new Error(
      "Provide either --command or positional command args, not both",
    );
  }
  if (args.commandOption !== undefined) {
    const command = args.commandOption.trim();
    if (command.length === 0) {
      throw new Error("--command must not be empty");
    }
    return { mode: "command", command };
  }
  if (args.commandParts.length > 0) {
    return { mode: "argv", argv: [...args.commandParts] };
  }
  return { mode: "shell" };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  return parseRequiredPositiveInteger(value, label);
}

function parseRequiredPositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export async function resolveSendData(
  opts: TerminalSendOptions,
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<Buffer> {
  if (opts.text !== undefined && opts.stdin) {
    throw new Error("Provide only one of --text or --stdin");
  }
  if (opts.text === undefined && !opts.stdin) {
    throw new Error("Provide one of --text or --stdin");
  }
  const baseData =
    opts.text !== undefined
      ? Buffer.from(opts.text, "utf8")
      : await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
          stdin.on("error", reject);
          stdin.on("end", () => resolve(Buffer.concat(chunks)));
        });
  return opts.enter
    ? Buffer.concat([baseData, Buffer.from("\r", "utf8")])
    : baseData;
}

function terminalOutputQuery(opts: TerminalOutputOptions) {
  return {
    ...(opts.sinceSeq !== undefined
      ? { sinceSeq: parseNonNegativeInteger(opts.sinceSeq, "--since-seq") }
      : {}),
    ...terminalOutputBounds(opts),
  };
}

function terminalOutputBounds(
  opts: Pick<TerminalOutputOptions, "limitChunks" | "tailBytes">,
) {
  return {
    ...(opts.tailBytes !== undefined
      ? {
          tailBytes: parseRequiredPositiveInteger(
            opts.tailBytes,
            "--tail-bytes",
          ),
        }
      : {}),
    ...(opts.limitChunks !== undefined
      ? {
          limitChunks: parseRequiredPositiveInteger(
            opts.limitChunks,
            "--limit-chunks",
          ),
        }
      : {}),
  };
}

function parseNonNegativeInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function printTerminalTable(sessions: TerminalSession[]): void {
  if (sessions.length === 0) {
    console.log("No terminal sessions found");
    return;
  }
  const rows = sessions.map((session) => [
    session.id,
    session.title,
    session.status,
    `${session.cols}x${session.rows}`,
  ]);
  printBorderlessTable(
    {
      head: ["ID", "Title", "Status", "Size"],
      colWidths: columnWidths(rows, [12, 24, 14, 10]),
    },
    rows,
  );
}

function writeOutputChunks(
  chunks: readonly { dataBase64: string; seq: number }[],
): void {
  for (const chunk of chunks) {
    process.stdout.write(Buffer.from(chunk.dataBase64, "base64"));
  }
}

function terminalWebsocketUrl(args: {
  baseUrl: string;
  terminalId: string;
}): string {
  const url = new URL(args.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/ws/terminals/${encodeURIComponent(
    args.terminalId,
  )}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

async function attachTerminal(args: {
  baseUrl: string;
  terminalId: string;
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Attach requires an interactive terminal");
  }

  const socket = createNodeWebsocketFactory()(
    terminalWebsocketUrl({
      baseUrl: args.baseUrl,
      terminalId: args.terminalId,
    }),
  );
  let detachPrefix = false;
  const previousRawMode = process.stdin.isRaw;
  const onInput = (chunk: Buffer) => {
    if (chunk.length === 1 && chunk[0] === 0x02) {
      detachPrefix = true;
      return;
    }
    if (detachPrefix) {
      detachPrefix = false;
      if (chunk.length === 1 && chunk[0] === 0x64) {
        socket.close();
        return;
      }
      sendTerminalInput(socket, Buffer.from([0x02]));
    }
    sendTerminalInput(socket, chunk);
  };
  const onResize = () => {
    socket.send(
      JSON.stringify({
        type: "resize",
        cols: process.stdout.columns || DEFAULT_COLS,
        rows: process.stdout.rows || DEFAULT_ROWS,
      }),
    );
  };
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      onResize();
    };
    socket.onerror = () => reject(new Error("Terminal websocket failed"));
    socket.onclose = () => resolve();
    socket.onmessage = (event) => {
      const message = terminalServerMessageSchema.parse(
        JSON.parse(String(event.data)),
      );
      switch (message.type) {
        case "attached":
        case "pong":
        case "session-updated":
          return;
        case "output":
          process.stdout.write(Buffer.from(message.chunk.dataBase64, "base64"));
          return;
        case "exited":
          socket.close();
          return;
        case "error":
          reject(new Error(message.message));
          return;
      }
    };
    process.stdin.on("data", onInput);
    process.stdout.on("resize", onResize);
  }).finally(() => {
    process.stdin.off("data", onInput);
    process.stdout.off("resize", onResize);
    process.stdin.setRawMode(previousRawMode);
    process.stdin.pause();
  });
}

function chunkTerminalInput(data: Buffer): Buffer[] {
  const chunks: Buffer[] = [];
  for (
    let offset = 0;
    offset < data.byteLength;
    offset += TERMINAL_DATA_MAX_BYTES
  ) {
    chunks.push(
      data.subarray(
        offset,
        Math.min(offset + TERMINAL_DATA_MAX_BYTES, data.byteLength),
      ),
    );
  }
  return chunks;
}

function sendTerminalInput(socket: { send(data: string): void }, data: Buffer) {
  for (const chunk of chunkTerminalInput(data)) {
    socket.send(
      JSON.stringify({
        type: "input",
        dataBase64: chunk.toString("base64"),
      }),
    );
  }
}

function parseTimeout(value: string): number {
  return parseDurationMs({
    allowZero: false,
    defaultUnit: "s",
    label: "--timeout",
    value,
  });
}

async function createRunTerminal(args: {
  argv: string[];
  cols: number;
  id: string | undefined;
  rows: number;
  scope: TerminalCreateScope;
  sdk: BbSdk;
  title: string | undefined;
}): Promise<TerminalSession> {
  try {
    return await args.sdk.terminals.create({
      cols: args.cols,
      id: args.id,
      rows: args.rows,
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
          hint: `Observe the earlier run with \`bb terminal wait ${args.id}\`.`,
        },
      );
    }
    throw error;
  }
}

async function resolveTerminalWaitPlan(args: {
  opts: TerminalWaitOptions;
  sdk: BbSdk;
  terminalId: string;
}): Promise<TerminalObservePlan> {
  const { opts } = args;
  const condition = parseTerminalOutputCondition(opts);
  if (opts.exit === true && condition !== null) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: `For example: bb terminal wait ${args.terminalId}, or --contains "ready".`,
      message: "Provide only one of --contains, --regex, or --exit",
    });
  }
  if (opts.sinceSeq !== undefined && opts.fromStart === true) {
    throw new CliUsageError({
      code: "invalid_value",
      hint: null,
      message: "Provide only one of --since-seq or --from-start",
    });
  }
  const plan = {
    condition,
    maxOutputBytes: parseMaxOutputBytes(opts.maxOutputBytes),
    outputBounds: terminalOutputBounds(opts),
    pollDelaysMs:
      opts.pollInterval === undefined
        ? WAIT_POLL_DELAYS_MS
        : ([
            parseDurationMs({
              allowZero: false,
              defaultUnit: "ms",
              label: "--poll-interval",
              value: opts.pollInterval,
            }),
          ] as const),
    timeoutMs: parseTimeout(opts.timeout),
  };
  if (opts.sinceSeq !== undefined) {
    return {
      ...plan,
      sinceSeq: parseNonNegativeInteger(opts.sinceSeq, "--since-seq"),
    };
  }
  if (condition === null || opts.fromStart === true) {
    return { ...plan, sinceSeq: 0 };
  }
  const currentOutput = await args.sdk.terminals.output({
    terminalId: args.terminalId,
    limitChunks: 1,
    tailBytes: 1,
  });
  if (currentOutput.status === "exited") {
    throw new CliExitError(
      `${describeTerminalExit(args.terminalId, currentOutput.exitCode)} before this wait started, so no new output will arrive.`,
      1,
      {
        code: "terminal_exited",
        hint: `Match its existing output with --from-start, or read it with \`bb terminal output ${args.terminalId}\`.`,
      },
    );
  }
  return { ...plan, sinceSeq: currentOutput.nextSeq };
}
