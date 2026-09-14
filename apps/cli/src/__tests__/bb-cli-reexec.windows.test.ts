import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { maybeReexecViaBbCli } from "../bb-cli-reexec.js";
import {
  resolveBbCliEntryTarget,
  resolveBbCliSpawn,
} from "../bb-cli-reexec.windows.js";

describe("resolveBbCliEntryTarget", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-entry-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("returns the target unchanged off Windows", () => {
    expect(resolveBbCliEntryTarget("/tmp/bb.cmd", "linux")).toBe("/tmp/bb.cmd");
  });

  it("returns non-batch targets unchanged on Windows", () => {
    expect(resolveBbCliEntryTarget("C:\\dist\\bb", "win32")).toBe(
      "C:\\dist\\bb",
    );
  });

  it("resolves a batch shim to its sibling extensionless entry", async () => {
    const shim = join(tempRoot, "bb.cmd");
    const entry = join(tempRoot, "bb");
    await writeFile(shim, "@echo off\r\n");
    await writeFile(entry, "console.log(1);\n");
    expect(resolveBbCliEntryTarget(shim, "win32")).toBe(entry);
    expect(resolveBbCliEntryTarget(join(tempRoot, "bb.bat"), "win32")).toBe(
      entry,
    );
  });

  it("keeps a batch shim when it has no sibling entry", async () => {
    const shim = join(tempRoot, "bb.cmd");
    await writeFile(shim, "@echo off\r\n");
    expect(resolveBbCliEntryTarget(shim, "win32")).toBe(shim);
  });
});

describe("resolveBbCliSpawn", () => {
  it("spawns targets directly off Windows", () => {
    expect(resolveBbCliSpawn("/tmp/bb", ["status"], "linux", "/node")).toEqual({
      command: "/tmp/bb",
      args: ["status"],
    });
  });

  it("hosts extensionless and js entries on node on Windows", () => {
    expect(
      resolveBbCliSpawn("C:\\dist\\bb", ["status", "a b"], "win32", "C:\\node"),
    ).toEqual({
      command: "C:\\node",
      args: ["C:\\dist\\bb", "status", "a b"],
    });
    expect(
      resolveBbCliSpawn("C:\\dist\\bb.mjs", [], "win32", "C:\\node"),
    ).toEqual({ command: "C:\\node", args: ["C:\\dist\\bb.mjs"] });
  });

  it("spawns other extensions directly on Windows", () => {
    expect(
      resolveBbCliSpawn("C:\\dist\\bb.exe", ["status"], "win32", "C:\\node"),
    ).toEqual({ command: "C:\\dist\\bb.exe", args: ["status"] });
  });
});

describe("maybeReexecViaBbCli with a Windows batch shim", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "bb-cli-reexec-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== "win32")(
    "no-ops when BB_CLI is a bb.cmd shim wrapping the current entry",
    async () => {
      const entry = join(tempRoot, "bb");
      const shim = join(tempRoot, "bb.cmd");
      await writeFile(entry, "console.log(1);\n");
      await writeFile(shim, "@echo off\r\n");
      const reexec = vi.fn();
      maybeReexecViaBbCli({
        env: { BB_CLI: shim },
        currentExecutablePath: entry,
        reexec,
      });
      expect(reexec).not.toHaveBeenCalled();
    },
  );

  it.skipIf(process.platform !== "win32")(
    "re-execs a bb.cmd shim through its sibling extensionless entry",
    async () => {
      const target = join(tempRoot, "bb");
      const shim = join(tempRoot, "bb.cmd");
      const runner = join(tempRoot, "runner.mjs");
      await writeFile(
        target,
        "console.log(JSON.stringify(process.argv.slice(2))); process.exitCode = 7;",
      );
      await writeFile(shim, "@echo off\r\nrem not spawnable by Node\r\n");
      await writeFile(
        runner,
        `import { maybeReexecViaBbCli } from ${JSON.stringify(new URL("../bb-cli-reexec.ts", import.meta.url).href)}; maybeReexecViaBbCli(); console.log("WRONG_FALLTHROUGH");`,
      );
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", runner, "argument with spaces"],
        {
          env: { ...process.env, BB_CLI: shim, BB_CLI_REEXEC: "" },
          encoding: "utf8",
          windowsHide: true,
          timeout: 15_000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(7);
      expect(JSON.parse(result.stdout.trim())).toEqual([
        "argument with spaces",
      ]);
    },
  );
});
