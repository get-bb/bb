import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSshRunner } from "./ssh-runner.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(body: string) {
  await mkdir("/tmp/pr2", { recursive: true });
  const directory = await mkdtemp("/tmp/pr2/ssh-executor-");
  directories.push(directory);
  const executable = join(directory, "ssh");
  await writeFile(executable, `#!${process.execPath}\n${body}`, {
    mode: 0o755,
  });
  return createSshRunner(executable);
}

const request = () => ({
  command: ["printf", "%s", "hello"],
  timeoutMs: 5_000,
  signal: new AbortController().signal,
});

describe("plain SSH executor", () => {
  it("quotes argv and keeps secret stdin out of the remote command", async () => {
    const runner = await fixture(
      'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({args:process.argv.slice(2),input})));',
    );
    const result = await runner.exec("user@host", {
      ...request(),
      command: ["printf", "%s", "a'b $(touch /bad)\nnext"],
      stdin: "credential",
    });
    const received = JSON.parse(result.stdout);
    expect(received.input).toBe("credential");
    expect(received.args.at(-1)).toMatch(/^exec "\$\{SHELL:-\/bin\/sh\}" -lc /u);
    expect(received.args).toEqual(
      expect.arrayContaining([
        "-T",
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "ClearAllForwardings=yes",
        "ControlPath=none",
        "--",
        "user@host",
      ]),
    );
    expect(received.args.join(" ")).not.toContain("credential");
  });
  it("round-trips literal argv and stdin through the remote login shell", async () => {
    const runner = await fixture(`
      const { spawn } = require("node:child_process");
      const child = spawn("/bin/sh", ["-c", process.argv.at(-1)], {
        env: { ...process.env, SHELL: "/bin/sh" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      process.stdin.pipe(child.stdin);
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
      child.on("close", code => process.exit(code ?? 1));
    `);
    const argument = "a'b $(printf INJECTED)\nnext; \"quoted\"";
    const result = await runner.exec("box", {
      ...request(),
      command: [
        process.execPath,
        "-e",
        'let input="";process.stdin.on("data",chunk=>input+=chunk);process.stdin.on("end",()=>process.stdout.write(JSON.stringify({argument:process.argv[1],input})));',
        argument,
      ],
      stdin: "private bootstrap payload",
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      argument,
      input: "private bootstrap payload",
    });
  });
  it("returns stderr and nonzero remote exit codes", async () => {
    const runner = await fixture(
      'process.stdout.write("out");process.stderr.write("denied");process.exitCode=17;',
    );
    await expect(runner.exec("box", request())).resolves.toEqual({
      exitCode: 17,
      stdout: "out",
      stderr: "denied",
    });
  });
  it("terminates a hung command at its deadline", async () => {
    const runner = await fixture("setInterval(()=>{},1000);");
    await expect(
      runner.exec("box", { ...request(), timeoutMs: 50 }),
    ).rejects.toThrow("timed out");
  });
  it("cancels a running command", async () => {
    const runner = await fixture("setInterval(()=>{},1000);");
    const controller = new AbortController();
    const pending = runner.exec("box", {
      ...request(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });
  it("refuses a pre-aborted command before spawn", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSshRunner("/missing").exec("box", {
        ...request(),
        signal: controller.signal,
      }),
    ).rejects.toBeDefined();
  });
  it("bounds combined output", async () => {
    const runner = await fixture(
      'process.stdout.write("x".repeat(600000));process.stderr.write("y".repeat(600000));setInterval(()=>{},1000);',
    );
    await expect(runner.exec("box", request())).rejects.toThrow(
      "exceeded 1 MiB",
    );
  });
  it("reports a missing executable", async () => {
    const runner = createSshRunner("/missing-ssh-executable");
    await expect(runner.available()).resolves.toBe(false);
    await expect(runner.exec("box", request())).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("rejects option injection before spawn", async () => {
    await expect(
      createSshRunner("/missing").exec("-oProxyCommand=id", request()),
    ).rejects.toThrow("Enter an SSH host");
  });
});
