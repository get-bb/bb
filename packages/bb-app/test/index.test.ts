import { spawn } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createHostEnrollKeyRequestBody,
  isMainModule,
  parseLauncherArgs,
  resolveBbAppRuntimeContext,
  resolveBbAppRuntimeState,
  resolveDataDir,
  resolvePort,
  resolveBbAppStartContext,
  resolveBbAppCommand,
  runBbApp,
} from "../src/index.js";
import {
  completeFullStackSupervision,
  readBbAppPackageVersion,
  superviseFullStackProcesses,
  terminateManagedFullStackProcesses,
  waitForProcessExit,
} from "../src/launcher.js";
import type { BbAppStartContext } from "../src/index.js";
import type {
  DelayMillisecondsArgs,
  DelayMillisecondsFn,
  FullStackSupervisionResult,
  ManagedFullStackProcesses,
  ManagedProcessName,
  ManagedProcessRun,
  NamedProcessExitResult,
  ProcessExitResult,
} from "../src/launcher.js";

interface DelayArgs {
  ms: number;
}

interface ControlledDelayCall {
  ms: number;
  resolve(): void;
}

interface ConfigReloadTestServer {
  close(): Promise<void>;
  port: number;
  reloadCount(): number;
  reloadRequests(): ConfigReloadRequest[];
  url: string;
}

interface ConfigReloadRequest {
  host: string | undefined;
  method: string | undefined;
  url: string | undefined;
}

interface InvalidConfigCommandCase {
  expectedError: RegExp;
  key: string;
  value: string;
}

type DelayResult = "timeout";
type ResolveFakeManagedProcessExit = (result: NamedProcessExitResult) => void;
type StartFakeManagedProcess = () => Promise<ManagedProcessRun>;

interface FakeManagedProcessRunArgs {
  id: string;
  processName: ManagedProcessName;
}

interface WaitForProcessReplacementArgs {
  currentRun: () => ManagedProcessRun | null;
  previousRun: ManagedProcessRun;
}

interface WaitForDelayCallArgs {
  delay: ControlledDelay;
  index: number;
}

interface FakeSupervisor {
  daemonRuns: FakeManagedProcessRun[];
  daemonStart: StartFakeManagedProcess;
  processes: ManagedFullStackProcesses;
  serverRuns: FakeManagedProcessRun[];
  serverStart: StartFakeManagedProcess;
  setShutdownRequested(value: boolean): void;
  shutdownRequested(): boolean;
}

const invalidConfigCommandCases: InvalidConfigCommandCase[] = [
  {
    expectedError: /BB_INFERENCE must use provider\/model format/u,
    key: "BB_INFERENCE",
    value: "gpt-4o-mini",
  },
  {
    expectedError: /BB_TRANSCRIPTION must use provider\/model format/u,
    key: "BB_TRANSCRIPTION",
    value: "gpt-4o-mini-transcribe",
  },
  {
    expectedError: /BB_APP_URL must be a valid URL/u,
    key: "BB_APP_URL",
    value: "not-a-url",
  },
  {
    expectedError: /BB_SERVER_URL must be a valid URL/u,
    key: "BB_SERVER_URL",
    value: "not-a-url",
  },
  {
    expectedError: /BB_LOG_LEVEL must be one of/u,
    key: "BB_LOG_LEVEL",
    value: "bogus",
  },
];

const packageMetadataSchema = z.object({
  engines: z.object({
    node: z.string(),
  }),
  os: z.array(z.string()),
});

type PackageMetadata = z.infer<typeof packageMetadataSchema>;

class FakeManagedProcessRun implements ManagedProcessRun {
  readonly exit: Promise<NamedProcessExitResult>;
  readonly id: string;
  readonly processName: ManagedProcessName;
  readonly terminationSignals: NodeJS.Signals[] = [];
  running = true;
  private resolveExit: ResolveFakeManagedProcessExit = () => undefined;

  constructor(args: FakeManagedProcessRunArgs) {
    this.id = args.id;
    this.processName = args.processName;
    this.exit = new Promise<NamedProcessExitResult>((resolvePromise) => {
      this.resolveExit = resolvePromise;
    });
  }

  exitWith(result: ProcessExitResult): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.resolveExit({ processName: this.processName, result });
  }

  async terminate(signal: NodeJS.Signals): Promise<void> {
    this.terminationSignals.push(signal);
    this.exitWith({ code: null, signal });
  }
}

class ControlledDelay {
  readonly calls: ControlledDelayCall[] = [];

  async delayMilliseconds(args: DelayMillisecondsArgs): Promise<void> {
    await new Promise<void>((resolvePromise) => {
      this.calls.push({
        ms: args.ms,
        resolve: resolvePromise,
      });
    });
  }
}

function delay(args: DelayArgs): Promise<DelayResult> {
  return new Promise((resolvePromise) => {
    setTimeout(() => {
      resolvePromise("timeout");
    }, args.ms);
  });
}

const immediateDelay: DelayMillisecondsFn = () => {
  return Promise.resolve();
};

function createTestStartContext(): BbAppStartContext {
  return {
    appDistDir: "/tmp/bb-app-test/app/dist",
    appVersion: "0.0.0-test",
    configFile: "/tmp/bb-app-test/config.json",
    daemonBundleDir: "/tmp/bb-app-test/host-daemon/dist",
    daemonEntry: "/tmp/bb-app-test/host-daemon/dist/daemon-bundle.mjs",
    daemonLockDir: "/tmp/bb-app-test/daemon.lock.lock",
    daemonLockFile: "/tmp/bb-app-test/daemon.lock",
    daemonPort: 38887,
    dataDir: "/tmp/bb-app-test",
    dbPath: "/tmp/bb-app-test/bb.db",
    envFile: "/tmp/bb-app-test/env.json",
    logDir: "/tmp/bb-app-test/logs",
    packageRoot: "/tmp/bb-app-test/package",
    serverEntry: "/tmp/bb-app-test/server/dist/index.js",
    serverPort: 38886,
    serverUrl: "http://127.0.0.1:38886",
  };
}

function createFakeSupervisor(): FakeSupervisor {
  let shutdownRequested = false;
  const serverRuns = [
    new FakeManagedProcessRun({ id: "server-1", processName: "server" }),
  ];
  const daemonRuns = [
    new FakeManagedProcessRun({ id: "daemon-1", processName: "daemon" }),
  ];
  const processes: ManagedFullStackProcesses = {
    daemonRun: daemonRuns[0],
    serverRun: serverRuns[0],
  };
  const serverStart = async (): Promise<ManagedProcessRun> => {
    const run = new FakeManagedProcessRun({
      id: `server-${serverRuns.length + 1}`,
      processName: "server",
    });
    serverRuns.push(run);
    processes.serverRun = run;
    return run;
  };
  const daemonStart = async (): Promise<ManagedProcessRun> => {
    const run = new FakeManagedProcessRun({
      id: `daemon-${daemonRuns.length + 1}`,
      processName: "daemon",
    });
    daemonRuns.push(run);
    processes.daemonRun = run;
    return run;
  };
  return {
    daemonRuns,
    daemonStart,
    processes,
    serverRuns,
    serverStart,
    setShutdownRequested(value) {
      shutdownRequested = value;
    },
    shutdownRequested() {
      return shutdownRequested;
    },
  };
}

async function waitForProcessReplacement(
  args: WaitForProcessReplacementArgs,
): Promise<ManagedProcessRun> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const currentRun = args.currentRun();
    if (currentRun !== null && currentRun !== args.previousRun) {
      return currentRun;
    }
    await delay({ ms: 1 });
  }
  throw new Error("Timed out waiting for process replacement");
}

async function waitForDelayCall(
  args: WaitForDelayCallArgs,
): Promise<ControlledDelayCall> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const call = args.delay.calls[args.index];
    if (call !== undefined) {
      return call;
    }
    await delay({ ms: 1 });
  }
  throw new Error("Timed out waiting for restart throttle delay");
}

async function stopFakeSupervisor(
  supervisor: FakeSupervisor,
  supervision: Promise<FullStackSupervisionResult>,
): Promise<FullStackSupervisionResult> {
  supervisor.setShutdownRequested(true);
  await terminateManagedFullStackProcesses({
    processes: supervisor.processes,
    signal: "SIGTERM",
  });
  return supervision;
}

async function startConfigReloadTestServer(): Promise<ConfigReloadTestServer> {
  const reloadRequests: ConfigReloadRequest[] = [];
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      if (
        request.method === "POST" &&
        request.url === "/api/v1/system/config/reload"
      ) {
        reloadRequests.push({
          host: request.headers.host,
          method: request.method,
          url: request.url,
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: "not_found", message: "Not found" }));
    },
  );

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolvePromise();
    });
  });

  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("Expected test server to listen on a TCP port");
  }
  const addressInfo: AddressInfo = address;

  return {
    async close(): Promise<void> {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      });
    },
    port: addressInfo.port,
    reloadCount(): number {
      return reloadRequests.length;
    },
    reloadRequests(): ConfigReloadRequest[] {
      return [...reloadRequests];
    },
    url: `http://127.0.0.1:${addressInfo.port}`,
  };
}

function readPackageMetadata(): PackageMetadata {
  const testDir = dirname(fileURLToPath(import.meta.url));
  return packageMetadataSchema.parse(
    JSON.parse(readFileSync(resolve(testDir, "..", "package.json"), "utf8")),
  );
}

function expectedConfigReloadRequest(
  server: ConfigReloadTestServer,
): ConfigReloadRequest {
  return {
    host: `127.0.0.1:${server.port}`,
    method: "POST",
    url: "/api/v1/system/config/reload",
  };
}

describe("bb-app launcher", () => {
  it("resolves production defaults for npx startup", () => {
    const context = resolveBbAppStartContext({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: {},
      homeDir: "/home/tester",
    });

    expect(context.dataDir).toBe("/home/tester/.bb");
    expect(context.configFile).toBe("/home/tester/.bb/config.json");
    expect(context.envFile).toBe("/home/tester/.bb/env.json");
    expect(context.serverPort).toBe(38886);
    expect(context.daemonPort).toBe(38887);
    expect(context.serverUrl).toBe("http://127.0.0.1:38886");
    expect(context.serverEntry).toBe(
      "/repo/packages/bb-app/server/dist/index.js",
    );
    expect(context.daemonEntry).toBe(
      "/repo/packages/bb-app/host-daemon/dist/daemon-bundle.mjs",
    );
    expect(context.appVersion).toBe("0.0.0-dev");
  });

  it("reads appVersion from the package.json next to the resolved package root", () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const expectedVersion = z
      .object({ version: z.string() })
      .parse(
        JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")),
      ).version;
    expect(readBbAppPackageVersion(packageRoot)).toBe(expectedVersion);
  });

  it("falls back to the dev sentinel when package.json is missing", () => {
    expect(readBbAppPackageVersion("/nonexistent/bb-app/path")).toBe(
      "0.0.0-dev",
    );
  });

  it("honors explicit production ports and data directory", () => {
    const env = {
      BB_DATA_DIR: "~/custom-bb",
      BB_HOST_DAEMON_PORT: "48887",
      BB_SERVER_PORT: "48886",
    };

    expect(resolveDataDir({ env, homeDir: "/home/tester" })).toBe(
      "/home/tester/custom-bb",
    );
    expect(resolvePort({ defaultPort: 1, env, name: "BB_SERVER_PORT" })).toBe(
      48886,
    );
    expect(
      resolvePort({ defaultPort: 1, env, name: "BB_HOST_DAEMON_PORT" }),
    ).toBe(48887);
  });

  it("creates host enroll-key request bodies", () => {
    expect(createHostEnrollKeyRequestBody({ requestedHostId: null })).toEqual(
      {},
    );
    expect(
      createHostEnrollKeyRequestBody({
        requestedHostId: "host_local",
      }),
    ).toEqual({
      hostId: "host_local",
    });
  });

  it("starts bb when no command or the explicit start command is provided", () => {
    expect(resolveBbAppCommand([])).toEqual({ kind: "start" });
    expect(resolveBbAppCommand(["start"])).toEqual({ kind: "start" });
  });

  it("keeps CLI commands on the bb binary", () => {
    expect(resolveBbAppCommand(["status"])).toEqual({
      command: "status",
      kind: "invalid",
    });
    expect(resolveBbAppCommand(["thread", "list"])).toEqual({
      command: "thread",
      kind: "invalid",
    });
  });

  it("starts only the host daemon for the explicit host-daemon start command", () => {
    expect(resolveBbAppCommand(["host-daemon"])).toEqual({
      args: [],
      kind: "host-daemon",
    });
    expect(resolveBbAppCommand(["host-daemon", "join"])).toEqual({
      args: ["join"],
      kind: "host-daemon",
    });
  });

  it("resolves config commands", () => {
    expect(
      resolveBbAppCommand(["config", "set", "BB_APP_URL", "https://bb.test"]),
    ).toEqual({
      args: ["set", "BB_APP_URL", "https://bb.test"],
      kind: "config",
    });
  });

  it("resolves env commands", () => {
    expect(
      resolveBbAppCommand(["env", "set", "OPENAI_API_KEY", "test-key"]),
    ).toEqual({
      args: ["set", "OPENAI_API_KEY", "test-key"],
      kind: "env",
    });
  });

  it("prints help for help requests", () => {
    expect(resolveBbAppCommand(["--help"])).toEqual({ kind: "help" });
    expect(resolveBbAppCommand(["help"])).toEqual({ kind: "help" });
  });

  it("parses launcher flags separately from commands", () => {
    expect(
      parseLauncherArgs([
        "host-daemon",
        "join",
        "--data-dir",
        "~/bb-data",
        "--server-url",
        "https://bb.example.test",
        "--host-daemon-port",
        "48887",
        "--host-type",
        "persistent",
      ]),
    ).toEqual({
      options: {
        dataDir: "~/bb-data",
        help: false,
        hostDaemonPort: "48887",
        hostType: "persistent",
        serverUrl: "https://bb.example.test",
      },
      positionals: ["host-daemon", "join"],
    });
  });

  it("uses managed config server URL when env and flags omit it", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ serverUrl: "https://bb.example.test" }),
      "utf8",
    );

    const context = await resolveBbAppRuntimeContext({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: { BB_DATA_DIR: dataDir },
      homeDir: "/home/tester",
      options: { help: false },
      serverUrlMode: "managed",
    });

    expect(context.serverUrl).toBe("https://bb.example.test");
  });

  it("uses managed config server URL over ambient env", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-server-config-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ serverUrl: "https://stored.example.test" }),
      "utf8",
    );

    const runtime = await resolveBbAppRuntimeState({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: {
        BB_DATA_DIR: dataDir,
        BB_SERVER_URL: "https://ambient.example.test",
      },
      homeDir: "/home/tester",
      options: { help: false },
      serverUrlMode: "managed",
    });

    expect(runtime.context.serverUrl).toBe("https://stored.example.test");
    expect(runtime.env.BB_SERVER_URL).toBe("https://stored.example.test");
  });

  it("keeps full-stack startup local even when managed config has a server URL", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-local-config-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ serverUrl: "https://bb.example.test" }),
      "utf8",
    );

    const context = await resolveBbAppRuntimeContext({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: { BB_DATA_DIR: dataDir },
      homeDir: "/home/tester",
      options: { help: false },
      serverUrlMode: "local",
    });

    expect(context.serverUrl).toBe("http://127.0.0.1:38886");
  });

  it("applies managed config environment values over ambient env", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-env-config-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({
        config: {
          BB_APP_URL: "https://bb.example.test",
          BB_LOG_LEVEL: "debug",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(dataDir, "env.json"),
      JSON.stringify({
        env: {
          OPENAI_API_KEY: "stored-openai-key",
        },
      }),
      "utf8",
    );

    const runtime = await resolveBbAppRuntimeState({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: { BB_DATA_DIR: dataDir, OPENAI_API_KEY: "ambient-openai-key" },
      homeDir: "/home/tester",
      options: { help: false },
      serverUrlMode: "local",
    });

    expect(runtime.env.BB_APP_URL).toBe("https://bb.example.test");
    expect(runtime.env.BB_LOG_LEVEL).toBe("debug");
    expect(runtime.env.OPENAI_API_KEY).toBe("stored-openai-key");
    expect(runtime.serverEnv.BB_LOG_LEVEL).toBe("debug");
    expect(runtime.serverEnv.OPENAI_API_KEY).toBe("stored-openai-key");
  });

  it("uses launcher flags over managed config and ambient server URL", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-flag-config-"));
    writeFileSync(
      join(dataDir, "config.json"),
      JSON.stringify({ serverUrl: "https://stored.example.test" }),
      "utf8",
    );

    const runtime = await resolveBbAppRuntimeState({
      entrypointUrl: pathToFileURL("/repo/packages/bb-app/dist/bb-app.js").href,
      env: {
        BB_DATA_DIR: dataDir,
        BB_SERVER_URL: "https://ambient.example.test",
      },
      homeDir: "/home/tester",
      options: {
        help: false,
        serverUrl: "https://flag.example.test",
      },
      serverUrlMode: "managed",
    });

    expect(runtime.context.serverUrl).toBe("https://flag.example.test");
    expect(runtime.env.BB_SERVER_URL).toBe("https://flag.example.test");
  });

  it("stores managed config values from the config command", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-command-"));

    await runBbApp([
      "--data-dir",
      dataDir,
      "config",
      "set",
      "BB_APP_URL",
      "https://bb.example.test",
    ]);
    await runBbApp([
      "--data-dir",
      dataDir,
      "config",
      "set",
      "BB_INFERENCE",
      "anthropic/claude-sonnet-4-5",
    ]);
    await runBbApp([
      "--data-dir",
      dataDir,
      "env",
      "set",
      "OPENAI_API_KEY",
      "test-openai-key",
    ]);

    expect(
      JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: {
        BB_APP_URL: "https://bb.example.test",
        BB_INFERENCE: "anthropic/claude-sonnet-4-5",
      },
    });
    expect(JSON.parse(readFileSync(join(dataDir, "env.json"), "utf8"))).toEqual(
      {
        env: {
          OPENAI_API_KEY: "test-openai-key",
        },
      },
    );
    expect(statSync(join(dataDir, "config.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dataDir, "env.json")).mode & 0o777).toBe(0o600);
  });

  it("preserves customModels across managed config writes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-custom-"));
    const customModels = [
      {
        providerId: "claude-code",
        model: "claude-example-preview[1m]",
        displayName: "Example Preview (1M)",
      },
    ];
    writeFileSync(
      join(dataDir, "config.json"),
      `${JSON.stringify({ customModels })}\n`,
      "utf8",
    );

    await runBbApp([
      "--data-dir",
      dataDir,
      "config",
      "set",
      "BB_APP_URL",
      "https://bb.example.test",
    ]);

    expect(
      JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")),
    ).toEqual({
      config: {
        BB_APP_URL: "https://bb.example.test",
      },
      customModels,
    });
  });

  it("keeps secrets out of the config command", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-secret-config-"));

    await expect(
      runBbApp([
        "--data-dir",
        dataDir,
        "config",
        "set",
        "OPENAI_API_KEY",
        "test-openai-key",
      ]),
    ).rejects.toThrow(/bb-app env set OPENAI_API_KEY/u);
  });

  it("stores managed env values from the env command", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-env-command-"));

    await runBbApp([
      "--data-dir",
      dataDir,
      "env",
      "set",
      "ANTHROPIC_API_KEY",
      "test-anthropic-key",
    ]);

    expect(JSON.parse(readFileSync(join(dataDir, "env.json"), "utf8"))).toEqual(
      {
        env: {
          ANTHROPIC_API_KEY: "test-anthropic-key",
        },
      },
    );
    expect(statSync(join(dataDir, "env.json")).mode & 0o777).toBe(0o600);
  });

  it("rejects invalid env key names", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-invalid-env-"));

    await expect(
      runBbApp(["--data-dir", dataDir, "env", "set", "1BAD", "value"]),
    ).rejects.toThrow(/Invalid env key/u);
  });

  it("unsets managed env values", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-env-unset-"));
    writeFileSync(
      join(dataDir, "env.json"),
      JSON.stringify({
        env: {
          OPENAI_API_KEY: "test-openai-key",
        },
      }),
      "utf8",
    );

    await runBbApp(["--data-dir", dataDir, "env", "unset", "OPENAI_API_KEY"]);

    expect(JSON.parse(readFileSync(join(dataDir, "env.json"), "utf8"))).toEqual(
      {},
    );
  });

  it("rejects invalid managed config values before writing or reloading", async () => {
    const server = await startConfigReloadTestServer();
    try {
      for (const testCase of invalidConfigCommandCases) {
        const dataDir = mkdtempSync(join(tmpdir(), "bb-app-invalid-config-"));
        const configPath = join(dataDir, "config.json");
        const initialConfig = {
          config: {
            BB_APP_URL: "https://existing.example.test",
          },
        };
        writeFileSync(
          configPath,
          `${JSON.stringify(initialConfig, null, 2)}\n`,
          "utf8",
        );

        await expect(
          runBbApp([
            "--data-dir",
            dataDir,
            "--server-port",
            String(server.port),
            "config",
            "set",
            testCase.key,
            testCase.value,
          ]),
        ).rejects.toThrow(testCase.expectedError);

        expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual(
          initialConfig,
        );
      }

      expect(server.reloadCount()).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("asks a running local server to reload after config writes", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-reload-"));
    const server = await startConfigReloadTestServer();

    try {
      await runBbApp([
        "--data-dir",
        dataDir,
        "--server-port",
        String(server.port),
        "config",
        "set",
        "BB_APP_URL",
        "https://bb.example.test",
      ]);

      expect(server.reloadRequests()).toEqual([
        expectedConfigReloadRequest(server),
      ]);
    } finally {
      await server.close();
    }
  });

  it("supports explicitly refreshing running server config", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-refresh-"));
    const server = await startConfigReloadTestServer();

    try {
      await runBbApp([
        "--data-dir",
        dataDir,
        "--server-port",
        String(server.port),
        "config",
        "refresh",
      ]);

      expect(server.reloadRequests()).toEqual([
        expectedConfigReloadRequest(server),
      ]);
    } finally {
      await server.close();
    }
  });

  it("uses BB_SERVER_URL for config refresh when set", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-env-refresh-"));
    const server = await startConfigReloadTestServer();
    const previousServerUrl = process.env.BB_SERVER_URL;

    try {
      process.env.BB_SERVER_URL = server.url;

      await runBbApp(["--data-dir", dataDir, "config", "refresh"]);

      expect(server.reloadRequests()).toEqual([
        expectedConfigReloadRequest(server),
      ]);
    } finally {
      if (previousServerUrl === undefined) {
        delete process.env.BB_SERVER_URL;
      } else {
        process.env.BB_SERVER_URL = previousServerUrl;
      }
      await server.close();
    }
  });

  it("uses persisted BB_SERVER_URL for config refresh without env or flags", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-persisted-url-"));
    const server = await startConfigReloadTestServer();

    try {
      await runBbApp([
        "--data-dir",
        dataDir,
        "config",
        "set",
        "BB_SERVER_URL",
        server.url,
      ]);

      expect(
        JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")),
      ).toEqual({
        serverUrl: server.url,
      });
      expect(server.reloadRequests()).toEqual([]);

      await runBbApp(["--data-dir", dataDir, "config", "refresh"]);

      expect(server.reloadRequests()).toEqual([
        expectedConfigReloadRequest(server),
      ]);
    } finally {
      await server.close();
    }
  });

  it("uses --server-url over env and persisted config for config refresh", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bb-app-config-flag-url-"));
    const configServer = await startConfigReloadTestServer();
    const envServer = await startConfigReloadTestServer();
    const flagServer = await startConfigReloadTestServer();
    const previousServerUrl = process.env.BB_SERVER_URL;

    try {
      await runBbApp([
        "--data-dir",
        dataDir,
        "config",
        "set",
        "BB_SERVER_URL",
        configServer.url,
      ]);

      process.env.BB_SERVER_URL = envServer.url;
      await runBbApp([
        "--data-dir",
        dataDir,
        "--server-url",
        flagServer.url,
        "config",
        "refresh",
      ]);

      expect(configServer.reloadRequests()).toEqual([]);
      expect(envServer.reloadRequests()).toEqual([]);
      expect(flagServer.reloadRequests()).toEqual([
        expectedConfigReloadRequest(flagServer),
      ]);
    } finally {
      if (previousServerUrl === undefined) {
        delete process.env.BB_SERVER_URL;
      } else {
        process.env.BB_SERVER_URL = previousServerUrl;
      }
      await flagServer.close();
      await envServer.close();
      await configServer.close();
    }
  });

  it("detects npm bin symlinks as the main module", () => {
    const testDir = mkdtempSync(join(tmpdir(), "bb-bb-app-main-"));
    const realEntryPath = join(testDir, "dist-index.js");
    const symlinkPath = join(testDir, "bb");
    writeFileSync(realEntryPath, "", "utf8");
    symlinkSync(realEntryPath, symlinkPath);

    expect(
      isMainModule({
        entrypointPath: symlinkPath,
        moduleUrl: pathToFileURL(realEntryPath).href,
      }),
    ).toBe(true);
  });

  it("observes child processes that exited before wait registration", async () => {
    const childProcess = spawn(process.execPath, ["-e", "process.exit(7)"], {
      stdio: "ignore",
    });
    await new Promise<void>((resolvePromise, reject) => {
      childProcess.once("error", reject);
      childProcess.once("exit", () => {
        resolvePromise();
      });
    });

    await expect(
      Promise.race([waitForProcessExit(childProcess), delay({ ms: 100 })]),
    ).resolves.toEqual({ code: 7, signal: null });
  });

  it("keeps daemon running and starts only a new server after server exit", async () => {
    const supervisor = createFakeSupervisor();
    const initialServerRun = supervisor.serverRuns[0];
    const initialDaemonRun = supervisor.daemonRuns[0];
    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: immediateDelay,
      isShutdownRequested: supervisor.shutdownRequested,
      processes: supervisor.processes,
      startDaemon: supervisor.daemonStart,
      startServer: supervisor.serverStart,
    });

    initialServerRun.exitWith({ code: 1, signal: null });
    const nextServerRun = await waitForProcessReplacement({
      currentRun: () => supervisor.processes.serverRun,
      previousRun: initialServerRun,
    });

    expect(initialServerRun.running).toBe(false);
    expect(initialDaemonRun.running).toBe(true);
    expect(supervisor.processes.daemonRun).toBe(initialDaemonRun);
    expect(supervisor.daemonRuns).toHaveLength(1);
    expect(supervisor.serverRuns).toHaveLength(2);
    expect(nextServerRun).toBe(supervisor.serverRuns[1]);
    expect(supervisor.serverRuns[1]?.running).toBe(true);

    await expect(stopFakeSupervisor(supervisor, supervision)).resolves.toBe(
      "shutdown",
    );
  });

  it("keeps server running and starts only a new daemon after daemon exit", async () => {
    const supervisor = createFakeSupervisor();
    const initialServerRun = supervisor.serverRuns[0];
    const initialDaemonRun = supervisor.daemonRuns[0];
    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: immediateDelay,
      isShutdownRequested: supervisor.shutdownRequested,
      processes: supervisor.processes,
      startDaemon: supervisor.daemonStart,
      startServer: supervisor.serverStart,
    });

    initialDaemonRun.exitWith({ code: 1, signal: null });
    const nextDaemonRun = await waitForProcessReplacement({
      currentRun: () => supervisor.processes.daemonRun,
      previousRun: initialDaemonRun,
    });

    expect(initialDaemonRun.running).toBe(false);
    expect(initialServerRun.running).toBe(true);
    expect(supervisor.processes.serverRun).toBe(initialServerRun);
    expect(supervisor.serverRuns).toHaveLength(1);
    expect(supervisor.daemonRuns).toHaveLength(2);
    expect(nextDaemonRun).toBe(supervisor.daemonRuns[1]);
    expect(supervisor.daemonRuns[1]?.running).toBe(true);

    await expect(stopFakeSupervisor(supervisor, supervision)).resolves.toBe(
      "shutdown",
    );
  });

  it("terminates both children without restarting during shutdown", async () => {
    const supervisor = createFakeSupervisor();
    const initialServerRun = supervisor.serverRuns[0];
    const initialDaemonRun = supervisor.daemonRuns[0];
    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: immediateDelay,
      isShutdownRequested: supervisor.shutdownRequested,
      processes: supervisor.processes,
      startDaemon: supervisor.daemonStart,
      startServer: supervisor.serverStart,
    });

    supervisor.setShutdownRequested(true);
    await terminateManagedFullStackProcesses({
      processes: supervisor.processes,
      signal: "SIGINT",
    });

    await expect(supervision).resolves.toBe("shutdown");
    expect(initialServerRun.running).toBe(false);
    expect(initialDaemonRun.running).toBe(false);
    expect(initialServerRun.terminationSignals).toEqual(["SIGINT"]);
    expect(initialDaemonRun.terminationSignals).toEqual(["SIGINT"]);
    expect(supervisor.serverRuns).toHaveLength(1);
    expect(supervisor.daemonRuns).toHaveLength(1);
  });

  it("sets exit code to 0 after clean full-stack shutdown", async () => {
    const previousExitCode = process.exitCode;
    const supervisor = createFakeSupervisor();
    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: immediateDelay,
      isShutdownRequested: supervisor.shutdownRequested,
      processes: supervisor.processes,
      startDaemon: supervisor.daemonStart,
      startServer: supervisor.serverStart,
    });

    try {
      process.exitCode = 1;
      supervisor.setShutdownRequested(true);
      const shutdownPromise = terminateManagedFullStackProcesses({
        processes: supervisor.processes,
        signal: "SIGINT",
      });
      const supervisionResult = await supervision;

      await completeFullStackSupervision({
        shutdownPromise,
        supervisionResult,
      });

      expect(process.exitCode).toBe(0);
      expect(supervisor.serverRuns).toHaveLength(1);
      expect(supervisor.daemonRuns).toHaveLength(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("throttles repeated healthy child exits before restarting", async () => {
    const restartThrottle = new ControlledDelay();
    const supervisor = createFakeSupervisor();
    const firstServerRun = supervisor.serverRuns[0];
    const supervision = superviseFullStackProcesses({
      context: createTestStartContext(),
      delayMilliseconds: (args) => restartThrottle.delayMilliseconds(args),
      isShutdownRequested: supervisor.shutdownRequested,
      processes: supervisor.processes,
      startDaemon: supervisor.daemonStart,
      startServer: supervisor.serverStart,
    });

    firstServerRun.exitWith({ code: 1, signal: null });
    const firstDelay = await waitForDelayCall({
      delay: restartThrottle,
      index: 0,
    });
    expect(firstDelay.ms).toBe(1_000);
    expect(supervisor.serverRuns).toHaveLength(1);
    expect(supervisor.processes.serverRun).toBeNull();
    firstDelay.resolve();

    const secondServerRun = await waitForProcessReplacement({
      currentRun: () => supervisor.processes.serverRun,
      previousRun: firstServerRun,
    });
    expect(supervisor.serverRuns).toHaveLength(2);

    supervisor.serverRuns[1]?.exitWith({ code: 1, signal: null });
    const secondDelay = await waitForDelayCall({
      delay: restartThrottle,
      index: 1,
    });
    expect(secondDelay.ms).toBe(1_000);
    expect(supervisor.serverRuns).toHaveLength(2);
    expect(supervisor.processes.serverRun).toBeNull();
    secondDelay.resolve();

    const thirdServerRun = await waitForProcessReplacement({
      currentRun: () => supervisor.processes.serverRun,
      previousRun: secondServerRun,
    });
    expect(thirdServerRun).toBe(supervisor.serverRuns[2]);
    expect(supervisor.serverRuns).toHaveLength(3);

    await expect(stopFakeSupervisor(supervisor, supervision)).resolves.toBe(
      "shutdown",
    );
  });

  it("limits npm package metadata to documented runtimes", () => {
    const metadata = readPackageMetadata();

    expect(metadata.engines.node).toBe(
      "^20.19.0 || ^22.12.0 || ^24.0.0 || ^26.0.0",
    );
    expect(metadata.os).toEqual(["darwin", "linux"]);
  });
});
