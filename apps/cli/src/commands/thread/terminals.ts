import { Buffer } from "node:buffer";
import { Command } from "commander";
import { BbHttpError } from "@bb/sdk";
import { createNodeWebsocketFactory } from "@bb/sdk/node-websocket";
import {
  terminalServerMessageSchema,
  type TerminalSession,
} from "@bb/server-contract";
import { action, CliExitError } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { renderBorderlessTable } from "../../table.js";
import {
  outputJson,
  printContextLabel,
  requireThreadIdWithLabel,
} from "../helpers.js";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const TERMINAL_WAIT_TIMEOUT_EXIT_CODE = 124;

interface TerminalJsonOptions {
  json?: boolean;
}

interface TerminalListOptions extends TerminalJsonOptions {}

interface TerminalStartOptions extends TerminalJsonOptions {
  attach?: boolean;
  command?: string;
  cols?: string;
  rows?: string;
  title?: string;
}

interface TerminalAttachOptions extends TerminalJsonOptions {}

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

interface TerminalWaitOptions extends TerminalOutputOptions {
  contains?: string;
  exit?: boolean;
  fromStart?: boolean;
  pollInterval?: string;
  regex?: string;
  timeout?: string;
}

interface TerminalStopOptions extends TerminalJsonOptions {
  ifClean?: boolean;
}

interface TerminalStartResolution {
  command: string | null;
  threadId: string;
}

export function registerTerminalCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const terminal = parent
    .command("terminal")
    .description("Manage terminal sessions scoped to a thread");

  terminal
    .command("list <threadId>")
    .description("List terminal sessions for a thread")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (threadId: string | undefined, opts: TerminalListOptions) => {
          const resolved = requireThreadIdWithLabel(threadId);
          const sdk = createCliBbSdk(getUrl());
          printContextLabel(resolved, "Thread", "BB_THREAD_ID", opts);
          const result = await sdk.threads.terminals.list({
            threadId: resolved.id,
          });
          if (outputJson(opts, result)) return;
          printTerminalTable(result.sessions);
        },
      ),
    );

  terminal
    .command("start <threadId> [command...]")
    .description("Start a thread-scoped terminal session")
    .allowUnknownOption(true)
    .option("--title <title>", "Terminal title")
    .option(
      "--command <command>",
      "Command to run instead of an interactive shell",
    )
    .option("--cols <n>", "Initial terminal columns")
    .option("--rows <n>", "Initial terminal rows")
    .option("--attach", "Attach after starting")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          threadId: string | undefined,
          commandParts: string[],
          opts: TerminalStartOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const resolvedStart = resolveTerminalStart({
            commandOption: opts.command,
            commandParts,
            threadId,
          });
          const resolvedThread = requireThreadIdWithLabel(
            resolvedStart.threadId,
          );
          const session = await sdk.threads.terminals.create({
            threadId: resolvedThread.id,
            cols: parsePositiveInteger(opts.cols, DEFAULT_COLS, "--cols"),
            rows: parsePositiveInteger(opts.rows, DEFAULT_ROWS, "--rows"),
            title: opts.title,
            start:
              resolvedStart.command === null
                ? { mode: "shell" }
                : { mode: "command", command: resolvedStart.command },
          });
          if (outputJson(opts, session)) return;
          console.log(`Started terminal ${session.id} (${session.title})`);
          if (opts.attach) {
            await attachTerminal({
              baseUrl: getUrl(),
              terminalId: session.id,
              threadId: resolvedThread.id,
            });
          }
        },
      ),
    );

  terminal
    .command("attach <terminalId> <threadId>")
    .description("Attach to a running terminal session")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalAttachOptions,
        ) => {
          const resolved = requireThreadIdWithLabel(threadId);
          if (opts.json) {
            const sdk = createCliBbSdk(getUrl());
            const result = await sdk.threads.terminals.list({
              threadId: resolved.id,
            });
            const session = result.sessions.find(
              (candidate) => candidate.id === terminalId,
            );
            if (session === undefined) {
              throw new Error(
                `Terminal ${terminalId} was not found in thread ${resolved.id}`,
              );
            }
            outputJson(opts, session);
            return;
          }
          await attachTerminal({
            baseUrl: getUrl(),
            terminalId,
            threadId: resolved.id,
          });
        },
      ),
    );

  terminal
    .command("send <terminalId> <threadId>")
    .description("Send input to a terminal session")
    .option("--text <text>", "Text to send")
    .option("--stdin", "Read bytes from stdin")
    .option("--enter", "Append a newline")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalSendOptions,
        ) => {
          const text = await resolveSendText(opts);
          const resolved = requireThreadIdWithLabel(threadId);
          const sdk = createCliBbSdk(getUrl());
          const session = await sdk.threads.terminals.input({
            threadId: resolved.id,
            terminalId,
            dataBase64: Buffer.from(text, "utf8").toString("base64"),
          });
          if (outputJson(opts, session)) return;
          console.log(`Sent input to terminal ${terminalId}`);
        },
      ),
    );

  terminal
    .command("resize <terminalId> <threadId>")
    .description("Resize a terminal session")
    .requiredOption("--cols <n>", "Terminal columns")
    .requiredOption("--rows <n>", "Terminal rows")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalResizeOptions,
        ) => {
          const resolved = requireThreadIdWithLabel(threadId);
          const sdk = createCliBbSdk(getUrl());
          const session = await sdk.threads.terminals.resize({
            threadId: resolved.id,
            terminalId,
            cols: parseRequiredPositiveInteger(opts.cols, "--cols"),
            rows: parseRequiredPositiveInteger(opts.rows, "--rows"),
          });
          if (outputJson(opts, session)) return;
          console.log(
            `Resized terminal ${terminalId} to ${session.cols}x${session.rows}`,
          );
        },
      ),
    );

  terminal
    .command("output <terminalId> <threadId>")
    .description("Print terminal output from daemon scrollback")
    .option("--since-seq <n>", "Only output chunks from this sequence")
    .option("--tail-bytes <n>", "Bound output to the latest N bytes")
    .option("--limit-chunks <n>", "Bound output to the latest N chunks")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalOutputOptions,
        ) => {
          const resolved = requireThreadIdWithLabel(threadId);
          const sdk = createCliBbSdk(getUrl());
          const output = await sdk.threads.terminals.output({
            threadId: resolved.id,
            terminalId,
            ...terminalOutputQuery(opts),
          });
          if (outputJson(opts, output)) return;
          writeOutputChunks(output.chunks);
        },
      ),
    );

  terminal
    .command("wait <terminalId> <threadId>")
    .description("Wait for terminal output or exit")
    .option("--contains <text>", "Wait until output contains text")
    .option(
      "--regex <pattern>",
      "Wait until output matches a regular expression",
    )
    .option("--exit", "Wait until the terminal exits")
    .option("--from-start", "Include existing scrollback from sequence 0")
    .option("--timeout <seconds>", "Timeout in seconds", "30")
    .option("--poll-interval <ms>", "Polling interval in milliseconds", "500")
    .option("--tail-bytes <n>", "Bound each output poll to N bytes")
    .option("--limit-chunks <n>", "Bound each output poll to N chunks")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalWaitOptions,
        ) => {
          const result = await waitForTerminal({
            baseUrl: getUrl(),
            opts,
            terminalId,
            threadId: requireThreadIdWithLabel(threadId).id,
          });
          if (outputJson(opts, result)) return;
          console.log(`Terminal ${terminalId} matched ${result.matched}`);
        },
      ),
    );

  terminal
    .command("stop <terminalId> <threadId>")
    .description("Stop a terminal session")
    .option("--if-clean", "Only stop if no user input was sent")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          terminalId: string,
          threadId: string | undefined,
          opts: TerminalStopOptions,
        ) => {
          const resolved = requireThreadIdWithLabel(threadId);
          const sdk = createCliBbSdk(getUrl());
          const session = await sdk.threads.terminals.close({
            threadId: resolved.id,
            terminalId,
            mode: opts.ifClean ? "if-clean" : "force",
            reason: "user",
          });
          if (outputJson(opts, session)) return;
          console.log(`Stopped terminal ${terminalId}`);
        },
      ),
    );
}

function resolveTerminalStart(args: {
  commandOption?: string;
  commandParts: readonly string[];
  threadId: string | undefined;
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
    return { threadId: args.threadId ?? "", command };
  }
  if (args.commandParts.length > 0) {
    return {
      threadId: args.threadId ?? "",
      command: args.commandParts.map(shellQuoteArg).join(" "),
    };
  }
  return { threadId: args.threadId ?? "", command: null };
}

function shellQuoteArg(value: string): string {
  if (value.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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

async function resolveSendText(opts: TerminalSendOptions): Promise<string> {
  if (opts.text !== undefined && opts.stdin) {
    throw new Error("Provide only one of --text or --stdin");
  }
  if (opts.text === undefined && !opts.stdin) {
    throw new Error("Provide one of --text or --stdin");
  }
  const baseText =
    opts.text ??
    (await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
      process.stdin.on("error", reject);
      process.stdin.on("end", () =>
        resolve(Buffer.concat(chunks).toString("utf8")),
      );
    }));
  return opts.enter ? `${baseText}\n` : baseText;
}

function terminalOutputQuery(opts: TerminalOutputOptions) {
  return {
    ...(opts.sinceSeq !== undefined
      ? { sinceSeq: parseNonNegativeInteger(opts.sinceSeq, "--since-seq") }
      : {}),
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
  const colWidths = [12, 24, 14, 10].map((minWidth, index) =>
    Math.max(minWidth, ...rows.map((row) => row[index].length)),
  );
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Title", "Status", "Size"],
        colWidths,
      },
      rows,
    ),
  );
  console.log("");
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
  threadId: string;
}): string {
  const url = new URL(args.baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/ws/threads/${encodeURIComponent(
    args.threadId,
  )}/terminals/${encodeURIComponent(args.terminalId)}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

async function attachTerminal(args: {
  baseUrl: string;
  terminalId: string;
  threadId: string;
}): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Attach requires an interactive terminal");
  }

  const socket = createNodeWebsocketFactory()(
    terminalWebsocketUrl({
      baseUrl: args.baseUrl,
      terminalId: args.terminalId,
      threadId: args.threadId,
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

function sendTerminalInput(
  socket: { send(data: string): void },
  chunk: Buffer,
) {
  socket.send(
    JSON.stringify({
      type: "input",
      dataBase64: chunk.toString("base64"),
    }),
  );
}

async function waitForTerminal(args: {
  baseUrl: string;
  opts: TerminalWaitOptions;
  terminalId: string;
  threadId: string;
}): Promise<{ matched: string; nextSeq: number; terminalId: string }> {
  const hasContains = args.opts.contains !== undefined;
  const hasRegex = args.opts.regex !== undefined;
  const hasExit = args.opts.exit === true;
  if ([hasContains, hasRegex, hasExit].filter(Boolean).length !== 1) {
    throw new Error("Provide exactly one of --contains, --regex, or --exit");
  }
  const sdk = createCliBbSdk(args.baseUrl);
  const timeoutMs =
    parsePositiveInteger(args.opts.timeout, 30, "--timeout") * 1000;
  const pollIntervalMs = parsePositiveInteger(
    args.opts.pollInterval,
    500,
    "--poll-interval",
  );
  const deadline = Date.now() + timeoutMs;
  let nextSeq = args.opts.fromStart ? 0 : undefined;
  const regex =
    args.opts.regex === undefined ? null : new RegExp(args.opts.regex, "u");

  if (!hasExit && nextSeq === undefined) {
    const currentOutput = await readTerminalOutputForWait({
      sdk,
      terminalId: args.terminalId,
      threadId: args.threadId,
      query: { limitChunks: 1, tailBytes: 1 },
    });
    nextSeq = currentOutput.nextSeq;
  }

  while (Date.now() <= deadline) {
    if (hasExit) {
      const sessions = await sdk.threads.terminals.list({
        threadId: args.threadId,
      });
      const session = sessions.sessions.find(
        (candidate) => candidate.id === args.terminalId,
      );
      if (!session || session.status === "exited") {
        return {
          matched: "exit",
          nextSeq: nextSeq ?? 0,
          terminalId: args.terminalId,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    const output = await readTerminalOutputForWait({
      sdk,
      terminalId: args.terminalId,
      threadId: args.threadId,
      query: {
        ...terminalOutputQuery(args.opts),
        ...(nextSeq !== undefined ? { sinceSeq: nextSeq } : {}),
      },
    });
    nextSeq = output.nextSeq;
    const text = output.chunks
      .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
      .join("");
    if (args.opts.contains !== undefined && text.includes(args.opts.contains)) {
      return {
        matched: args.opts.contains,
        nextSeq,
        terminalId: args.terminalId,
      };
    }
    if (regex && regex.test(text)) {
      return {
        matched: args.opts.regex ?? "",
        nextSeq,
        terminalId: args.terminalId,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new CliExitError(
    `Timed out waiting for terminal ${args.terminalId}`,
    TERMINAL_WAIT_TIMEOUT_EXIT_CODE,
  );
}

async function readTerminalOutputForWait(args: {
  query: ReturnType<typeof terminalOutputQuery>;
  sdk: ReturnType<typeof createCliBbSdk>;
  terminalId: string;
  threadId: string;
}) {
  return args.sdk.threads.terminals
    .output({
      threadId: args.threadId,
      terminalId: args.terminalId,
      ...args.query,
    })
    .catch((error: unknown) => {
      if (isTerminalOutputUnavailable(error)) {
        throw new CliExitError(
          `Terminal ${args.terminalId} exited before the requested output matched`,
          TERMINAL_WAIT_TIMEOUT_EXIT_CODE,
        );
      }
      throw error;
    });
}

function isTerminalOutputUnavailable(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 409 &&
    error.code === "terminal_output_unavailable"
  );
}
