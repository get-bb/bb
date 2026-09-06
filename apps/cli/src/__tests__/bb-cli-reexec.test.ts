import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BB_CLI_REEXEC_ENV,
  maybeReexecViaBbCli,
  resolveBbCliReexecSpawnPlan,
} from "../bb-cli-reexec.js";

describe("maybeReexecViaBbCli", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-reexec-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function writeExecutable(name: string): Promise<string> {
    const path = join(tempRoot, name);
    await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await chmod(path, 0o755);
    return path;
  }

  it("no-ops when BB_CLI is unset", () => {
    const reexec = vi.fn();
    maybeReexecViaBbCli({
      env: {},
      currentExecutablePath: "/tmp/current-bb",
      reexec,
    });
    expect(reexec).not.toHaveBeenCalled();
  });

  it("no-ops when BB_CLI equals the current executable", async () => {
    const path = await writeExecutable("bb");
    const reexec = vi.fn();
    maybeReexecViaBbCli({
      env: { BB_CLI: path },
      currentExecutablePath: path,
      reexec,
    });
    expect(reexec).not.toHaveBeenCalled();
  });

  it("no-ops when already in a re-exec hop", async () => {
    const current = await writeExecutable("current");
    const target = await writeExecutable("target");
    const reexec = vi.fn();
    maybeReexecViaBbCli({
      env: { BB_CLI: target, [BB_CLI_REEXEC_ENV]: "1" },
      currentExecutablePath: current,
      reexec,
    });
    expect(reexec).not.toHaveBeenCalled();
  });

  it("re-execs to BB_CLI when it differs from the current entry", async () => {
    const current = await writeExecutable("current");
    const target = await writeExecutable("target");
    const reexec = vi.fn();
    maybeReexecViaBbCli({
      env: { BB_CLI: target, BB_SERVER_URL: "http://127.0.0.1:1" },
      currentExecutablePath: current,
      argv: ["status", "--json"],
      reexec,
    });
    expect(reexec).toHaveBeenCalledOnce();
    expect(reexec.mock.calls[0]?.[0]).toEqual({
      target: realpathSync(target),
      argv: ["status", "--json"],
      env: expect.objectContaining({
        BB_CLI: target,
        BB_SERVER_URL: "http://127.0.0.1:1",
        [BB_CLI_REEXEC_ENV]: "1",
      }),
    });
  });

  it("no-ops when BB_CLI path is missing", async () => {
    const current = await writeExecutable("current");
    const reexec = vi.fn();
    maybeReexecViaBbCli({
      env: { BB_CLI: join(tempRoot, "does-not-exist") },
      currentExecutablePath: current,
      reexec,
    });
    expect(reexec).not.toHaveBeenCalled();
  });
});

describe("resolveBbCliReexecSpawnPlan", () => {
  let planRoot: string;

  beforeEach(async () => {
    planRoot = await mkdtemp(join(tmpdir(), "bb-cli-reexec-plan-"));
  });

  afterEach(async () => {
    await rm(planRoot, { recursive: true, force: true });
  });

  it("spawns posix targets directly without a shell", () => {
    expect(
      resolveBbCliReexecSpawnPlan(join(planRoot, "bb"), "linux"),
    ).toEqual({
      argsPrefix: [],
      command: join(planRoot, "bb"),
      shell: false,
    });
  });

  it("spawns a win32 .cmd beside a space-free sibling through the sibling without a shell", async () => {
    const sibling = join(planRoot, "bb");
    await writeFile(sibling, "console.log(1)", { mode: 0o755 });
    const launcher = `${sibling}.cmd`;
    await writeFile(launcher, "@node %~dp0bb %*", { mode: 0o755 });
    expect(resolveBbCliReexecSpawnPlan(launcher, "win32")).toEqual({
      argsPrefix: [sibling],
      command: process.execPath,
      shell: false,
    });
  });

  it("spawns a win32 .cmd beside a sibling in a path containing a space without a shell", async () => {
    const spacedDir = join(planRoot, "bb wn");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(spacedDir, { recursive: true });
    const sibling = join(spacedDir, "bb");
    await writeFile(sibling, "console.log(1)", { mode: 0o755 });
    const launcher = `${sibling}.cmd`;
    await writeFile(launcher, "@node %~dp0bb %*", { mode: 0o755 });
    const plan = resolveBbCliReexecSpawnPlan(launcher, "win32");
    expect(plan).toEqual({
      argsPrefix: [sibling],
      command: process.execPath,
      shell: false,
    });
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(
      plan.command,
      [...plan.argsPrefix, "--version"],
      { encoding: "utf8" },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
  });

  it("keeps a shell for a foreign win32 .cmd with no sibling", () => {
    expect(
      resolveBbCliReexecSpawnPlan(join(planRoot, "missing.cmd"), "win32"),
    ).toEqual({
      argsPrefix: [],
      command: join(planRoot, "missing.cmd"),
      shell: true,
    });
  });
});
