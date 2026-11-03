import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";
import {
  execPortableFile,
  killPortableProcess,
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
  spawnPortableProcess,
  spawnManagedProcess,
} from "../src/index.js";

for (const kind of [
  "a native executable",
  "a Windows .cmd shim on PATH",
  "an explicit Windows .cmd path",
  "an explicit Windows extensionless shebang path",
]) {
  const native = kind === "a native executable";
  const shebang = kind === "an explicit Windows extensionless shebang path";
  it.skipIf(!native && process.platform !== "win32")(
    `preserves cwd, arguments, stdin, output, and exit status through ${kind}`,
    async () => {
      const directory = realpathSync(
        mkdtempSync(join(tmpdir(), "bb process é-")),
      );
      onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
      const scriptPath = join(directory, "probe.cjs");
      writeFileSync(
        scriptPath,
        [
          'const fs = require("node:fs");',
          'const stdin = fs.readFileSync(0, "utf8");',
          "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), stdin }));",
          'process.stderr.write("provider stderr");',
          "process.exitCode = 23;",
        ].join("\n"),
      );
      const binDirectory = join(directory, "node_modules", ".bin");
      mkdirSync(binDirectory, { recursive: true });
      const shimPath = join(
        binDirectory,
        shebang ? "bb-process-probe" : "bb-process-probe.cmd",
      );
      if (shebang) {
        writeFileSync(
          shimPath,
          "#!/usr/bin/env node\n" + readFileSync(scriptPath, "utf8"),
        );
      } else if (!native) {
        writeFileSync(
          shimPath,
          `@echo off\r\n"${process.execPath}" "%~dp0..\\..\\probe.cjs" %*\r\n`,
        );
      }
      const args = [
        "hello world",
        "",
        'a"quote',
        "a&b|c",
        "(value)^",
        "日本語",
        "trailing\\",
      ];
      const inheritedEnv: NodeJS.ProcessEnv = { ...process.env };
      for (const key of Object.keys(inheritedEnv)) {
        if (key.toUpperCase() === "PATH") delete inheritedEnv[key];
      }
      inheritedEnv.Path = [directory, dirname(process.execPath)].join(
        delimiter,
      );
      const command = native
        ? process.execPath
        : kind === "a Windows .cmd shim on PATH"
          ? "bb-process-probe"
          : shimPath;
      const commandArgs = native ? [scriptPath, ...args] : args;
      const child = spawnPortablePipedProcess({
        command,
        args: commandArgs,
        cwd: directory,
        env: sanitizeInheritedChildProcessEnv({
          env: inheritedEnv,
          shellPath: binDirectory,
        }),
      });
      onTestFinished(() => {
        child.kill();
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
      const closed = once(child, "close");
      child.stdin.end("input with spaces and é\n");

      expect(await closed).toEqual([23, null]);
      expect(JSON.parse(Buffer.concat(stdout).toString("utf8"))).toEqual({
        args,
        cwd: directory,
        stdin: "input with spaces and é\n",
      });
      expect(Buffer.concat(stderr).toString("utf8")).toBe("provider stderr");
      if (!shebang)
        await expect(
          execPortableFile(command, commandArgs, {
            cwd: directory,
            env: sanitizeInheritedChildProcessEnv({
              env: inheritedEnv,
              shellPath: binDirectory,
            }),
            maxBuffer: 1024,
            input: "input with spaces and é\n",
          }),
        ).rejects.toMatchObject({
          code: 23,
          stdout: JSON.stringify({
            args,
            cwd: directory,
            stdin: "input with spaces and é\n",
          }),
          stderr: "provider stderr",
        });
    },
  );
}

it.each(["name", "path"])(
  "reports ENOENT and finishes cleanup when a command %s cannot be resolved",
  async (kind) => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "bb-missing-process-")),
    );
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const command =
      kind === "path"
        ? join(directory, "missing-agent")
        : "bb-process-utils-command-that-does-not-exist";
    const managed = spawnManagedProcess({ command, args: [] });
    let spawned = false;
    let stderr = "";
    managed.child.once("spawn", () => {
      spawned = true;
    });
    managed.child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const closed = new Promise<void>((resolve) => {
      managed.child.once("close", () => resolve());
    });
    try {
      await expect(once(managed.child, "close")).rejects.toMatchObject({
        code: "ENOENT",
      });
      await closed;
      if (kind === "path") {
        expect(spawned).toBe(false);
        expect(stderr).toBe("");
      }
    } finally {
      await managed.stop();
    }
    await expect(
      execPortableFile(command, [], {
        cwd: process.cwd(),
        env: process.env,
        maxBuffer: 1024,
      }),
    ).rejects.toMatchObject({
      code: "ENOENT",
      syscall: expect.stringMatching(/^spawn/),
      stdout: "",
      stderr: "",
    });
  },
  20_000,
);

it.runIf(process.platform === "win32")(
  "removes case-insensitive inherited runtime settings before a Windows child reads them",
  async () => {
    const env = sanitizeInheritedChildProcessEnv({
      env: {
        ...process.env,
        bb_data_dir: "parent-data",
        Bb_HOST_DAEMON_PORT: "12345",
        Node_Env: "development",
        PROVIDER_TOKEN: "preserved-token",
      },
    });
    const child = spawnPortablePipedProcess({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(JSON.stringify([process.env.BB_DATA_DIR ?? null, process.env.BB_HOST_DAEMON_PORT ?? null, process.env.NODE_ENV ?? null, process.env.PROVIDER_TOKEN]));",
      ],
      env,
    });
    onTestFinished(() => {
      child.kill();
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.resume();

    expect(await once(child, "close")).toEqual([0, null]);
    expect(JSON.parse(Buffer.concat(stdout).toString("utf8"))).toEqual([
      null,
      null,
      null,
      "preserved-token",
    ]);
  },
);

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.runIf(process.platform === "win32")(
  "ends the process behind a Windows .cmd shim when the portable child is killed",
  async () => {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "bb-portable-kill-")),
    );
    onTestFinished(() => rmSync(directory, { force: true, recursive: true }));
    const pidFile = join(directory, "pid.txt");
    writeFileSync(
      join(directory, "sleeper.cjs"),
      'require("node:fs").writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);',
    );
    writeFileSync(
      join(directory, "sleeper.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0sleeper.cjs" %*\r\n`,
    );
    const child = spawnPortableProcess({
      command: join(directory, "sleeper.cmd"),
      args: [pidFile],
      stdio: "ignore",
    });
    const sleeperPid = await vi.waitFor(
      () => Number.parseInt(readFileSync(pidFile, "utf8"), 10),
      { timeout: 10_000 },
    );
    onTestFinished(() => {
      if (isProcessRunning(sleeperPid)) process.kill(sleeperPid);
    });
    expect(sleeperPid).not.toBe(child.pid);
    expect(isProcessRunning(sleeperPid)).toBe(true);

    killPortableProcess(child, "SIGTERM");

    await vi.waitFor(() => expect(isProcessRunning(sleeperPid)).toBe(false), {
      timeout: 10_000,
    });
  },
);

it.skipIf(process.platform === "win32")(
  "signals the portable child directly where signals exist",
  async () => {
    const child = spawnPortableProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      stdio: "ignore",
    });
    const exited = once(child, "exit");

    killPortableProcess(child, "SIGTERM");

    expect(await exited).toEqual([null, "SIGTERM"]);
  },
);
