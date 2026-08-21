import fs from "node:fs/promises";
import os from "node:os";
import path, { delimiter } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareRuntimeShellEnv,
  resolveLocalBbExecutablePath,
  resolveUserShellPath,
  type SpawnUserShellEnv,
  type SpawnUserShellEnvArgs,
  type UserShellEnvSpawnResult,
} from "./runtime-shell-env.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directoryPath = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directoryPath);
  return directoryPath;
}

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

function createMarkedShellEnvOutput(pathValue: string): string {
  return [
    "shell startup noise",
    "__BB_SHELL_ENV_START__",
    "USER=test-user",
    `PATH=${pathValue}`,
    "__BB_SHELL_ENV_END__",
    "shell shutdown noise",
  ].join("\n");
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

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directoryPath) =>
        fs.rm(directoryPath, { recursive: true, force: true }),
      ),
  );
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

  it("fails clearly when the built CLI entry is not executable", async () => {
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
  });

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

describe("resolveUserShellPath", () => {
  it("settles when the shell env probe times out even if the shell ignores SIGTERM", async () => {
    const shellDir = await makeTempDir("bb-shell-timeout-");
    const shellPath = path.join(shellDir, "ignore-term-shell");
    await fs.writeFile(
      shellPath,
      [
        "#!/usr/bin/env node",
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1000);",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    await fs.chmod(shellPath, 0o755);

    const startedAt = Date.now();

    await expect(
      resolveUserShellPath({
        env: { SHELL: shellPath, PATH: "/usr/bin" },
        platform: "linux",
        timeoutMs: 25,
      }),
    ).resolves.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("loads PATH from the configured interactive login shell", async () => {
    const shellPath = "/root/.local/bin:/usr/local/bin:/usr/bin";
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [
        createShellEnvSpawnResult({
          stdout: createMarkedShellEnvOutput(shellPath),
        }),
      ],
    });

    await expect(
      resolveUserShellPath({
        env: { SHELL: "/usr/bin/bash", PATH: "/usr/bin" },
        platform: "linux",
        spawnUserShellEnv: fakeSpawn.spawn,
        timeoutMs: 1234,
      }),
    ).resolves.toBe(shellPath);

    expect(fakeSpawn.calls).toEqual([
      {
        command: "/usr/bin/bash",
        args: [
          "-ilc",
          "printf '%s\\n' __BB_SHELL_ENV_START__; env; printf '%s\\n' __BB_SHELL_ENV_END__",
        ],
        env: { SHELL: "/usr/bin/bash", PATH: "/usr/bin" },
        timeoutMs: 1234,
      },
    ]);
  });

  it("falls back to a non-interactive login shell when the interactive probe fails", async () => {
    const shellPath = "/home/me/.local/bin:/usr/bin";
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [
        createShellEnvSpawnResult({
          status: 1,
          stderr: "interactive shell failed",
        }),
        createShellEnvSpawnResult({
          stdout: createMarkedShellEnvOutput(shellPath),
        }),
      ],
    });

    await expect(
      resolveUserShellPath({
        env: { SHELL: "/bin/zsh", PATH: "/usr/bin" },
        platform: "linux",
        spawnUserShellEnv: fakeSpawn.spawn,
      }),
    ).resolves.toBe(shellPath);

    expect(fakeSpawn.calls.map((call) => call.args[0])).toEqual([
      "-ilc",
      "-lc",
    ]);
  });

  it("uses plain login mode for sh-compatible fallback shells", async () => {
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [
        createShellEnvSpawnResult({
          stdout: createMarkedShellEnvOutput("/usr/bin:/bin"),
        }),
      ],
    });

    await expect(
      resolveUserShellPath({
        env: { PATH: "/usr/bin" },
        platform: "linux",
        spawnUserShellEnv: fakeSpawn.spawn,
      }),
    ).resolves.toBe("/usr/bin:/bin");

    expect(fakeSpawn.calls[0]?.command).toBe("/bin/sh");
    expect(fakeSpawn.calls[0]?.args[0]).toBe("-lc");
  });

  it("uses zsh as the macOS fallback shell when SHELL is unset", async () => {
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [
        createShellEnvSpawnResult({
          stdout: createMarkedShellEnvOutput("/opt/homebrew/bin:/usr/bin"),
        }),
      ],
    });

    await expect(
      resolveUserShellPath({
        env: { PATH: "/usr/bin" },
        platform: "darwin",
        spawnUserShellEnv: fakeSpawn.spawn,
      }),
    ).resolves.toBe("/opt/homebrew/bin:/usr/bin");

    expect(fakeSpawn.calls[0]?.command).toBe("/bin/zsh");
    expect(fakeSpawn.calls[0]?.args[0]).toBe("-ilc");
  });

  it("skips shell probing on Windows", async () => {
    const fakeSpawn = createFakeShellEnvSpawn({
      results: [
        createShellEnvSpawnResult({
          stdout: createMarkedShellEnvOutput("C:\\Windows"),
        }),
      ],
    });

    await expect(
      resolveUserShellPath({
        env: { SHELL: "/bin/bash", PATH: "C:\\Windows" },
        platform: "win32",
        spawnUserShellEnv: fakeSpawn.spawn,
      }),
    ).resolves.toBeNull();

    expect(fakeSpawn.calls).toEqual([]);
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

  it("forwards the bridge record-mode directory past the BB_* spawn sanitization", () => {
    vi.stubEnv("BB_PROVIDER_BRIDGE_RECORD_DIR", "/tmp/provider-recordings/raw");

    expect(
      prepareRuntimeShellEnv({
        bbExecutableDirectory: "/tmp/bb-bin",
        inheritedPath: "/usr/bin",
        serverUrl: "http://127.0.0.1:3334",
      }),
    ).toMatchObject({
      BB_PROVIDER_BRIDGE_RECORD_DIR: "/tmp/provider-recordings/raw",
    });
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
