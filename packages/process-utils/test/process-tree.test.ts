import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProcessLifeline,
  trackChildProcesses,
  waitForExit,
  type ChildProcessTracker,
  type ProcessLifeline,
} from "@bb/test-helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isProcessGroupAlive,
  killProcessGroup,
  killProcessesWithCwdUnder,
  listProcessesWithCwdUnder,
  spawnPortablePipedProcess,
  stopProcessGroupLeaderFirst,
} from "../src/index.js";

const posixOnly = process.platform === "win32" ? describe.skip : describe;

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function readFirstLine(stream: NodeJS.ReadableStream): Promise<string> {
  const [chunk] = await once(stream, "data");
  return String(chunk).trim();
}

posixOnly("process tree helpers", () => {
  const cleanupDirs: string[] = [];
  let children: ChildProcessTracker;
  let lifeline: ProcessLifeline;

  beforeEach(async () => {
    children = trackChildProcesses();
    lifeline = await createProcessLifeline();
  });

  afterEach(async () => {
    children.killRunning();
    children.dispose();
    await lifeline.close();
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  function tempDir(prefix: string): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    cleanupDirs.push(dir);
    return dir;
  }

  function writeHolder(
    dir: string,
    label: string,
    options: { ignoreTerm?: boolean } = {},
  ): string {
    const path = join(dir, `${label}.cjs`);
    writeFileSync(
      path,
      `${options.ignoreTerm === true ? 'process.on("SIGTERM", () => {});' : ""}${lifeline.holdSource(label)}setInterval(() => {}, 1000);`,
    );
    return `"${process.execPath}" "${path}"`;
  }

  it("kills the grandchild when the leader is signalled by process group", async () => {
    const holder = writeHolder(tempDir("bb-group-kill-"), "grandchild");
    const child = spawnPortablePipedProcess({
      command: "sh",
      args: ["-c", `${holder} & wait`],
      detached: true,
    });
    const [grandchild] = await lifeline.waitForHolders(1);
    expect(grandchild?.alive()).toBe(true);
    const exited = waitForExit(child);

    killProcessGroup({ child, signal: "SIGKILL" });

    await grandchild?.exited;
    await exited;
  });

  it("finds and kills processes whose cwd is inside a directory", async () => {
    const dir = tempDir("bb-cwd-sweep-");
    const child = spawn(
      "sh",
      ["-c", `${writeHolder(dir, "grandchild")} & wait`],
      {
        cwd: dir,
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    const [grandchild] = await lifeline.waitForHolders(1);
    const grandchildPid = grandchild?.pid;

    const found = await listProcessesWithCwdUnder({ directories: [dir] });
    expect(found.map((entry) => entry.pid)).toEqual(
      expect.arrayContaining([child.pid, grandchildPid]),
    );
    expect(found.map((entry) => entry.pid)).not.toContain(process.pid);

    const killed = await killProcessesWithCwdUnder({
      directories: [dir],
      graceMs: 200,
    });
    expect(killed.map((entry) => entry.pid)).toEqual(
      expect.arrayContaining([child.pid, grandchildPid]),
    );
    await Promise.all([grandchild?.exited, waitForExit(child)]);

    expect(
      await listProcessesWithCwdUnder({ directories: [`${dir}-other`] }),
    ).toEqual([]);
  });

  it("reports a live group after the leader exits and an empty one after the members die", async () => {
    const holder = writeHolder(tempDir("bb-group-alive-"), "member");
    const child = spawnPortablePipedProcess({
      command: "sh",
      args: ["-c", `${holder} &`],
      detached: true,
    });
    const [member] = await lifeline.waitForHolders(1);
    await waitForExit(child);

    expect(isProcessGroupAlive(child)).toBe(true);
    member?.kill("SIGKILL");
    await member?.exited;
    await waitFor(() => !isProcessGroupAlive(child));
  });

  it("rescans and kills processes that appear while the first targets shut down", async () => {
    const dir = tempDir("bb-cwd-respawn-");
    const respawnerPath = join(dir, "respawner.cjs");
    writeFileSync(
      respawnerPath,
      [
        'const { spawn } = require("node:child_process");',
        'process.on("SIGTERM", () => {',
        "  spawn(process.execPath,",
        `    ["-e", ${JSON.stringify(`${lifeline.holdSource("respawned")}setInterval(() => {}, 30_000)`)}],`,
        '    { cwd: process.cwd(), detached: true, stdio: "ignore" },',
        "  ).unref();",
        "  process.exit(0);",
        "});",
        'console.log("ready");',
        "setInterval(() => {}, 30_000);",
      ].join("\n"),
    );
    const child = spawn(process.execPath, [respawnerPath], {
      cwd: dir,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.unref();
    await readFirstLine(child.stdout);

    const killed = await killProcessesWithCwdUnder({
      directories: [dir],
      graceMs: 500,
    });

    expect(killed.length).toBeGreaterThanOrEqual(2);
    await waitForExit(child);
    await Promise.all(lifeline.holders.map((holder) => holder.exited));
    await vi.waitFor(
      async () =>
        expect(await listProcessesWithCwdUnder({ directories: [dir] })).toEqual(
          [],
        ),
      { timeout: 5000 },
    );
  });

  it("does not follow a symlinked workspace root", async () => {
    const target = realpathSync(mkdtempSync(join(tmpdir(), "bb-cwd-target-")));
    const linkParent = mkdtempSync(join(tmpdir(), "bb-cwd-link-"));
    cleanupDirs.push(target, linkParent);
    const link = join(linkParent, "workspace");
    symlinkSync(target, link);
    const child = spawn("sleep", ["300"], { cwd: target, stdio: "ignore" });
    await waitFor(() => (child.pid ?? 0) > 0);

    expect(await listProcessesWithCwdUnder({ directories: [target] })).toEqual([
      { pid: child.pid, cwd: target },
    ]);
    expect(await listProcessesWithCwdUnder({ directories: [link] })).toEqual(
      [],
    );
  });

  it("stops the leader first so it can shut its own child down", async () => {
    const dir = tempDir("bb-leader-first-");
    const log = join(dir, "log");
    writeFileSync(
      join(dir, "child.cjs"),
      [
        'const fs = require("node:fs");',
        "const log = process.argv[2];",
        'process.on("SIGTERM", () => fs.appendFileSync(log, "child-term\\n"));',
        'process.on("SIGUSR1", () => {',
        '  fs.appendFileSync(log, "child-usr1\\n");',
        "  process.exit(0);",
        "});",
        'console.log("ready");',
        "setInterval(() => {}, 1000);",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "leader.sh"),
      [
        "#!/bin/sh",
        '"$3" "$2" "$1" &',
        "child=$!",
        'trap \'echo leader-term >> "$1"; kill -USR1 "$child"; wait "$child"; exit 0\' TERM',
        "while :; do sleep 0.1; done",
      ].join("\n"),
    );
    const child = spawnPortablePipedProcess({
      command: "sh",
      args: [
        join(dir, "leader.sh"),
        log,
        join(dir, "child.cjs"),
        process.execPath,
      ],
      detached: true,
    });
    expect(await readFirstLine(child.stdout)).toBe("ready");

    await stopProcessGroupLeaderFirst({
      child,
      timeoutMs: 5000,
      killGraceMs: 1000,
    });

    expect(child.exitCode).toBe(0);
    expect(isProcessGroupAlive(child)).toBe(false);
    expect(readFileSync(log, "utf8")).toBe("leader-term\nchild-usr1\n");
  });

  it("escalates to the group when a member outlives the leader", async () => {
    const holder = writeHolder(tempDir("bb-group-escalate-"), "member", {
      ignoreTerm: true,
    });
    const child = spawnPortablePipedProcess({
      command: "sh",
      args: [
        "-c",
        `trap "exit 0" TERM; ${holder} & while :; do sleep 0.1; done`,
      ],
      detached: true,
    });
    const [member] = await lifeline.waitForHolders(1);
    const startedAt = Date.now();

    await stopProcessGroupLeaderFirst({
      child,
      timeoutMs: 300,
      killGraceMs: 5000,
    });

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(child.exitCode).toBe(0);
    await member?.exited;
    await waitFor(() => !isProcessGroupAlive(child));
  });
});
