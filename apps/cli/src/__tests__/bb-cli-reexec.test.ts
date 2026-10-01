import { realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BB_CLI_REEXEC_ENV,
  maybeReexecViaBbCli,
  resolveBbCliLaunch,
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

describe("resolveBbCliLaunch", () => {
  it("runs an extensionless BB_CLI script through Node on Windows", () => {
    expect(
      resolveBbCliLaunch({
        argv: ["status"],
        nodePath: "C:\\node\\node.exe",
        platform: "win32",
        target: "C:\\bb\\host-daemon\\dist\\bb",
      }),
    ).toEqual({
      command: "C:\\node\\node.exe",
      args: ["C:\\bb\\host-daemon\\dist\\bb", "status"],
    });
  });

  it("executes BB_CLI directly when the platform can run it", () => {
    expect(
      resolveBbCliLaunch({
        argv: ["status"],
        nodePath: "C:\\node\\node.exe",
        platform: "win32",
        target: "C:\\tools\\bb.exe",
      }),
    ).toEqual({ command: "C:\\tools\\bb.exe", args: ["status"] });
    expect(
      resolveBbCliLaunch({
        argv: ["status"],
        nodePath: "/usr/bin/node",
        platform: "darwin",
        target: "/opt/bb/host-daemon/dist/bb",
      }),
    ).toEqual({ command: "/opt/bb/host-daemon/dist/bb", args: ["status"] });
  });
});
