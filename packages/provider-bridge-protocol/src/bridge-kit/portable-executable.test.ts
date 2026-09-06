import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  isMissingPortableExecutable,
  isWindowsScriptExecutable,
  parseBinaryLookupOutput,
  PortableCommandError,
  resolveBinaryLookupCommand,
  resolveNpmCommand,
  resolveNpmGlobalBinDir,
  runPortableCommandCapture,
  spawnPortableAgentProcess,
  type PortableSpawnFn,
} from "./portable-executable.js";

const HOSTILE_ARG = `prompt with spaces & del C:\\temp "quoted" %PATH%`;

interface RecordedSpawn {
  file: string;
  args: string[];
  options: SpawnOptions;
}

interface FakeSpawnedChild {
  child: ChildProcess;
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
}

function recordingSpawn(): {
  calls: RecordedSpawn[];
  spawned: FakeSpawnedChild[];
  fn: PortableSpawnFn;
} {
  const calls: RecordedSpawn[] = [];
  const spawned: FakeSpawnedChild[] = [];
  const fn: PortableSpawnFn = (file, args, options) => {
    calls.push({ file, args, options });
    const emitter = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = Object.assign(emitter, {
      stdin,
      stdout,
      stderr,
      kill: () => true,
      exitCode: null,
      signalCode: null,
    }) as unknown as ChildProcess;
    spawned.push({ child, stdin, stdout, stderr });
    return child;
  };
  return { calls, spawned, fn };
}

describe("resolveBinaryLookupCommand", () => {
  it("uses where.exe on win32 and which elsewhere", () => {
    expect(resolveBinaryLookupCommand("win32")).toBe("where.exe");
    expect(resolveBinaryLookupCommand("linux")).toBe("which");
    expect(resolveBinaryLookupCommand("darwin")).toBe("which");
  });
});

describe("parseBinaryLookupOutput", () => {
  it("keeps where.exe PATHEXT order by returning the first line", () => {
    expect(
      parseBinaryLookupOutput(
        "C:\\tools\\codex.cmd\r\nC:\\tools\\codex.exe\r\n",
      ),
    ).toBe("C:\\tools\\codex.cmd");
  });

  it("skips blank lines and trims the winner", () => {
    expect(parseBinaryLookupOutput("\r\n  /usr/local/bin/codex  \n")).toBe(
      "/usr/local/bin/codex",
    );
  });

  it("returns null when the lookup printed nothing", () => {
    expect(parseBinaryLookupOutput("")).toBeNull();
    expect(parseBinaryLookupOutput("  \r\n  \n")).toBeNull();
  });
});

describe("isWindowsScriptExecutable", () => {
  it("flags cmd, bat and ps1 shims on win32 only", () => {
    for (const name of [
      "C:\\npm\\codex.cmd",
      "C:\\npm\\codex.CMD",
      "C:\\tools\\run.Bat",
      "C:\\tools\\setup.Ps1",
    ]) {
      expect(isWindowsScriptExecutable(name, "win32")).toBe(true);
      expect(isWindowsScriptExecutable(name, "linux")).toBe(false);
    }
  });

  it("leaves native executables alone", () => {
    expect(isWindowsScriptExecutable("C:\\tools\\codex.exe", "win32")).toBe(
      false,
    );
    expect(isWindowsScriptExecutable("codex", "win32")).toBe(false);
    expect(isWindowsScriptExecutable("/usr/local/bin/codex", "linux")).toBe(
      false,
    );
  });
});

describe("resolveNpmCommand", () => {
  it("uses the npm.cmd shim on win32", () => {
    expect(resolveNpmCommand("win32")).toBe("npm.cmd");
    expect(resolveNpmCommand("linux")).toBe("npm");
    expect(resolveNpmCommand("darwin")).toBe("npm");
  });
});

describe("resolveNpmGlobalBinDir", () => {
  it("keeps the npm prefix itself on win32", () => {
    expect(
      resolveNpmGlobalBinDir(
        "C:\\Users\\u\\AppData\\Roaming\\npm",
        "win32",
      ),
    ).toBe("C:\\Users\\u\\AppData\\Roaming\\npm");
  });

  it("appends bin on posix", () => {
    expect(resolveNpmGlobalBinDir("/usr/local", "linux")).toBe(
      "/usr/local/bin",
    );
  });
});

describe("spawnPortableAgentProcess", () => {
  it("passes a win32 cmd shim through untouched with shell disabled", () => {
    const { calls, fn } = recordingSpawn();
    spawnPortableAgentProcess(
      {
        command: "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
        args: ["--model", HOSTILE_ARG],
        cwd: "C:\\work",
        env: { Path: "C:\\Windows" },
        platform: "win32",
      },
      fn,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
    );
    expect(calls[0]?.args).toEqual(["--model", HOSTILE_ARG]);
    expect(calls[0]?.args).toHaveLength(2);
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.stdio).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("passes posix commands through untouched with shell disabled", () => {
    const { calls, fn } = recordingSpawn();
    spawnPortableAgentProcess(
      {
        command: "/usr/local/bin/codex",
        args: ["--model", HOSTILE_ARG],
        cwd: "/work",
        env: { PATH: "/usr/bin" },
        platform: "linux",
      },
      fn,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe("/usr/local/bin/codex");
    expect(calls[0]?.args).toEqual(["--model", HOSTILE_ARG]);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("executes through the win32 default executor without a shell", async () => {
    const child = spawnPortableAgentProcess({
      command: process.execPath,
      args: ["-e", "process.exit(43)"],
      platform: "win32",
    });
    const code = await new Promise<number | null>((resolveExit) => {
      child.on("close", resolveExit);
    });
    expect(code).toBe(43);
  });

  it("executes through the posix default executor", async () => {
    const child = spawnPortableAgentProcess({
      command: process.execPath,
      args: ["-e", "process.exit(44)"],
      platform: "linux",
    });
    const code = await new Promise<number | null>((resolveExit) => {
      child.on("close", resolveExit);
    });
    expect(code).toBe(44);
  });
});

describe("runPortableCommandCapture", () => {
  it("captures --version output from a real process", async () => {
    const result = await runPortableCommandCapture({
      command: process.execPath,
      args: ["--version"],
      timeoutMs: 10_000,
      platform: "linux",
    });
    expect(result.stdout).toMatch(/v?\d+\.\d+\.\d+/u);
  });

  it("delivers a hostile argument as one literal argv element", async () => {
    const result = await runPortableCommandCapture({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", HOSTILE_ARG],
      timeoutMs: 10_000,
      platform: "linux",
    });
    expect(result.stdout).toBe(HOSTILE_ARG);
  });

  it("reports non-zero exits with captured output", async () => {
    const failure = await runPortableCommandCapture({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('out-text'); process.stderr.write('err-text'); process.exit(3)",
      ],
      timeoutMs: 10_000,
      platform: "linux",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PortableCommandError);
    const portable = failure as PortableCommandError;
    expect(portable.exitCode).toBe(3);
    expect(portable.stdout).toBe("out-text");
    expect(portable.stderr).toBe("err-text");
    expect(isMissingPortableExecutable(failure)).toBe(false);
  });

  it("marks a missing executable with ENOENT spawn semantics", async () => {
    const failure = await runPortableCommandCapture({
      command: "bb-provider-that-does-not-exist",
      args: ["--version"],
      timeoutMs: 10_000,
      platform: "linux",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PortableCommandError);
    expect(isMissingPortableExecutable(failure)).toBe(true);
  });

  it("kills a hung process once the timeout elapses", async () => {
    const failure = await runPortableCommandCapture({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 100,
      platform: "linux",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PortableCommandError);
    expect((failure as PortableCommandError).timedOut).toBe(true);
  });

  it("refuses output past the buffer limit", async () => {
    const failure = await runPortableCommandCapture({
      command: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(2 * 1024 * 1024))"],
      timeoutMs: 10_000,
      platform: "linux",
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(PortableCommandError);
    expect((failure as PortableCommandError).message).toContain(
      "output limit",
    );
  });

  it("routes the win32 capture through the injected spawn with shell disabled", async () => {
    const { calls, spawned, fn } = recordingSpawn();
    const pending = runPortableCommandCapture(
      {
        command: "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
        args: ["--version", HOSTILE_ARG],
        timeoutMs: 10_000,
        platform: "win32",
      },
      fn,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.file).toBe(
      "C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd",
    );
    expect(calls[0]?.args).toEqual(["--version", HOSTILE_ARG]);
    expect(calls[0]?.options.shell).toBe(false);
    expect(spawned).toHaveLength(1);
    spawned[0]?.stdout.emit("data", Buffer.from("codex-cli 0.150.0"));
    spawned[0]?.child.emit("close", 0);
    await expect(pending).resolves.toEqual({
      stdout: "codex-cli 0.150.0",
      stderr: "",
    });
  });
});
