import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@bb/process-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/process-utils")>()),
  execHostFile: vi.fn(async () => {
    throw new Error("The guard does not start processes");
  }),
}));
vi.mock("@bb/process-utils/host-process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@bb/process-utils/host-process")>()),
  execHostFileCallback: vi.fn(() => {
    throw new Error("The guard does not start processes");
  }),
  spawnHostProcess: vi.fn(() => {
    throw new Error("The guard does not start processes");
  }),
  spawnHostProcessSync: vi.fn(() => {
    throw new Error("The guard does not start processes");
  }),
}));
vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(async () => "y"),
    close: vi.fn(),
  })),
}));

import { CORE_COMMAND_GROUPS } from "../command-groups.js";

const SERVER_URL = "http://127.0.0.1:1";

const COMMANDS_THAT_SUCCEED_WITHOUT_THE_SERVER = new Map([
  [
    "plugin new",
    "scaffolds locally; its only request is best-effort telemetry",
  ],
]);

const COMMANDS_THAT_PRINT_DIAGNOSTICS_ON_FAILURE = new Map([
  ["status", "prints the local context it could resolve before failing"],
]);

interface Leaf {
  path: string[];
  command: Command;
}

function leafCommands(parent: Command, prefix: string[] = []): Leaf[] {
  return parent.commands.flatMap((command) => {
    const path = [...prefix, command.name()];
    return command.commands.length === 0
      ? [{ path, command }]
      : leafCommands(command, path);
  });
}

async function buildProgram(): Promise<Command> {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  const registrars = await Promise.all(
    CORE_COMMAND_GROUPS.map((group) => group.load()),
  );
  for (const register of registrars) {
    register(program, {
      getUrl: () => SERVER_URL,
      getContext: () => ({ serverUrl: SERVER_URL }),
    });
  }
  return program;
}

function placeholderArgs(command: Command, json: boolean): string[] {
  const args = command.registeredArguments.map(() => "x");
  for (const option of command.options) {
    if (option.mandatory && option.long !== undefined) {
      args.push(option.long, "x");
    }
    if (option.long === "--yes") args.push("--yes");
  }
  if (json) args.push("--json");
  return args;
}

interface Run {
  exitCode: number;
  requests: number;
  stdout: string;
}

async function runAgainstFailingServer(argv: string[]): Promise<Run> {
  const program = await buildProgram();
  let requests = 0;
  const stdout: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    requests += 1;
    return new Response(
      JSON.stringify({ code: "guard_failure", error: "The server failed" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "info").mockImplementation((...parts: unknown[]) => {
    stdout.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array, ...rest: unknown[]) => {
      stdout.push(String(chunk));
      const callback = rest.find((value) => typeof value === "function");
      if (typeof callback === "function") callback();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation(
    (_chunk: string | Uint8Array, ...rest: unknown[]) => {
      const callback = rest.find((value) => typeof value === "function");
      if (typeof callback === "function") callback();
      return true;
    },
  );
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    Object.assign(Readable.from(["x"]), {
      fd: 0,
    }) as unknown as typeof process.stdin,
  );
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code ?? 0}`);
  });
  let exitCode: number;
  try {
    await program.parseAsync(["node", "bb", ...argv]);
    exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exitCode = message.startsWith("process.exit:")
      ? Number(message.slice("process.exit:".length))
      : 1;
  } finally {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  }
  return { exitCode, requests, stdout: stdout.join("\n").trim() };
}

function isErrorEnvelope(stdout: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "ok" in parsed &&
      parsed.ok === false
    );
  } catch {
    return false;
  }
}

const program = await buildProgram();
const invocations = leafCommands(program)
  .filter(
    ({ path }) => !COMMANDS_THAT_SUCCEED_WITHOUT_THE_SERVER.has(path.join(" ")),
  )
  .flatMap(({ path, command }) => {
    const supportsJson = command.options.some(
      (option) => option.long === "--json",
    );
    return (supportsJson ? [false, true] : [false]).map((json) => ({
      argv: [...path, ...placeholderArgs(command, json)],
      printsDiagnostics: COMMANDS_THAT_PRINT_DIAGNOSTICS_ON_FAILURE.has(
        path.join(" "),
      ),
    }));
  });

describe("every command against a failing server", () => {
  let previousCwd: string;
  let scratch: string;

  beforeAll(() => {
    previousCwd = process.cwd();
    scratch = mkdtempSync(join(tmpdir(), "bb-cli-failing-server-"));
    process.chdir(scratch);
  });

  afterAll(() => {
    process.chdir(previousCwd);
    rmSync(scratch, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(
    invocations.map(
      ({ argv, printsDiagnostics }) =>
        [argv.join(" "), argv, printsDiagnostics] as const,
    ),
  )(
    "bb %s exits non-zero without success output",
    async (_label, argv, printsDiagnostics) => {
      vi.stubEnv("HOME", scratch);
      vi.stubEnv("BB_DATA_DIR", join(scratch, "data"));
      vi.stubEnv("BB_SERVER_URL", SERVER_URL);
      vi.stubEnv("BB_THREAD_ID", "thr_guard");
      vi.stubEnv("BB_PROJECT_ID", "proj_guard");
      vi.stubEnv("BB_ENVIRONMENT_ID", "env_guard");
      vi.stubEnv("BB_THREAD_STORAGE", undefined);
      vi.stubEnv("BB_CLI", undefined);
      vi.stubEnv("BB_CLI_REEXEC", undefined);

      const run = await runAgainstFailingServer(argv);

      if (run.requests === 0) return;
      expect(run.exitCode).not.toBe(0);
      if (run.stdout !== "" && !printsDiagnostics) {
        expect(isErrorEnvelope(run.stdout)).toBe(true);
      }
    },
  );
});
