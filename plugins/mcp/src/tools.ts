import type { CliRunner } from "./cli-runner.js";
import {
  SEARCH_DEFAULT_LIMIT,
  searchCommands,
  type CommandIndex,
} from "./command-index.js";
import { createLimiter } from "./limiter.js";
import { evaluateCliAccess, type McpToolMode } from "./policy.js";
import {
  runSandboxedScript,
  type JsonValue,
  type SandboxHostFunction,
  type SandboxLimits,
} from "./sandbox.js";

export const SCRIPT_TOTAL_DEADLINE_MS = 25_000;
const CLI_CALL_TIMEOUT_MS = 24_000;
const SLEEP_MAX_MS = 20_000;
export const MAX_CONCURRENT_CLI_CALLS_PER_SCRIPT = 4;
const RESULT_MAX_CHARS = 60_000;
const NO_KNOWN_PATHS: ReadonlySet<string> = new Set();

export const SANDBOX_PRELUDE = `
(() => {
  const call = async (name, args) => JSON.parse(await __bbHost(name, JSON.stringify(args)));
  const format = (value) => {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const log = (...values) => { __bbLog(values.map(format).join(" ")); };
  const cli = (argv, options) => call("cli", [argv, options === undefined ? {} : options]);
  const json = async (argv, options) => {
    const result = await cli([...argv, "--json"], options);
    if (result.json === undefined) {
      throw new Error((result.stderr || result.stdout || "bb exited with " + result.exitCode).trim());
    }
    if (result.exitCode !== 0) {
      const error = result.json && result.json.error;
      const hint = error && error.hint ? " (" + error.hint + ")" : "";
      throw new Error(error && error.message ? error.message + hint : result.stderr.trim());
    }
    return result.json;
  };
  const sleep = (ms) => call("sleep", [ms]);
  Object.defineProperty(globalThis, "bb", {
    value: Object.freeze({ cli, json, sleep }),
    writable: false,
    configurable: false,
  });
  Object.defineProperty(globalThis, "console", {
    value: Object.freeze({ log, info: log, warn: log, error: log, debug: log }),
    writable: false,
    configurable: false,
  });
})();
`;

export interface ToolTextResult {
  text: string;
  isError: boolean;
}

export interface ToolDependencies {
  runCli: CliRunner;
  loadCommandIndex: () => Promise<CommandIndex>;
  sandboxLimits?: Partial<SandboxLimits>;
}

function truncate(text: string): string {
  if (text.length <= RESULT_MAX_CHARS) return text;
  return `${text.slice(0, RESULT_MAX_CHARS)}\n[truncated: ${text.length - RESULT_MAX_CHARS} more characters. Return less: filter or slice inside the script.]`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseCliArguments(args: readonly JsonValue[]): {
  argv: string[];
  stdin: string | null;
} {
  const [argv, options] = args;
  if (
    !Array.isArray(argv) ||
    !argv.every((entry): entry is string => typeof entry === "string")
  ) {
    throw new Error(
      "bb.cli expects an array of strings, e.g. bb.cli(['thread', 'list', '--json']).",
    );
  }
  let stdin: string | null = null;
  if (options !== undefined && options !== null) {
    if (typeof options !== "object" || Array.isArray(options)) {
      throw new Error("bb.cli options must be an object.");
    }
    const value = options.stdin;
    if (value !== undefined && value !== null) {
      if (typeof value !== "string") {
        throw new Error("bb.cli options.stdin must be a string.");
      }
      stdin = value;
    }
  }
  return { argv, stdin };
}

function createHostFunctions(
  mode: McpToolMode,
  dependencies: ToolDependencies,
): Record<string, SandboxHostFunction> {
  const limiter = createLimiter(MAX_CONCURRENT_CLI_CALLS_PER_SCRIPT);
  return {
    cli: async (args, signal) => {
      const { argv, stdin } = parseCliArguments(args);
      const knownPaths =
        mode === "write"
          ? NO_KNOWN_PATHS
          : (await dependencies.loadCommandIndex()).paths;
      const decision = evaluateCliAccess(argv, mode, knownPaths);
      if (!decision.allowed) throw new Error(decision.reason);
      const result = await limiter.run(
        () =>
          dependencies.runCli(argv, {
            stdin,
            timeoutMs: CLI_CALL_TIMEOUT_MS,
            signal,
          }),
        signal,
      );
      const response: { [key: string]: JsonValue } = {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      if (result.timedOut) response.timedOut = true;
      if (result.truncated) response.truncated = true;
      const trimmed = result.stdout.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          response.json = JSON.parse(trimmed) as JsonValue;
        } catch {
          response.jsonError = "stdout is not valid JSON";
        }
      }
      return response;
    },
    sleep: async (args, signal) => {
      const requested = typeof args[0] === "number" ? args[0] : 0;
      const delay = Math.max(0, Math.min(requested, SLEEP_MAX_MS));
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, delay);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      });
      return null;
    },
  };
}

export async function executeScript(
  code: string,
  mode: McpToolMode,
  dependencies: ToolDependencies,
  signal?: AbortSignal,
): Promise<ToolTextResult> {
  const outcome = await runSandboxedScript({
    code,
    prelude: SANDBOX_PRELUDE,
    hostFunctions: createHostFunctions(mode, dependencies),
    limits: {
      totalDeadlineMs: SCRIPT_TOTAL_DEADLINE_MS,
      ...dependencies.sandboxLimits,
    },
    ...(signal === undefined ? {} : { signal }),
  });
  const logs = outcome.logs.length > 0 ? `\n\nLogs:\n${outcome.logs}` : "";
  if (!outcome.ok) {
    return { text: truncate(`Error: ${outcome.error}${logs}`), isError: true };
  }
  const body =
    typeof outcome.value === "string"
      ? outcome.value
      : JSON.stringify(outcome.value, null, 2);
  return { text: truncate(`${body}${logs}`), isError: false };
}

export async function runReadTool(
  code: string,
  dependencies: ToolDependencies,
  signal?: AbortSignal,
): Promise<ToolTextResult> {
  return executeScript(code, "read", dependencies, signal);
}

export async function runRunTool(
  code: string,
  dependencies: ToolDependencies,
  signal?: AbortSignal,
): Promise<ToolTextResult> {
  return executeScript(code, "write", dependencies, signal);
}

export async function runSearchTool(
  query: string,
  limit: number | undefined,
  dependencies: ToolDependencies,
): Promise<ToolTextResult> {
  try {
    const index = await dependencies.loadCommandIndex();
    const commands = searchCommands(
      index,
      query,
      limit ?? SEARCH_DEFAULT_LIMIT,
    );
    return {
      text: JSON.stringify(
        {
          commands,
          more: [
            "Full options for one command: bb.cli([...path, '--help']).",
            "Every command in a group on one page: bb.cli(['guide', 'commands', '<group>']).",
            "Concepts and workflows: bb.cli(['guide']) lists the chapters; bb.cli(['guide', '<chapter>']) prints one.",
            "JSON output shapes: bb.cli(['guide', 'json']).",
            "Commands added by plugins are not in this index: bb.cli(['plugin', 'list', '--json']) lists plugins, and `bb <plugin-command> --help` (run tool) shows a plugin's commands.",
          ],
        },
        null,
        2,
      ),
      isError: false,
    };
  } catch (error) {
    return { text: `Error: ${errorMessage(error)}`, isError: true };
  }
}
