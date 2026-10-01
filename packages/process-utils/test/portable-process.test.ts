import { once } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import {
  sanitizeInheritedChildProcessEnv,
  spawnPortablePipedProcess,
} from "../src/index.js";

for (const shim of [false, true]) {
  it.skipIf(shim && process.platform !== "win32")(
    `preserves cwd, arguments, stdin, output, and exit status through ${shim ? "a Windows .cmd shim on PATH" : "a native executable"}`,
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
      if (shim) {
        writeFileSync(
          join(binDirectory, "bb-process-probe.cmd"),
          `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
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
      inheritedEnv.Path = directory;
      const child = spawnPortablePipedProcess({
        command: shim ? "bb-process-probe" : process.execPath,
        args: shim ? args : [scriptPath, ...args],
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
    },
  );
}

it("reports ENOENT when a command cannot be resolved", async () => {
  const child = spawnPortablePipedProcess({
    command: "bb-process-utils-command-that-does-not-exist",
    args: [],
  });
  await expect(once(child, "close")).rejects.toMatchObject({ code: "ENOENT" });
});

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
