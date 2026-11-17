import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBridgeJsonRpcTestHarness } from "../testing/bridge-json-rpc-test-helpers.js";
import type { BridgeJsonRpcObject } from "../testing/bridge-json-rpc-test-helpers.js";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock(
  "../../../../plugins/provider-claude-code/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs",
  () => ({
    query: queryMock,
    forkSession: vi.fn(),
    createSdkMcpServer: vi.fn(() => ({})),
    tool: vi.fn((_name, _description, _schema, handler) => handler),
  }),
);

const checkout = resolve(
  fileURLToPath(new URL("../../../..", import.meta.url)),
);
const RECORDER = fileURLToPath(
  new URL("./record-provider-cli-env.mjs", import.meta.url),
);
const FAKE_CODEX = join(
  checkout,
  "plugins/provider-codex/src/bridge/fake-codex-app-server.mjs",
);
const FAKE_PI = join(checkout, "plugins/provider-pi/src/bridge/fake-pi-rpc.mjs");
const FAKE_ACP = join(
  checkout,
  "packages/provider-bridge-acp/src/bridge/fake-acp-agent.mjs",
);

const FULL_PERMISSION_OPTIONS = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
} as const;

const bridgeModuleSchema = z.object({
  handleLine: z.function({ input: [z.string()], output: z.void() }),
});
const closeAllSchema = z.object({
  experimental_closeAllForTests: z.function({
    input: [],
    output: z.promise(z.void()),
  }),
});
const recordedLaunchSchema = z.object({
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
});
const claudeQueryOptionsSchema = z.object({
  options: z.object({
    env: z.record(z.string(), z.string().optional()),
    pathToClaudeCodeExecutable: z.string().optional(),
  }),
});

async function importModule(relativePath: string): Promise<unknown> {
  return import(pathToFileURL(join(checkout, relativePath)).href);
}

interface CaseContext {
  dir: string;
  logPath: string;
  fakeBinDir: string;
}

interface ProviderCliEnvCase {
  provider: string;
  bridgePath: string;
  configureBridge(ctx: CaseContext, recording: boolean): void;
  initialize: boolean;
  threadStart(
    ctx: CaseContext,
    envVars: Record<string, string>,
  ): BridgeJsonRpcObject;
  modelList(
    ctx: CaseContext,
    envVars: Record<string, string>,
  ): BridgeJsonRpcObject;
  launchFromThreadEnv: ((ctx: CaseContext) => Record<string, string>) | null;
  launchedByThreadEnv(
    ctx: CaseContext,
    launch: z.infer<typeof recordedLaunchSchema>,
  ): boolean;
  cliLaunches(ctx: CaseContext): z.infer<typeof recordedLaunchSchema>[];
  probeEnv(ctx: CaseContext): Record<string, string>;
  probeParams(ctx: CaseContext): BridgeJsonRpcObject;
  cleanup(
    send: (method: string, params: BridgeJsonRpcObject) => Promise<void>,
  ): Promise<void>;
}

function recordedLaunches(
  ctx: CaseContext,
): z.infer<typeof recordedLaunchSchema>[] {
  if (!existsSync(ctx.logPath)) return [];
  return readFileSync(ctx.logPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => recordedLaunchSchema.parse(JSON.parse(line)));
}

function codexLaunch(
  ctx: CaseContext,
  recording: boolean,
): Record<string, string> {
  const scriptPath = join(ctx.dir, "codex-script.json");
  writeFileSync(scriptPath, JSON.stringify({}));
  return {
    BB_CODEX_BRIDGE_APP_SERVER_COMMAND: process.execPath,
    BB_CODEX_BRIDGE_APP_SERVER_ARGS: JSON.stringify(
      recording
        ? [RECORDER, ctx.logPath, FAKE_CODEX, scriptPath]
        : [FAKE_CODEX, scriptPath],
    ),
  };
}

function piLaunch(ctx: CaseContext, recording: boolean): Record<string, string> {
  return {
    BB_PI_BRIDGE_COMMAND: process.execPath,
    BB_PI_BRIDGE_ARGS: JSON.stringify(
      recording ? [RECORDER, ctx.logPath, FAKE_PI] : [FAKE_PI],
    ),
  };
}

function stubEnv(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

const PROBED_VERSION = "9.9.9";

function fakeCli(ctx: CaseContext, name: string, output: string): string {
  const executable = join(ctx.fakeBinDir, name);
  writeFileSync(executable, `#!/bin/sh\necho "${output}"\n`);
  chmodSync(executable, 0o755);
  return executable;
}

function pathWithFakeBin(ctx: CaseContext): string {
  return [ctx.fakeBinDir, process.env.PATH ?? ""].join(delimiter);
}

const CLAUDE_FAKE_SESSION_ID = "00000000-0000-4000-8000-0000000000aa";

function claudeLaunches(): z.infer<typeof recordedLaunchSchema>[] {
  return queryMock.mock.calls.map((call: unknown[]) => {
    const { options } = claudeQueryOptionsSchema.parse(call[0]);
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env)) {
      if (value !== undefined) env[name] = value;
    }
    return {
      args:
        options.pathToClaudeCodeExecutable === undefined
          ? []
          : [options.pathToClaudeCodeExecutable],
      env,
    };
  });
}

function idleClaudeQuery() {
  return {
    initializationResult: async () => ({ models: [] }),
    supportedModels: async () => [],
    getContextUsage: async () => null,
    applyFlagSettings: async () => undefined,
    setModel: async () => undefined,
    setPermissionMode: async () => undefined,
    interrupt: async () => undefined,
    close: () => {},
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise<IteratorResult<Record<string, unknown>>>(() => {}),
        return: async () => ({ value: undefined, done: true as const }),
      };
    },
  };
}

function acpLaunchSpec(ctx: CaseContext, modelList: boolean) {
  const args = [RECORDER, ctx.logPath, FAKE_ACP];
  return {
    acpLaunchSpec: {
      displayName: "Fake ACP",
      command: process.execPath,
      args,
      env: {},
      ...(modelList
        ? { modelCli: { listArgs: [...args, "--list-models"], primaryModels: [] } }
        : {}),
    },
  };
}

const cases: ProviderCliEnvCase[] = [
  {
    provider: "codex",
    bridgePath: "plugins/provider-codex/src/bridge/bridge.ts",
    initialize: false,
    configureBridge: (ctx, recording) => stubEnv(codexLaunch(ctx, recording)),
    threadStart: (ctx, envVars) => ({
      threadId: "thr_cli_env_contract",
      cwd: ctx.dir,
      instructionMode: "append",
      options: { ...FULL_PERMISSION_OPTIONS, envVars },
    }),
    modelList: (ctx, envVars) => ({ cwd: ctx.dir, envVars }),
    launchFromThreadEnv: (ctx) => codexLaunch(ctx, true),
    launchedByThreadEnv: () => true,
    cliLaunches: recordedLaunches,
    probeEnv: (ctx) => {
      fakeCli(ctx, "codex", `codex-cli ${PROBED_VERSION}`);
      return { PATH: pathWithFakeBin(ctx) };
    },
    probeParams: () => ({}),
    cleanup: (send) =>
      send("thread/stop", {
        threadId: "thr_cli_env_contract",
        providerThreadId: "cleanup",
        intent: "release",
        activeTurnId: null,
      }),
  },
  {
    provider: "claude-code",
    bridgePath: "plugins/provider-claude-code/src/bridge/bridge.ts",
    initialize: false,
    configureBridge: () => {
      queryMock.mockReset();
      queryMock.mockImplementation(() => idleClaudeQuery());
    },
    threadStart: (ctx, envVars) => ({
      threadId: CLAUDE_FAKE_SESSION_ID,
      cwd: ctx.dir,
      instructionMode: "append",
      options: { ...FULL_PERMISSION_OPTIONS, envVars },
    }),
    modelList: (ctx, envVars) => ({ cwd: ctx.dir, envVars }),
    launchFromThreadEnv: (ctx) => {
      const executable = join(ctx.fakeBinDir, "claude");
      writeFileSync(executable, "#!/bin/sh\nexit 0\n");
      chmodSync(executable, 0o755);
      return { BB_CLAUDE_CODE_EXECUTABLE: executable };
    },
    launchedByThreadEnv: (ctx, launch) =>
      launch.args[0] === join(ctx.fakeBinDir, "claude"),
    cliLaunches: () => claudeLaunches(),
    probeEnv: (ctx) => ({
      BB_CLAUDE_CODE_EXECUTABLE: fakeCli(
        ctx,
        "claude-probe",
        `${PROBED_VERSION} (Claude Code)`,
      ),
    }),
    probeParams: () => ({}),
    cleanup: (send) =>
      send("thread/stop", {
        threadId: CLAUDE_FAKE_SESSION_ID,
        providerThreadId: CLAUDE_FAKE_SESSION_ID,
        intent: "release",
        activeTurnId: null,
      }),
  },
  {
    provider: "pi",
    bridgePath: "plugins/provider-pi/src/bridge/bridge.ts",
    initialize: true,
    configureBridge: (ctx, recording) => {
      stubEnv(piLaunch(ctx, recording));
      vi.stubEnv("BB_PI_BRIDGE_SESSION_DIR", join(ctx.dir, "sessions"));
    },
    threadStart: (ctx, envVars) => ({
      threadId: "thr_cli_env_contract",
      cwd: ctx.dir,
      instructionMode: "append",
      options: { ...FULL_PERMISSION_OPTIONS, envVars },
    }),
    modelList: (ctx, envVars) => ({ cwd: ctx.dir, envVars }),
    launchFromThreadEnv: (ctx) => piLaunch(ctx, true),
    launchedByThreadEnv: () => true,
    cliLaunches: (ctx) =>
      recordedLaunches(ctx).filter((launch) => !launch.args.includes("--version")),
    probeEnv: () => ({ FAKE_PI_VERSION: PROBED_VERSION }),
    probeParams: () => ({}),
    cleanup: async () => {
      await closeAllSchema
        .parse(await importModule("plugins/provider-pi/src/bridge/bridge.ts"))
        .experimental_closeAllForTests();
    },
  },
  {
    provider: "acp",
    bridgePath: "packages/provider-bridge-acp/src/bridge/bridge.ts",
    initialize: false,
    configureBridge: () => {},
    threadStart: (ctx, envVars) => ({
      threadId: "thr_cli_env_contract",
      cwd: ctx.dir,
      instructionMode: "append",
      options: {
        ...FULL_PERMISSION_OPTIONS,
        envVars,
        providerOptions: acpLaunchSpec(ctx, false),
      },
    }),
    modelList: (ctx, envVars) => ({
      cwd: ctx.dir,
      envVars,
      providerOptions: acpLaunchSpec(ctx, true),
    }),
    launchFromThreadEnv: null,
    launchedByThreadEnv: () => true,
    cliLaunches: recordedLaunches,
    probeEnv: (ctx) => {
      fakeCli(ctx, "fake-acp-cli", `fake-acp ${PROBED_VERSION}`);
      return { PATH: pathWithFakeBin(ctx) };
    },
    probeParams: () => ({
      providerOptions: {
        acpLaunchSpec: {
          displayName: "Fake ACP",
          command: "fake-acp-cli",
          args: [],
          env: {},
        },
      },
    }),
    cleanup: async () => {},
  },
];

function threadEnv(ctx: CaseContext): Record<string, string> {
  return {
    BB_THREAD_ID: "thr_cli_env_contract",
    BB_THREAD_STORAGE: join(ctx.dir, "thread-storage"),
    BB_PROJECT_ID: "proj_cli_env_contract",
    BB_ENVIRONMENT_ID: "env_cli_env_contract",
    BB_CONTRIBUTED_SETTING: "contributed-bb-value",
    CONTRIBUTED_SETTING: "contributed-value",
    PATH: [ctx.fakeBinDir, process.env.PATH ?? ""].join(delimiter),
  };
}

function expectCliReceived(
  launches: z.infer<typeof recordedLaunchSchema>[],
  envVars: Record<string, string>,
): void {
  expect(launches.length).toBeGreaterThan(0);
  const { PATH: path, ...expected } = envVars;
  for (const launch of launches) {
    const received = Object.fromEntries(
      Object.keys(expected).map((name) => [name, launch.env[name]]),
    );
    expect(received).toEqual(expected);
    if (path !== undefined) {
      const paths = Object.entries(launch.env).filter(
        ([name]) => name.toUpperCase() === "PATH",
      );
      expect(paths).toHaveLength(1);
      expect(paths[0]?.[1].split(delimiter)[0]).toBe(path.split(delimiter)[0]);
    }
    expect(launch.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  }
}

describe.each(cases)("provider CLI env contract: $provider", (testCase) => {
  let ctx: CaseContext;
  let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
  let nextId = 100;

  async function send(method: string, params: BridgeJsonRpcObject) {
    const id = ++nextId;
    harness.sendRequest(id, method, params);
    const response = await harness.waitForResponse(id);
    await harness.flushWork();
    return response;
  }

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), `bb-cli-env-${testCase.provider}-`));
    ctx = {
      dir,
      logPath: join(dir, "launches.jsonl"),
      fakeBinDir: mkdtempSync(join(dir, "bin-")),
    };
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    testCase.configureBridge(ctx, true);
    const bridge = bridgeModuleSchema.parse(
      await importModule(testCase.bridgePath),
    );
    harness = createBridgeJsonRpcTestHarness(bridge.handleLine);
    if (testCase.initialize) {
      await send("initialize", {
        protocolVersion: 2,
        client: { name: "test", version: "0" },
        grammarVersions: [3, 3],
      });
    }
  });

  afterEach(async () => {
    await testCase.cleanup(async (method, params) => {
      await send(method, params);
    });
    harness.restore();
    vi.unstubAllEnvs();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("thread CLI receives every thread env var", async () => {
    const envVars = threadEnv(ctx);
    await send("thread/start", testCase.threadStart(ctx, envVars));
    await vi.waitFor(() =>
      expect(testCase.cliLaunches(ctx).length).toBeGreaterThan(0),
    );
    expectCliReceived(testCase.cliLaunches(ctx), envVars);
  }, 30_000);

  it("model-list CLI receives the contributed env", async () => {
    const envVars = {
      BB_CONTRIBUTED_SETTING: "contributed-bb-value",
      CONTRIBUTED_SETTING: "contributed-value",
    };
    await send("model/list", testCase.modelList(ctx, envVars));
    await vi.waitFor(() =>
      expect(testCase.cliLaunches(ctx).length).toBeGreaterThan(0),
    );
    expectCliReceived(testCase.cliLaunches(ctx), envVars);
  }, 30_000);

  it.skipIf(testCase.launchFromThreadEnv === null)(
    "launch settings come from the thread env",
    async () => {
      testCase.configureBridge(ctx, false);
      const envVars = {
        ...threadEnv(ctx),
        ...(testCase.launchFromThreadEnv?.(ctx) ?? {}),
      };
      await send("thread/start", testCase.threadStart(ctx, envVars));
      await vi.waitFor(() =>
        expect(testCase.cliLaunches(ctx).length).toBeGreaterThan(0),
      );
      const launches = testCase.cliLaunches(ctx);
      expectCliReceived(launches, envVars);
      for (const launch of launches) {
        expect(testCase.launchedByThreadEnv(ctx, launch)).toBe(true);
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "installation status and health probe the CLI the contributed env selects",
    async () => {
      const params = {
        providerId: testCase.provider,
        envVars: testCase.probeEnv(ctx),
        ...testCase.probeParams(ctx),
      };
      const status = await send("provider/installation/status", {
        ...params,
        checkUpdates: false,
      });
      expect(status.result).toMatchObject({
        installed: true,
        currentVersion: PROBED_VERSION,
      });
      const health = await send("provider/health", params);
      expect(health.result).toMatchObject({
        supported: true,
        health: { installedVersion: PROBED_VERSION },
      });
    },
    30_000,
  );
});
