import { describe, expect, it } from "vitest";
import {
  ensurePackagedMacOsUserShellPath,
  type DesktopShellPathLogger,
  type ShellPathSpawnResult,
  type SpawnLoginShellPath,
  type SpawnLoginShellPathArgs,
} from "../src/desktop-shell-path.js";

interface FakeSpawn {
  calls: SpawnLoginShellPathArgs[];
  spawn: SpawnLoginShellPath;
}

interface CreateSpawnResultArgs {
  error?: Error;
  signal?: NodeJS.Signals | null;
  status?: number | null;
  stderr?: string;
  stdout?: string;
}

interface CreateFakeSpawnArgs {
  result: ShellPathSpawnResult;
}

interface WarningLogger {
  logger: DesktopShellPathLogger;
  warnings: string[];
}

function createSpawnResult(
  args: CreateSpawnResultArgs,
): ShellPathSpawnResult {
  return {
    ...(args.error === undefined ? {} : { error: args.error }),
    signal: args.signal ?? null,
    status: args.status ?? 0,
    stderr: args.stderr ?? "",
    stdout: args.stdout ?? "",
  };
}

function createFakeSpawn(args: CreateFakeSpawnArgs): FakeSpawn {
  const calls: SpawnLoginShellPathArgs[] = [];
  return {
    calls,
    spawn(spawnArgs) {
      calls.push(spawnArgs);
      return args.result;
    },
  };
}

function createWarningLogger(): WarningLogger {
  const warnings: string[] = [];
  return {
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    warnings,
  };
}

function failIfSpawned(): SpawnLoginShellPath {
  return () => {
    throw new Error("shell spawn should not run");
  };
}

describe("desktop shell PATH loading", () => {
  it("uses the macOS login shell PATH for packaged desktop launches", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const shellPath = "/Users/sawyerhood/.bun/bin:/usr/bin:/bin";
    const fakeSpawn = createFakeSpawn({
      result: createSpawnResult({ stdout: shellPath }),
    });
    const warningLogger = createWarningLogger();

    const result = ensurePackagedMacOsUserShellPath({
      env,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({ kind: "updated", path: shellPath });
    expect(env.PATH).toBe(shellPath);
    expect(warningLogger.warnings).toEqual([]);
    expect(fakeSpawn.calls).toEqual([
      {
        args: ["-ilc", 'printf "%s" "$PATH"'],
        command: "/bin/zsh",
        timeoutMs: 2_000,
      },
    ]);
  });

  it("leaves PATH alone in desktop dev mode", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/opt/homebrew/bin:/usr/bin:/bin" };
    const warningLogger = createWarningLogger();

    const result = ensurePackagedMacOsUserShellPath({
      env,
      isPackaged: false,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({ kind: "skipped", reason: "not-packaged" });
    expect(env.PATH).toBe("/opt/homebrew/bin:/usr/bin:/bin");
    expect(warningLogger.warnings).toEqual([]);
  });

  it("falls back to the inherited PATH when the shell spawn fails", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const fakeSpawn = createFakeSpawn({
      result: createSpawnResult({ error: new Error("spawn failed") }),
    });
    const warningLogger = createWarningLogger();

    const result = ensurePackagedMacOsUserShellPath({
      env,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({ kind: "unchanged", reason: "shell-error" });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(warningLogger.warnings).toEqual([
      "Could not load the user shell PATH for the packaged desktop app: spawn failed. Continuing with the inherited PATH.",
    ]);
  });

  it("falls back to the inherited PATH when shell PATH loading times out", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const fakeSpawn = createFakeSpawn({
      result: createSpawnResult({
        error: new Error("spawnSync /bin/zsh ETIMEDOUT"),
        signal: "SIGTERM",
      }),
    });
    const warningLogger = createWarningLogger();

    const result = ensurePackagedMacOsUserShellPath({
      env,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "darwin",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({ kind: "unchanged", reason: "shell-error" });
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(warningLogger.warnings[0]).toContain("ETIMEDOUT");
  });
});
