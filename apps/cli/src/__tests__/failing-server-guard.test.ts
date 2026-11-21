import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  makeEnvironment,
  makeThread,
} from "./helpers/command-output-fixtures.js";

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
const RUN_TIMEOUT_MS = 1_500;

const IDS = {
  environment: "env_aaaaaaaaaa",
  host: "host_aaaaaaaaaa",
  plugin: "notes",
  project: "proj_aaaaaaaaaa",
  terminal: "term_aaaaaaaaaa",
  thread: "thr_aaaaaaaaaa",
} as const;

const ID_BY_GROUP: Record<string, string> = {
  environment: IDS.environment,
  machine: IDS.host,
  plugin: IDS.plugin,
  project: IDS.project,
  terminal: IDS.terminal,
  thread: IDS.thread,
};

const PLACEHOLDER_BY_ARGUMENT: Record<string, string> = {
  "id-or-name": IDS.host,
  "plugin-id": IDS.plugin,
  "source-thread-id": IDS.thread,
  projectId: IDS.project,
  terminalId: IDS.terminal,
  threadId: IDS.thread,
  state: "on",
  task: "thread-title",
  action: "set",
  message: "1",
  messageId: "1",
};

const PLACEHOLDER_BY_OPTION: Record<string, string> = {
  "--cols": "80",
  "--rows": "24",
  "--expected-revision": "1",
  "--tabs-json": "[]",
  "--host": IDS.host,
  "--thread": IDS.thread,
  "--project": IDS.project,
};

const ARGUMENTS_BY_COMMAND: Record<string, readonly string[]> = {
  "browser import-cookies": [
    "--host",
    IDS.host,
    "--instance",
    "x",
    "--generation",
    "x",
    "--from",
    "chrome",
    "--profile",
    "Default",
  ],
  "environment update": [IDS.environment, "--name", "x"],
  "plugin install": ["path:/tmp/x", "--yes"],
  "terminal close": [IDS.terminal, "--if-clean"],
  "file write": ["/tmp/x", "--host", IDS.host, "--content", "x"],
  "project create": ["--name", "x", "--root", "/tmp/x", "--host", IDS.host],
  "project discover": ["--host", IDS.host],
  "project source add": [IDS.project, "--path", "/tmp/x", "--host", IDS.host],
  "project update": [IDS.project, "--name", "x"],
  "settings experiment": ["agentCpuPriority", "on"],
  "settings keyboard set": ["thread.jump.1", "mod+1"],
  "settings ui get": ["sidebar.chronologicalSort"],
  "settings ui reset": ["sidebar.chronologicalSort"],
  "settings ui set": ["sidebar.chronologicalSort", "updated"],
  "terminal create": ["--thread", IDS.thread],
  "terminal list": ["--thread", IDS.thread],
  "terminal run": ["--thread", IDS.thread, "echo"],
  "terminal send": [IDS.terminal, "--text", "x"],
  "thread edit-message": [IDS.thread, "--message", "x"],
  "thread interactions respond": ["x", IDS.thread, "--value", "1"],
  "thread pane": ["maximize", IDS.thread],
  "thread spawn": ["--project", IDS.project, "--prompt", "x"],
  "thread update": [IDS.thread, "--title", "x"],
};

const COMMANDS_THAT_NEED_NO_SERVER = new Map([
  ["diagnostics cli-errors", "reads and edits the local CLI error log"],
  ["guide", "prints the guide built into the CLI"],
  [
    "machine enroll",
    "consumes a local bootstrap bundle before it calls the server",
  ],
  ["machine join-code", "retired; it only says which command replaced it"],
  ["plugin build", "compiles a local plugin directory"],
  ["plugin dev", "watches a local plugin directory before it calls the server"],
  ["plugin migrate", "rewrites a local plugin directory"],
  ["plugin types", "rewrites a local plugin directory's package.json"],
  [
    "server allow-connect",
    "edits a local data directory and says it does not call a server",
  ],
  ["server delete-old-copy", "deletes a local old server copy"],
  ["server import", "reads a local archive before it calls the server"],
  [
    "server install-machine-service",
    "installs a local service for a moved server's data directory",
  ],
  ["server unlock", "edits a local data directory"],
  ["settings mobile-app", "prints fixed app store links"],
  [
    "terminal attach term_aaaaaaaaaa",
    "without --json it needs an interactive terminal before it calls the server",
  ],
]);

const COMMANDS_THAT_PRINT_PARTIAL_RESULTS_ON_FAILURE = new Map([
  [
    "updates apply",
    "checks every machine and reports what it could check before failing",
  ],
]);

const COMMANDS_THAT_PRINT_DIAGNOSTICS_ON_FAILURE = new Map([
  ["status", "prints the local context it could resolve before failing"],
]);

const pluginVersion = (value: string) => ({
  version: value,
  label: value,
  display: value,
});

const installedPlugin = {
  id: IDS.plugin,
  source: "path:/tmp/x",
  rootDir: "/tmp/x",
  version: "1.0.0",
  provenance: "direct",
  isOrphanedBuiltin: false,
  catalogEntryId: IDS.plugin,
  publisherLabel: null,
  sourceDisplay: "path · /tmp/x",
  sourceNotice: null,
  updateState: {},
  enabled: true,
  description: null,
  name: null,
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

const marketplace = {
  name: "acme-plugins",
  displayName: "Acme Plugins",
  description: "Plugins the Acme team maintains.",
  official: false,
  enabled: true,
  canDisable: true,
  sourceKind: "https",
  source: "https://acme.test/marketplace.json",
  resolvedCommit: null,
  entryCount: 2,
  lastRefreshAt: 1,
  lastAttemptAt: 1,
  lastError: null,
};

const providerCliInstallJob = {
  id: "job_1",
  hostId: IDS.host,
  provider: "codex",
  actionKind: "install",
  startedAt: 1,
};

interface FailureBody {
  route: string;
  body: object;
}

const FAILURE_BODIES: readonly FailureBody[] = [
  {
    route: "POST /api/v1/marketplaces/refresh",
    body: {
      results: [
        { name: marketplace.name, ok: false, error: "HTTP 503", marketplace },
      ],
    },
  },
  {
    route: "POST /api/v1/system/cli-skills/install",
    body: {
      results: [
        {
          ok: false,
          hostId: IDS.host,
          hostName: "laptop",
          errorMessage: "disk full",
        },
      ],
    },
  },
  {
    route: "POST /api/v1/system/ai-services/test",
    body: { ok: false, message: "bad key", durationMs: 1 },
  },
  {
    route: "POST /api/v1/desktop-browsers/import-cookies",
    body: { ok: false, reason: "browserRunning" },
  },
  {
    route: "GET /api/v1/hosts/:id/provider-clis/install-jobs/:id",
    body: {
      job: {
        ...providerCliInstallJob,
        state: "completed",
        finishedAt: 2,
        events: [
          {
            type: "completed",
            provider: "codex",
            success: false,
            exitCode: 1,
            signal: null,
          },
        ],
      },
    },
  },
  {
    route: "POST /api/v1/plugins/:id/update",
    body: {
      applied: false,
      from: pluginVersion("1.0.0"),
      to: pluginVersion("1.1.0"),
      outcome: "rolled-back",
      detail: "activation failed; restored 1.0.0",
    },
  },
  {
    route: "POST /api/v1/plugins/install",
    body: {
      ok: true,
      plugin: {
        ...installedPlugin,
        status: "error",
        statusDetail: "server.js threw",
      },
    },
  },
  {
    route: "POST /api/v1/terminals/:id/close",
    body: { id: IDS.terminal, status: "running", lastUserInputAt: 1 },
  },
];

const host = {
  id: IDS.host,
  name: "laptop",
  type: "persistent",
  status: "connected",
  machineProviderId: "test-machine",
  lifecycle: {
    phase: "active",
    suspendedAt: null,
    message: null,
    pendingLog: "",
    teardown: null,
  },
  maxPermissionMode: "full",
  lastSeenAt: 1,
  route: null,
  lastRejectedProtocolVersion: null,
  createdAt: 1,
  updatedAt: 2,
};

const SUCCESS_BODIES: Record<string, unknown> = {
  "GET /api/v1/hosts": [host],
  "GET /api/v1/hosts/:id": host,
  "GET /api/v1/threads/:id": makeThread({
    id: IDS.thread,
    projectId: IDS.project,
    providerId: "codex",
  }),
  "GET /api/v1/environments/:id": makeEnvironment({
    id: IDS.environment,
    projectId: IDS.project,
    hostId: IDS.host,
  }),
  "GET /api/v1/system/config": { dataDir: "/tmp/bb", primaryHostId: IDS.host },
  "GET /api/v1/plugins": { plugins: [installedPlugin] },
  "POST /api/v1/plugins/updates/check": {
    results: [
      {
        id: IDS.plugin,
        outcome: "update-available",
        installed: pluginVersion("1.0.0"),
        candidate: pluginVersion("1.1.0"),
      },
    ],
  },
  "POST /api/v1/plugins/:id/update": {
    applied: true,
    from: pluginVersion("1.0.0"),
    to: pluginVersion("1.1.0"),
    outcome: "updated",
  },
  "POST /api/v1/plugins/install": { ok: true, plugin: installedPlugin },
  "POST /api/v1/hosts/:id/provider-clis/install-jobs": {
    job: { ...providerCliInstallJob, state: "running" },
  },
  "GET /api/v1/plugins/contributions": { cliCommands: [] },
};

function routeKey(method: string, url: string): string {
  const { pathname } = new URL(url);
  let path = pathname;
  for (const id of Object.values(IDS)) path = path.split(id).join(":id");
  path = path.replace(/\/(job|creq|qmsg|psrc)_[a-z0-9]+/gu, "/:id");
  return `${method.toUpperCase()} ${path}`;
}

function leafCommands(parent: Command, prefix: string[] = []) {
  return parent.commands.flatMap(
    (command): Array<{ path: string[]; command: Command }> => {
      const path = [...prefix, command.name()];
      return command.commands.length === 0
        ? [{ path, command }]
        : leafCommands(command, path);
    },
  );
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

function placeholderArgs(
  path: readonly string[],
  command: Command,
  json: boolean,
): string[] {
  const override = ARGUMENTS_BY_COMMAND[path.join(" ")];
  if (override !== undefined) return [...override, ...(json ? ["--json"] : [])];
  const groupId = ID_BY_GROUP[path[0] ?? ""] ?? "x";
  const args = command.registeredArguments.map((argument) =>
    argument.name() === "id"
      ? groupId
      : (PLACEHOLDER_BY_ARGUMENT[argument.name()] ?? "x"),
  );
  for (const option of command.options) {
    if (option.mandatory && option.long !== undefined) {
      args.push(option.long, PLACEHOLDER_BY_OPTION[option.long] ?? "x");
    }
    if (option.long === "--yes") args.push("--yes");
  }
  if (json) args.push("--json");
  return args;
}

interface Run {
  exitCode: number | "hung";
  requests: string[];
  stdoutAfterFailure: string;
  stderr: string;
}

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function run(
  argv: readonly string[],
  failAt: number | null,
): Promise<Run> {
  const program = await buildProgram();
  const requests: string[] = [];
  let failed = false;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const write = (text: string) => {
    if (failed) stdout.push(text);
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = routeKey(init?.method ?? "GET", url);
    const index = requests.length;
    requests.push(key);
    if (index === failAt) {
      failed = true;
      const failure = FAILURE_BODIES.find((entry) => entry.route === key);
      return failure === undefined
        ? respond(500, { code: "guard_failure", error: "The server failed" })
        : respond(200, failure.body);
    }
    if (key in SUCCESS_BODIES) return respond(200, SUCCESS_BODIES[key]);
    if (key.startsWith("GET ")) {
      return respond(404, { code: "not_found", error: "Not found" });
    }
    return respond(200, { ok: true, progress: "complete" });
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) =>
    write(parts.map(String).join(" ")),
  );
  vi.spyOn(console, "info").mockImplementation((...parts: unknown[]) =>
    write(parts.map(String).join(" ")),
  );
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    stderr.push(parts.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(
    (chunk: string | Uint8Array, ...rest: unknown[]) => {
      write(String(chunk));
      const callback = rest.find((value) => typeof value === "function");
      if (typeof callback === "function") callback();
      return true;
    },
  );
  vi.spyOn(process.stderr, "write").mockImplementation(
    (chunk: string | Uint8Array, ...rest: unknown[]) => {
      stderr.push(String(chunk));
      const callback = rest.find((value) => typeof value === "function");
      if (typeof callback === "function") callback();
      return true;
    },
  );
  vi.spyOn(process, "stdin", "get").mockReturnValue(
    Object.assign(Readable.from(["x"]), {
      fd: 0,
      isTTY: false,
    }) as unknown as typeof process.stdin,
  );
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit:${code ?? 0}`);
  });
  let exitCode: Run["exitCode"];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      program.parseAsync(["node", "bb", ...argv]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("guard:hung")),
          RUN_TIMEOUT_MS,
        );
      }),
    ]);
    exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exitCode =
      message === "guard:hung"
        ? "hung"
        : message.startsWith("process.exit:")
          ? Number(message.slice("process.exit:".length))
          : 1;
  } finally {
    clearTimeout(timer);
    process.exitCode = undefined;
    vi.restoreAllMocks();
  }
  return {
    exitCode,
    requests,
    stdoutAfterFailure: stdout.join("\n").trim(),
    stderr: stderr.join("\n"),
  };
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
const invocations = leafCommands(program).flatMap(({ path, command }) => {
  const supportsJson = command.options.some(
    (option) => option.long === "--json",
  );
  return (supportsJson ? [false, true] : [false]).map((json) => ({
    name: path.join(" "),
    argv: [...path, ...placeholderArgs(path, command, json)],
  }));
});

describe("every command against failing server responses", () => {
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
    vi.unstubAllEnvs();
  });

  it.each(invocations.map((entry) => [entry.argv.join(" "), entry] as const))(
    "bb %s fails at every failed request",
    async (_label, { name, argv }) => {
      vi.stubEnv("HOME", scratch);
      vi.stubEnv("BB_DATA_DIR", join(scratch, "data"));
      vi.stubEnv("BB_SERVER_URL", SERVER_URL);
      vi.stubEnv("BB_THREAD_ID", undefined);
      vi.stubEnv("BB_PROJECT_ID", undefined);
      vi.stubEnv("BB_ENVIRONMENT_ID", undefined);
      vi.stubEnv("BB_THREAD_STORAGE", undefined);
      vi.stubEnv("BB_CLI", undefined);
      vi.stubEnv("BB_CLI_REEXEC", undefined);

      const local =
        COMMANDS_THAT_NEED_NO_SERVER.has(name) ||
        COMMANDS_THAT_NEED_NO_SERVER.has(argv.join(" "));
      const recorded = await run(argv, null);
      if (recorded.requests.length === 0) {
        expect(
          local,
          `${name} made no request (${recorded.stderr.slice(0, 300)}); give it working placeholders or list why it needs no server`,
        ).toBe(true);
        return;
      }
      expect(
        local,
        `${name} is listed as needing no server but called it`,
      ).toBe(false);
      for (let index = 0; index < recorded.requests.length; index += 1) {
        const failing = await run(argv, index);
        const where = `${name}: request ${index} (${failing.requests[index]})`;
        expect(failing.exitCode, where).not.toBe(0);
        expect(failing.exitCode, where).not.toBe("hung");
        const failureBody = FAILURE_BODIES.some(
          (entry) => entry.route === failing.requests[index],
        );
        if (
          failing.stdoutAfterFailure !== "" &&
          !failureBody &&
          !COMMANDS_THAT_PRINT_DIAGNOSTICS_ON_FAILURE.has(name) &&
          !COMMANDS_THAT_PRINT_PARTIAL_RESULTS_ON_FAILURE.has(name)
        ) {
          expect(
            isErrorEnvelope(failing.stdoutAfterFailure),
            `${where} printed after the failure: ${failing.stdoutAfterFailure.slice(0, 200)}`,
          ).toBe(true);
        }
      }
    },
  );

  it("lists only real commands, each with a reason", () => {
    const names = new Set(
      invocations.flatMap((entry) => [entry.name, entry.argv.join(" ")]),
    );
    for (const [name, reason] of [
      ...COMMANDS_THAT_NEED_NO_SERVER,
      ...COMMANDS_THAT_PRINT_DIAGNOSTICS_ON_FAILURE,
      ...COMMANDS_THAT_PRINT_PARTIAL_RESULTS_ON_FAILURE,
    ]) {
      expect(names.has(name), name).toBe(true);
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
