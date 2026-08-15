import { describe, expect, it } from "vitest";
import {
  ensurePackagedUserShellPath,
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

function createSpawnResult(args: CreateSpawnResultArgs): ShellPathSpawnResult {
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

    const result = ensurePackagedUserShellPath({
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

    const result = ensurePackagedUserShellPath({
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

    const result = ensurePackagedUserShellPath({
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

    const result = ensurePackagedUserShellPath({
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

  it("uses the configured Linux login shell", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      SHELL: "/usr/bin/fish",
    };
    const shellPath = "/home/sawyer/.local/bin:/usr/bin:/bin";
    const fakeSpawn = createFakeSpawn({
      result: createSpawnResult({ stdout: shellPath }),
    });

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(result).toEqual({ kind: "updated", path: shellPath });
    expect(env.PATH).toBe(shellPath);
    expect(fakeSpawn.calls).toEqual([
      {
        args: ["-ilc", 'printf "%s" "$PATH"'],
        command: "/usr/bin/fish",
        timeoutMs: 2_000,
      },
    ]);
  });

  it("falls back to bash when Linux SHELL is unset", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
    const fakeSpawn = createFakeSpawn({
      result: createSpawnResult({ stdout: "/home/sawyer/bin:/usr/bin:/bin" }),
    });

    ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "linux",
      spawnLoginShellPath: fakeSpawn.spawn,
    });

    expect(fakeSpawn.calls[0]?.command).toBe("/bin/bash");
  });

  it("skips unsupported platforms", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" };

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "freebsd",
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({
      kind: "skipped",
      reason: "unsupported-platform",
    });
    expect(env.PATH).toBe("/usr/bin");
  });

  it("uses HKLM then HKCU Path for packaged Windows launches", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\sawyer",
    };
    const warningLogger = createWarningLogger();

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "win32",
      readWindowsEnvironmentPath: () => ({
        kind: "ok",
        systemPath: "%SystemRoot%\\System32;C:\\Windows",
        userPath: "%USERPROFILE%\\.local\\bin;C:\\Users\\sawyer\\AppData\\Roaming\\npm",
      }),
      spawnLoginShellPath: failIfSpawned(),
    });

    const path =
      "C:\\Windows\\System32;C:\\Windows;C:\\Users\\sawyer\\.local\\bin;C:\\Users\\sawyer\\AppData\\Roaming\\npm";
    expect(result).toEqual({ kind: "updated", path });
    expect(env.PATH).toBe(path);
    expect(warningLogger.warnings).toEqual([]);
  });

  it("does not expand %PATH% from the stripped inherited value", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "C:\\Windows\\System32",
    };

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "win32",
      readWindowsEnvironmentPath: () => ({
        kind: "ok",
        systemPath: "%PATH%;C:\\Windows",
        userPath: "",
      }),
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({
      kind: "updated",
      path: "%PATH%;C:\\Windows",
    });
  });

  it("keeps system Path when the user Path is missing", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: createWarningLogger().logger,
      platform: "win32",
      readWindowsEnvironmentPath: () => ({
        kind: "ok",
        systemPath: "C:\\Windows\\System32;C:\\Windows",
        userPath: "",
      }),
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({
      kind: "updated",
      path: "C:\\Windows\\System32;C:\\Windows",
    });
  });

  it("falls back to the inherited PATH when the Windows registry read fails", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };
    const warningLogger = createWarningLogger();

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: true,
      logger: warningLogger.logger,
      platform: "win32",
      readWindowsEnvironmentPath: () => ({
        kind: "error",
        message: "reg.exe ENOENT",
      }),
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({ kind: "unchanged", reason: "registry-error" });
    expect(env.PATH).toBe("C:\\Windows\\System32");
    expect(warningLogger.warnings).toEqual([
      "Could not load the user shell PATH for the packaged desktop app: Windows registry PATH: reg.exe ENOENT. Continuing with the inherited PATH.",
    ]);
  });

  it("leaves PATH alone in Windows desktop dev mode", () => {
    const env: NodeJS.ProcessEnv = { PATH: "C:\\Windows\\System32" };

    const result = ensurePackagedUserShellPath({
      env,
      isPackaged: false,
      logger: createWarningLogger().logger,
      platform: "win32",
      readWindowsEnvironmentPath: () => {
        throw new Error("registry read should not run");
      },
      spawnLoginShellPath: failIfSpawned(),
    });

    expect(result).toEqual({ kind: "skipped", reason: "not-packaged" });
    expect(env.PATH).toBe("C:\\Windows\\System32");
  });

  it.skipIf(process.platform !== "win32")(
    "reads a non-empty Path from the live Windows registry",
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      const warningLogger = createWarningLogger();

      const result = ensurePackagedUserShellPath({
        env,
        isPackaged: true,
        logger: warningLogger.logger,
        platform: "win32",
        spawnLoginShellPath: failIfSpawned(),
      });

      expect(result.kind).toBe("updated");
      if (result.kind !== "updated") {
        return;
      }
      expect(result.path.toLowerCase()).toContain("system32");
      expect(env.PATH).toBe(result.path);
      expect(warningLogger.warnings).toEqual([]);
    },
  );
});
