import {
  experimental_CliError,
  experimental_cliCommand,
  experimental_defineCli,
  type PluginCliContext,
  type PluginCliRegistration,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { rpcContract } from "./contracts.js";

export type BrowserCliMethod =
  | "open"
  | "list"
  | "run"
  | "pages"
  | "screenshot"
  | "preview"
  | "stop"
  | "close";

export interface BrowserCliInput {
  threadId: string;
  sessionId?: string;
  selection?: z.input<typeof rpcContract.open.input>["selection"];
  script?: string;
  timeoutMs?: number;
  page?: string;
  afterSequence?: number;
}

export interface BrowserCliRequest {
  method: BrowserCliMethod;
  input: BrowserCliInput;
  scriptFile?: string;
  scriptHost?: string;
}

const SESSION_POSITIONAL = {
  name: "session-id",
  description: "Session id returned by `bb browser-automation open`",
  required: true,
} as const;

const THREAD_OPTION = {
  type: "string",
  placeholder: "id",
  description:
    "Thread that owns the session; defaults to the invoking thread and cannot name another",
} as const;

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

const REOPEN_HINT =
  "Open a new session with `bb browser-automation open --backend <desktop|local> --machine <host-id>`.";

function resolveThreadId(
  option: string | undefined,
  ctx: PluginCliContext,
): string {
  const threadId = option ?? ctx.threadId;
  if (threadId === undefined || threadId === "") {
    throw new experimental_CliError(
      "Run from a BB thread or pass --thread <id>",
      { code: "thread_required" },
    );
  }
  if (ctx.threadId !== undefined && threadId !== ctx.threadId) {
    throw new experimental_CliError(
      "CLI calls from a thread cannot access another thread's browser session",
      { code: "cross_thread" },
    );
  }
  return threadId;
}

export function createBrowserAutomationCli(deps: {
  execute(
    request: BrowserCliRequest,
    ctx: PluginCliContext,
  ): Promise<PluginCliResult>;
}): PluginCliRegistration {
  return experimental_defineCli({
    name: "browser-automation",
    summary: "Persistent DevBrowser desktop and headless sessions",
    description:
      "Sessions belong to the thread that opened them and expire after 30 minutes idle.\nA stopped or expired session cannot be resumed; open a new one.",
    commands: {
      open: experimental_cliCommand({
        summary:
          "Open an isolated desktop or local headless session; --tab hands off an existing tab",
        options: {
          backend: {
            type: "enum",
            values: ["desktop", "local"],
            required: true,
            description:
              "desktop drives a connected browser instance; local runs headless on the host",
          },
          machine: {
            type: "string",
            required: true,
            placeholder: "host-id",
            description: "Host that runs the browser",
          },
          desktop: {
            type: "string",
            placeholder: "instance-id",
            description: "Desktop instance to drive (desktop backend only)",
          },
          tab: {
            type: "string",
            placeholder: "tab-id",
            description:
              "Existing desktop tab to control instead of opening one (desktop backend only)",
          },
          headless: {
            type: "boolean",
            description: "Required by the local backend, rejected by desktop",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const hostId = input.options.machine;
          if (input.options.backend === "local") {
            if (
              !input.options.headless ||
              input.options.desktop !== undefined ||
              input.options.tab !== undefined
            ) {
              throw new experimental_CliError(
                "Local sessions require --headless and cannot select desktop tabs",
                { code: "invalid_selection" },
              );
            }
            return deps.execute(
              {
                method: "open",
                input: { threadId, selection: { backend: "local", hostId } },
              },
              ctx,
            );
          }
          const instanceId = input.options.desktop;
          if (instanceId === undefined || input.options.headless) {
            throw new experimental_CliError(
              "Desktop sessions require --desktop <instance-id> and cannot use --headless",
              { code: "invalid_selection" },
            );
          }
          return deps.execute(
            {
              method: "open",
              input: {
                threadId,
                selection: {
                  backend: "desktop",
                  hostId,
                  instanceId,
                  ...(input.options.tab === undefined
                    ? {}
                    : { tabId: input.options.tab }),
                },
              },
            },
            ctx,
          );
        },
      }),
      list: experimental_cliCommand({
        summary: "List this thread's browser sessions",
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "list",
              input: { threadId: resolveThreadId(input.options.thread, ctx) },
            },
            ctx,
          ),
      }),
      run: experimental_cliCommand({
        summary: "Run a trusted DevBrowser script; runs serialize per session",
        description:
          "Scripts may return at most 4 screenshots per run, JPEG only, 500 KB combined;\nanything larger or in another format fails the run.",
        positionals: [SESSION_POSITIONAL],
        constraints: [
          { kind: "exactly-one", options: ["script", "script-file"] },
          { kind: "requires", option: "script-file", needs: ["script-host"] },
          { kind: "requires", option: "script-host", needs: ["script-file"] },
          { kind: "at-most-one", options: ["timeout", "timeout-ms"] },
        ],
        options: {
          script: {
            type: "string",
            placeholder: "code",
            description: "DevBrowser script source",
          },
          "script-file": {
            type: "string",
            placeholder: "path",
            description: "File holding the script, read from --script-host",
          },
          "script-host": {
            type: "string",
            placeholder: "host-id",
            description: "Host that holds --script-file",
          },
          "timeout-ms": {
            type: "integer",
            min: 1000,
            max: 120_000,
            default: 30_000,
            description: "Run timeout in milliseconds",
          },
          timeout: {
            type: "duration",
            defaultUnit: "s",
            bareUnits: ["s", "ms"],
            min: 1000,
            max: 120_000,
            description:
              "Run timeout as a duration (90s, 2m, 1500ms); a bare number is seconds (1-120) or milliseconds (1000-120000)",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run(input, ctx) {
          const threadId = resolveThreadId(input.options.thread, ctx);
          const scriptFile = input.options["script-file"];
          const scriptHost = input.options["script-host"];
          return deps.execute(
            {
              method: "run",
              input: {
                threadId,
                sessionId: input.positionals["session-id"],
                ...(input.options.script === undefined
                  ? {}
                  : { script: input.options.script }),
                timeoutMs: input.options.timeout ?? input.options["timeout-ms"],
              },
              ...(scriptFile === undefined ? {} : { scriptFile }),
              ...(scriptHost === undefined ? {} : { scriptHost }),
            },
            ctx,
          );
        },
      }),
      pages: experimental_cliCommand({
        summary: "Inspect persistent named pages",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "pages",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      screenshot: experimental_cliCommand({
        summary:
          "Save a bounded JPEG in session tmp; return its path and host ID",
        positionals: [SESSION_POSITIONAL],
        options: {
          page: {
            type: "string",
            placeholder: "name",
            default: "main",
            description: "Named page to capture",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "screenshot",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                page: input.options.page,
              },
            },
            ctx,
          ),
      }),
      preview: experimental_cliCommand({
        summary:
          "Describe the live preview frame of a local headless session, without image bytes",
        positionals: [SESSION_POSITIONAL],
        options: {
          after: {
            type: "integer",
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            default: 0,
            description: "Only report a frame newer than this sequence number",
          },
          thread: THREAD_OPTION,
          json: JSON_OPTION,
        },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "preview",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
                afterSequence: input.options.after,
              },
            },
            ctx,
          ),
      }),
      stop: experimental_cliCommand({
        summary:
          "Cancel queued and running work and release control; open a new session to resume",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "stop",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
      close: experimental_cliCommand({
        summary: "Dispose owned browsers and tabs, preserving handed-off tabs",
        positionals: [SESSION_POSITIONAL],
        options: { thread: THREAD_OPTION, json: JSON_OPTION },
        run: (input, ctx) =>
          deps.execute(
            {
              method: "close",
              input: {
                threadId: resolveThreadId(input.options.thread, ctx),
                sessionId: input.positionals["session-id"],
              },
            },
            ctx,
          ),
      }),
    },
  });
}

export function browserCliFailure(error: unknown): experimental_CliError {
  if (error instanceof experimental_CliError) return error;
  const message =
    error instanceof Error ? error.message : "Browser command failed";
  if (/stopped or expired|does not belong to this thread/u.test(message)) {
    return new experimental_CliError(message, {
      code: "session_unavailable",
      hint: REOPEN_HINT,
    });
  }
  if (/screenshot|JPEG/iu.test(message)) {
    return new experimental_CliError(message, {
      code: "screenshot_limit",
      hint: "Return at most 4 JPEG screenshots per run, 500 KB combined.",
    });
  }
  return new experimental_CliError(message, { code: "command_failed" });
}
