import fs from "node:fs/promises";
import path, { delimiter } from "node:path";
import { makeTempDir } from "@bb/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeShellEnv,
  resolvePowerShellExecutionPolicyDefault,
  resolveLocalBbExecutablePath,
  type SpawnUserShellEnv,
  type SpawnUserShellEnvArgs,
  type UserShellEnvSpawnResult,
} from "./runtime-shell-env.js";

interface FakeCliPackageOptions {
  executablePath?: string;
  executable?: boolean;
  writeEntry?: boolean;
  writeRuntime?: boolean;
}

interface FakeCliPackage {
  cliEntryPath: string;
  cliRuntimePath: string;
}

interface FakeShellEnvSpawn {
  calls: SpawnUserShellEnvArgs[];
  spawn: SpawnUserShellEnv;
}

interface CreateShellEnvSpawnResultArgs {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status?: number | null;
  stderr?: string;
  stdout?: string;
}

interface CreateFakeShellEnvSpawnArgs {
  results: UserShellEnvSpawnResult[];
}

async function withPlatform<T>(
  platform: NodeJS.Platform,
  action: () => Promise<T>,
): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    process,
    "platform",
  );
  if (!originalDescriptor) {
    throw new Error("Expected process.platform descriptor");
  }

  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });

  try {
    return await action();
  } finally {
    Object.defineProperty(process, "platform", originalDescriptor);
  }
}

async function createFakeCliPackage(
  options: FakeCliPackageOptions = {},
): Promise<FakeCliPackage> {
  const cliPackageRoot = await makeTempDir("bb-cli-package-");
  const executablePath = options.executablePath ?? "./dist/bin/bb";
  const cliEntryPath = path.resolve(cliPackageRoot, executablePath);
  const cliRuntimePath = path.resolve(cliPackageRoot, "dist/index.js");

  if (options.writeEntry ?? true) {
    await fs.mkdir(path.dirname(cliEntryPath), { recursive: true });
    await fs.writeFile(
      cliEntryPath,
      "#!/usr/bin/env node\nprocess.stdout.write('bb')\n",
      { mode: options.executable ? 0o755 : 0o644 },
    );
    await fs.chmod(cliEntryPath, options.executable ? 0o755 : 0o644);
  }

  if (options.writeRuntime) {
    await fs.mkdir(path.dirname(cliRuntimePath), { recursive: true });
    await fs.writeFile(cliRuntimePath, "process.stdout.write('bb')\n", "utf8");
  }

  return {
    cliEntryPath,
    cliRuntimePath,
  };
}

function createShellEnvSpawnResult(
  args: CreateShellEnvSpawnResultArgs,
): UserShellEnvSpawnResult {
  return {
    ...(args.error === undefined ? {} : { error: args.error }),
    signal: args.signal ?? null,
    status: args.status ?? 0,
    stderr: args.stderr ?? "",
    stdout: args.stdout ?? "",
  };
}

function createFakeShellEnvSpawn(
  args: CreateFakeShellEnvSpawnArgs,
): FakeShellEnvSpawn {
  const calls: SpawnUserShellEnvArgs[] = [];
  const results = [...args.results];
  return {
    calls,
    async spawn(spawnArgs) {
      calls.push(spawnArgs);
      const result = results.shift();
      if (!result) {
        throw new Error("Unexpected shell env spawn");
      }
      return result;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveLocalBbExecutablePath", () => {
  it("returns the built CLI executable path", async () => {
    const { cliEntryPath, cliRuntimePath } = await createFakeCliPackage({
      executable: true,
      writeRuntime: true,
    });

    await expect(
      resolveLocalBbExecutablePath({
        cliExecutablePath: cliEntryPath,
        cliRuntimePath,
      }),
    ).resolves.toBe(cliEntryPath);
  });

  it("fails before startup when the source CLI runtime is unbuilt", async () => {
    const { cliEntryPath, cliRuntimePath } = await createFakeCliPackage({
      executable: true,
    });

    await expect(
      resolveLocalBbExecutablePath({
        cliExecutablePath: cliEntryPath,
        cliRuntimePath,
      }),
    ).rejects.toThrow(
      `Missing built bb CLI runtime at ${cliRuntimePath}. Build @bb/cli before starting the host daemon.`,
    );
  });

  it("fails clearly when the built CLI entry is missing", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      writeEntry: false,
    });

    await expect(
      resolveLocalBbExecutablePath({
        cliExecutablePath: cliEntryPath,
      }),
    ).rejects.toThrow(
      `Missing built bb CLI entry at ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
    );
  });

  it.skipIf(process.platform === "win32")(
    "fails clearly when the built CLI entry is not executable",
    async () => {
      const { cliEntryPath } = await createFakeCliPackage({
        executable: false,
      });

      await expect(
        resolveLocalBbExecutablePath({
          cliExecutablePath: cliEntryPath,
        }),
      ).rejects.toThrow(
        `Resolved bb CLI entry is not executable: ${cliEntryPath}. Build @bb/cli before starting the host daemon.`,
      );
    },
  );

  it("skips the execute-bit check on win32", async () => {
    const { cliEntryPath } = await createFakeCliPackage({
      executable: false,
    });

    await expect(
      withPlatform("win32", () =>
        resolveLocalBbExecutablePath({
          cliExecutablePath: cliEntryPath,
        }),
      ),
    ).resolves.toBe(cliEntryPath);
  });
});

describe("prepareRuntimeShellEnv", () => {
  it("uses the daemon proxy URL without exporting its machine credential", () => {
    vi.stubEnv("BB_CONNECT_MACHINE_CREDENTIAL", "bbcm_durable_secret");

    const env = prepareRuntimeShellEnv({
      bbExecutableDirectory: "/tmp/bb-bin",
      inheritedPath: "/usr/bin",
      serverUrl: "http://127.0.0.1:43123",
    });

    expect(env.BB_SERVER_URL).toBe("http://127.0.0.1:43123");
    expect(env).not.toHaveProperty("BB_CONNECT_MACHINE_CREDENTIAL");
  });

  it("prepends the configured bb executable directory to PATH and sets BB_CLI", () => {
    expect(
      prepareRuntimeShellEnv({
        bbExecutableDirectory: "/tmp/bb-bin",
        hostDaemonPort: 3002,
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/bin`,
      BB_CLI: path.resolve("/tmp/bb-bin", "bb"),
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_HOST_DAEMON_PORT: "3002",
    });
  });

  it("sets the PowerShell execution policy it is given and none otherwise", () => {
    const options = {
      bbExecutableDirectory: "C:\\bb",
      inheritedPath: "C:\\Windows",
      serverUrl: "http://127.0.0.1:43123",
    };

    expect(
      prepareRuntimeShellEnv({
        ...options,
        powershellExecutionPolicy: "RemoteSigned",
      }),
    ).toMatchObject({ PSExecutionPolicyPreference: "RemoteSigned" });
    expect(
      prepareRuntimeShellEnv({ ...options, powershellExecutionPolicy: null }),
    ).not.toHaveProperty("PSExecutionPolicyPreference");
    expect(prepareRuntimeShellEnv(options)).not.toHaveProperty(
      "PSExecutionPolicyPreference",
    );
  });

  it("uses an explicit bbExecutablePath for BB_CLI", () => {
    expect(
      prepareRuntimeShellEnv({
        bbExecutableDirectory: "/tmp/bb-bin",
        bbExecutablePath: "/opt/custom/bb",
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toMatchObject({
      BB_CLI: "/opt/custom/bb",
      PATH: `/tmp/bb-bin${delimiter}/usr/bin`,
    });
  });

  it("falls back to process.env.PATH when inheritedPath is omitted", () => {
    vi.stubEnv("PATH", "/usr/local/bin:/usr/bin");

    expect(
      prepareRuntimeShellEnv({
        bbExecutableDirectory: "/tmp/bb-bin",
        hostDaemonPort: 3002,
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/local/bin:/usr/bin`,
      BB_CLI: path.resolve("/tmp/bb-bin", "bb"),
      BB_SERVER_URL: "http://127.0.0.1:3334",
      BB_HOST_DAEMON_PORT: "3002",
    });
  });

  it("omits the host daemon port when the local API is disabled", () => {
    expect(
      prepareRuntimeShellEnv({
        bbExecutableDirectory: "/tmp/bb-bin",
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toEqual({
      PATH: `/tmp/bb-bin${delimiter}/usr/bin`,
      BB_CLI: path.resolve("/tmp/bb-bin", "bb"),
      BB_SERVER_URL: "http://127.0.0.1:3334",
    });
  });
});

describe("resolvePowerShellExecutionPolicyDefault", () => {
  const notConfigured = createShellEnvSpawnResult({ status: 1, stdout: "" });
  const windowsEnv = {
    PATH: "C:\\Windows\\system32;C:\\Program Files\\PowerShell\\7\\",
    SystemRoot: "C:\\Windows",
    USERPROFILE: "C:\\Users\\me",
  };

  it("offers RemoteSigned when neither the user nor the machine chose a policy", async () => {
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [notConfigured, notConfigured],
    });
    const readPaths: string[] = [];

    await expect(
      resolvePowerShellExecutionPolicyDefault({
        env: windowsEnv,
        platform: "win32",
        readTextFile: async (filePath) => {
          readPaths.push(filePath);
          return null;
        },
        spawnUserShellEnv: fakeSpawn.spawn,
      }),
    ).resolves.toBe("RemoteSigned");

    expect(fakeSpawn.calls.map((call) => call.args)).toEqual([
      [
        "query",
        "HKCU\\Software\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell",
        "/v",
        "ExecutionPolicy",
      ],
      [
        "query",
        "HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell",
        "/v",
        "ExecutionPolicy",
      ],
    ]);
    expect(readPaths).toEqual([
      "C:\\Users\\me\\Documents\\PowerShell\\powershell.config.json",
      "C:\\Program Files\\PowerShell\\7\\powershell.config.json",
    ]);
  });

  it("leaves a policy the user or machine set in the registry alone", async () => {
    for (const results of [
      [
        createShellEnvSpawnResult({
          stdout: "    ExecutionPolicy    REG_SZ    AllSigned\r\n",
        }),
      ],
      [
        notConfigured,
        createShellEnvSpawnResult({
          stdout: "    ExecutionPolicy    REG_SZ    Restricted\r\n",
        }),
      ],
    ]) {
      await expect(
        resolvePowerShellExecutionPolicyDefault({
          env: windowsEnv,
          platform: "win32",
          readTextFile: async () => null,
          spawnUserShellEnv: createFakeShellEnvSpawn({ results }).spawn,
        }),
      ).resolves.toBeNull();
    }
  });

  it("leaves a policy set in a PowerShell 7 configuration file alone", async () => {
    await expect(
      resolvePowerShellExecutionPolicyDefault({
        env: windowsEnv,
        platform: "win32",
        readTextFile: async (filePath) =>
          filePath.includes("Documents")
            ? '{"Microsoft.PowerShell:ExecutionPolicy":"AllSigned"}'
            : null,
        spawnUserShellEnv: createFakeShellEnvSpawn({
          results: [notConfigured, notConfigured],
        }).spawn,
      }),
    ).resolves.toBeNull();
  });

  it("offers nothing when the variable is already set, the registry cannot be read, or the host is not Windows", async () => {
    const neverSpawn = createFakeShellEnvSpawn({ results: [] });
    await expect(
      resolvePowerShellExecutionPolicyDefault({
        env: { ...windowsEnv, PSEXECUTIONPOLICYPREFERENCE: "AllSigned" },
        platform: "win32",
        spawnUserShellEnv: neverSpawn.spawn,
      }),
    ).resolves.toBeNull();
    await expect(
      resolvePowerShellExecutionPolicyDefault({
        env: windowsEnv,
        platform: "linux",
        spawnUserShellEnv: neverSpawn.spawn,
      }),
    ).resolves.toBeNull();
    expect(neverSpawn.calls).toEqual([]);
    await expect(
      resolvePowerShellExecutionPolicyDefault({
        env: windowsEnv,
        platform: "win32",
        readTextFile: async () => null,
        spawnUserShellEnv: createFakeShellEnvSpawn({
          results: [
            createShellEnvSpawnResult({
              error: new Error("spawn reg.exe ENOENT"),
              status: null,
            }),
          ],
        }).spawn,
      }),
    ).resolves.toBeNull();
  });
});
