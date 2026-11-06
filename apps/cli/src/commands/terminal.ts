import { Buffer } from "node:buffer";
import type { Command } from "commander";
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
  type PublicOperationInput,
  type TerminalSession,
} from "@bb/server-contract";
import { CliExitError, CliUsageError } from "../action.js";
import { JSON_FLAG_DESCRIPTION, arg, flag } from "../cli-door.js";
import {
  clientCommand,
  mountCommands,
  publicCommand,
} from "../operation-doors.js";
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

interface TerminalSendOptions extends TerminalJsonOptions {
  enter?: boolean;
  stdin?: boolean;
  text?: string;
}

interface TerminalOutputOptions extends TerminalJsonOptions {
  limitChunks?: string;
  sinceSeq?: string;
  tailBytes?: string;
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

type TerminalStartResolution =
  | { mode: "shell" }
  | { mode: "command"; command: string }
  | { mode: "argv"; argv: string[] };

const JSON_OPTION = { json: flag("--json", JSON_FLAG_DESCRIPTION) };

const TERMINAL_SCOPE_OPTIONS = {
  thread: flag("--thread <id>", "Thread-scoped terminal"),
  environment: flag("--environment <id>", "Environment-scoped terminal"),
  machine: flag("--machine <id-or-name>", "Machine-scoped terminal"),
  host: flag("--host <id-or-name>", "Alias for --machine"),
  cwd: flag("--cwd <path>", "Working directory for --machine or --host"),
};

const REDUNDANT_SCOPE_OPTIONS = {
  thread: flag("--thread <id>", "", { hidden: true }),
  environment: flag("--environment <id>", "", { hidden: true }),
  machine: flag("--machine <id-or-name>", "", { hidden: true }),
  host: flag("--host <id-or-name>", "", { hidden: true }),
};

const TERMINAL_ID_POSITIONAL = { terminalId: arg("<terminalId>") };

function terminalListQuery(
  scope: TerminalListScope,
): PublicOperationInput<"terminals.list"> {
  switch (scope.kind) {
    case "thread":
      return { threadId: scope.threadId };
    case "environment":
      return { environmentId: scope.environmentId };
    case "host_path":
      return {
        hostId: scope.hostId,
        ...(scope.cwd === undefined ? {} : { cwd: scope.cwd }),
      };
  }
}

function terminalCreateTarget(
  scope: TerminalCreateScope,
): PublicOperationInput<"terminals.create">["target"] {
  switch (scope.kind) {
    case "thread":
      return { kind: "thread", threadId: scope.threadId };
    case "environment":
      return { kind: "environment", environmentId: scope.environmentId };
    case "host_path":
      return { kind: "host_path", hostId: scope.hostId, cwd: scope.cwd };
  }
}

const terminalListCommand = publicCommand("terminals.list", {
  path: ["terminal", "list"],
  summary: "List terminal sessions in exactly one scope",
  options: { ...JSON_OPTION, ...TERMINAL_SCOPE_OPTIONS },
  prepare: async ({ options }, client) =>
    terminalListQuery(await resolveTerminalListScope(options, client.url)),
  print: (result) => {
    printTerminalTable(result.sessions);
    return null;
  },
});

const terminalCreateCommand = clientCommand({
  path: ["terminal", "create"],
  summary: "Create a terminal session in exactly one scope",
  aliases: ["start"],
  positionals: { command: arg("[command...]") },
  noJson: true,
  options: {
    title: flag("--title <title>", "Terminal title"),
    id: flag(
      "--id <terminal-id>",
      "Create the terminal with this ID (term_ plus 10 characters); fails if the ID exists",
    ),
    command: flag(
      "--command <command>",
      "Command to run instead of an interactive shell",
    ),
    cols: flag(
      "--cols <n>",
      `Initial terminal columns (default: ${DEFAULT_COLS})`,
    ),
    rows: flag(
      "--rows <n>",
      `Initial terminal rows (default: ${DEFAULT_ROWS})`,
    ),
    attach: flag("--attach", "Attach after creating"),
    ...JSON_OPTION,
    ...TERMINAL_SCOPE_OPTIONS,
  },
  run: async ({ positionals, options }, client) => {
    const start = resolveTerminalStart({
      commandOption: options.command,
      commandParts: positionals.command,
    });
    const cols = parsePositiveInteger(options.cols, DEFAULT_COLS, "--cols");
    const rows = parsePositiveInteger(options.rows, DEFAULT_ROWS, "--rows");
    const scope = await resolveTerminalCreateScope(options, client.url);
    const session = await client.call("terminals.create", {
      cols,
      ...(options.id === undefined ? {} : { id: options.id }),
      rows,
      start,
      target: terminalCreateTarget(scope),
      ...(options.title === undefined ? {} : { title: options.title }),
    });
    if (outputJson({ json: options.json }, session)) return null;
    client.log(`Created terminal ${session.id} (${session.title})`);
    if (options.attach) {
      await attachTerminal({ baseUrl: client.url, terminalId: session.id });
    }
    return null;
  },
  print: () => null,
});

const terminalRunCommand = clientCommand({
  path: ["terminal", "run"],
  summary:
    "Run a command in a new terminal and return its output and exit code",
  positionals: { command: arg("[command...]") },
  noJson: true,
  options: {
    contains: flag(
      "--contains <text>",
      "Return once the output contains this text instead of waiting for exit",
    ),
    regex: flag(
      "--regex <pattern>",
      "Return once the output matches this regular expression instead of waiting for exit",
    ),
    timeout: flag(
      "--timeout <duration>",
      `Stop waiting after ${durationHelp("s")}; the command keeps running`,
      { default: "30s" },
    ),
    maxOutputBytes: flag(
      "--max-output-bytes <n>",
      "Return at most the last N bytes of output",
      { default: DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES },
    ),
    id: flag(
      "--id <terminal-id>",
      "Run in a terminal with this ID (term_ plus 10 characters); a retry with the same ID fails instead of running twice",
    ),
    title: flag("--title <title>", "Terminal title (default: the command)"),
    cols: flag(
      "--cols <n>",
      `Initial terminal columns (default: ${DEFAULT_COLS})`,
    ),
    rows: flag(
      "--rows <n>",
      `Initial terminal rows (default: ${DEFAULT_ROWS})`,
    ),
    ...JSON_OPTION,
    ...TERMINAL_SCOPE_OPTIONS,
  },
  run: async ({ positionals, options }, client) => {
    const argv = positionals.command;
    if (argv.length === 0) {
      throw new CliUsageError({
        code: "missing_required",
        hint: RUN_USAGE_EXAMPLE,
        message: "Provide the command to run after --",
      });
    }
    const plan: TerminalObservePlan = {
      condition: parseTerminalOutputCondition(options),
      maxOutputBytes: parseMaxOutputBytes(options.maxOutputBytes),
      outputBounds: {},
      pollDelaysMs: WAIT_POLL_DELAYS_MS,
      sinceSeq: 0,
      timeoutMs: parseTimeout(options.timeout),
    };
    const cols = parsePositiveInteger(options.cols, DEFAULT_COLS, "--cols");
    const rows = parsePositiveInteger(options.rows, DEFAULT_ROWS, "--rows");
    const scope = await resolveTerminalCreateScope(options, client.url);
    const sdk = client.sdk();
    const session = await createRunTerminal({
      argv,
      cols,
      id: options.id,
      rows,
      scope,
      sdk,
      title: options.title,
    });
    reportTerminalObservation({
      json: options.json,
      report: await observeTerminal({ plan, sdk, terminalId: session.id }),
    });
    return null;
  },
  print: () => null,
});

const terminalShowCommand = publicCommand("terminals.get", {
  path: ["terminal", "show"],
  summary: "Show a terminal session",
  positionals: TERMINAL_ID_POSITIONAL,
  options: REDUNDANT_SCOPE_OPTIONS,
  prepare: ({ positionals }) => ({ terminalId: positionals.terminalId }),
  print: (session) => JSON.stringify(session, null, 2),
});

const terminalAttachCommand = clientCommand({
  path: ["terminal", "attach"],
  summary: "Attach to a running terminal session",
  positionals: TERMINAL_ID_POSITIONAL,
  options: { ...REDUNDANT_SCOPE_OPTIONS, ...JSON_OPTION },
  run: async (
    { positionals: { terminalId }, options },
    client,
  ): Promise<TerminalSession | null> => {
    if (options.json) return client.call("terminals.get", { terminalId });
    await attachTerminal({ baseUrl: client.url, terminalId });
    return null;
  },
  print: () => null,
});

const terminalSendCommand = clientCommand({
  path: ["terminal", "send"],
  summary: "Send input to a terminal session",
  positionals: TERMINAL_ID_POSITIONAL,
  options: {
    text: flag("--text <text>", "Text to send"),
    stdin: flag("--stdin", "Read bytes from stdin"),
    enter: flag("--enter", "Press Enter after the text"),
    ...REDUNDANT_SCOPE_OPTIONS,
  },
  run: async ({ positionals: { terminalId }, options }, client) => {
    const data = await resolveSendData(options);
    let session: TerminalSession | null = null;
    for (const chunk of chunkTerminalInput(data)) {
      session = await client.call("terminals.input", {
        terminalId,
        dataBase64: chunk.toString("base64"),
      });
    }
    if (session === null) {
      throw new CliExitError("Terminal input cannot be empty", 1);
    }
    return session;
  },
  print: (_session, { positionals }) =>
    `Sent input to terminal ${positionals.terminalId}`,
});

const terminalResizeCommand = publicCommand("terminals.resize", {
  path: ["terminal", "resize"],
  summary: "Resize a terminal session",
  positionals: TERMINAL_ID_POSITIONAL,
  options: {
    cols: flag("--cols <n>", "Terminal columns", { required: true }),
    rows: flag("--rows <n>", "Terminal rows", { required: true }),
    ...REDUNDANT_SCOPE_OPTIONS,
  },
  prepare: ({ positionals, options }) => ({
    terminalId: positionals.terminalId,
    cols: parseRequiredPositiveInteger(options.cols, "--cols"),
    rows: parseRequiredPositiveInteger(options.rows, "--rows"),
  }),
  print: (session, { terminalId }) =>
    `Resized terminal ${terminalId} to ${session.cols}x${session.rows}`,
});

const terminalOutputCommand = clientCommand({
  path: ["terminal", "output"],
  summary: "Print terminal output from daemon scrollback",
  aliases: ["read"],
  positionals: TERMINAL_ID_POSITIONAL,
  options: {
    sinceSeq: flag("--since-seq <n>", "Only output chunks from this sequence"),
    tailBytes: flag("--tail-bytes <n>", "Bound output to the latest N bytes"),
    limitChunks: flag(
      "--limit-chunks <n>",
      "Bound output to the latest N chunks",
    ),
    plain: flag(
      "--plain",
      "Print plain text, with colors and progress redraws removed",
    ),
    ...REDUNDANT_SCOPE_OPTIONS,
    ...JSON_OPTION,
  },
  run: ({ positionals: { terminalId }, options }, client) => {
    if (options.plain && options.json) {
      throw new CliUsageError({
        code: "invalid_value",
        hint: "--json returns the raw chunks; use terminal wait --json for plain output.",
        message: "Provide only one of --plain or --json",
      });
    }
    return client.call("terminals.output", {
      terminalId,
      ...terminalOutputQuery(options),
    });
  },
  print: (output, { positionals, options }) => {
    if (options.plain) {
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
      console.error(
        describeTerminalExit(positionals.terminalId, output.exitCode),
      );
    }
    return null;
  },
});

const terminalWaitCommand = clientCommand({
  path: ["terminal", "wait"],
  summary:
    "Wait for a terminal to exit or print text, then return its output and exit code",
  positionals: TERMINAL_ID_POSITIONAL,
  noJson: true,
  options: {
    contains: flag(
      "--contains <text>",
      "Return once new output contains text, ignoring terminal escapes",
    ),
    regex: flag(
      "--regex <pattern>",
      "Return once new output matches a regular expression, ignoring terminal escapes",
    ),
    exit: flag("--exit", "Wait until the terminal exits (the default)"),
    sinceSeq: flag(
      "--since-seq <n>",
      "Start from this output sequence (default: the current end for --contains or --regex, 0 otherwise)",
    ),
    fromStart: flag("--from-start", "Start from sequence 0"),
    timeout: flag(
      "--timeout <duration>",
      `Stop waiting after ${durationHelp("s")}; the terminal keeps running`,
      { default: "30s" },
    ),
    pollInterval: flag(
      "--poll-interval <duration>",
      `Polling interval as ${durationHelp("ms")} (default: starts at 100ms and backs off to 1s)`,
    ),
    maxOutputBytes: flag(
      "--max-output-bytes <n>",
      "Return at most the last N bytes of output",
      { default: DEFAULT_TERMINAL_WAIT_MAX_OUTPUT_BYTES },
    ),
    tailBytes: flag("--tail-bytes <n>", "Bound each output poll to N bytes"),
    limitChunks: flag(
      "--limit-chunks <n>",
      "Bound each output poll to N chunks",
    ),
    ...JSON_OPTION,
    ...REDUNDANT_SCOPE_OPTIONS,
  },
  run: async ({ positionals: { terminalId }, options }, client) => {
    const sdk = client.sdk();
    const plan = await resolveTerminalWaitPlan({
      opts: options,
      sdk,
      terminalId,
    });
    reportTerminalObservation({
      json: options.json,
      report: await observeTerminal({ plan, sdk, terminalId }),
    });
    return null;
  },
  print: () => null,
});

const terminalRenameCommand = publicCommand("terminals.update", {
  path: ["terminal", "rename"],
  summary: "Rename a terminal session",
  positionals: { ...TERMINAL_ID_POSITIONAL, title: arg("<title>") },
  options: REDUNDANT_SCOPE_OPTIONS,
  prepare: ({ positionals: { terminalId, title } }) => ({ terminalId, title }),
  print: (session, { terminalId }) =>
    `Renamed terminal ${terminalId} to ${session.title}`,
});

const terminalRestartCommand = clientCommand({
  path: ["terminal", "restart"],
  summary: "Replace a terminal with a shell in the same scope",
  positionals: TERMINAL_ID_POSITIONAL,
  options: REDUNDANT_SCOPE_OPTIONS,
  run: ({ positionals: { terminalId } }, client) =>
    client.sdk().terminals.restart({ terminalId }),
  print: (session, { positionals }) =>
    `Restarted terminal ${positionals.terminalId} as ${session.id}`,
});

const terminalCloseCommand = publicCommand("terminals.close", {
  path: ["terminal", "close"],
  summary: "Close a terminal session",
  aliases: ["stop"],
  positionals: TERMINAL_ID_POSITIONAL,
  options: {
    ifClean: flag("--if-clean", "Only close if no user input was sent"),
    ...REDUNDANT_SCOPE_OPTIONS,
  },
  prepare: ({ positionals, options }) => ({
    terminalId: positionals.terminalId,
    mode: options.ifClean ? "if-clean" : "force",
    reason: "user",
  }),
  print: (_session, { terminalId }) => `Closed terminal ${terminalId}`,
});

export const terminalCommands = [
  terminalListCommand,
  terminalCreateCommand,
  terminalRunCommand,
  terminalShowCommand,
  terminalAttachCommand,
  terminalSendCommand,
  terminalResizeCommand,
  terminalOutputCommand,
  terminalWaitCommand,
  terminalRenameCommand,
  terminalRestartCommand,
  terminalCloseCommand,
];

export function registerTerminalCommands(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("terminal")
    .description(
      "Manage terminal sessions across threads, environments, and machines",
    );
  mountCommands(program, terminalCommands, { getUrl });
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
