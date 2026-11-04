import { appendFileSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import { npmNodeShim } from "./npm-shim.test-support.js";
import {
  getPiInstallGate,
  getPiProviderInstallationStatus,
  probePiVersion,
  resetPiInstallGateForTests,
} from "./provider-maintenance.js";

const temporaryDirectories: string[] = [];
const evidenceDir = path.resolve(process.cwd(), "../../perf");
mkdirSync(evidenceDir, { recursive: true });
const evidencePath = path.join(evidenceDir, "pi-version-events.jsonl");
function mark(stage: string, detail = ""): void {
  appendFileSync(evidencePath, JSON.stringify({stage, detail, time: Date.now(), pid: process.pid}) + "\n");
}


afterEach(async () => {
  mark("cleanup:start", JSON.stringify(temporaryDirectories));
  vi.unstubAllEnvs();
  resetPiInstallGateForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => {
        try { await rm(directory, { recursive: true, force: true }); mark("cleanup:end", directory); }
        catch (error) { mark("cleanup:error", String(error)); throw error; }
      }),
  );
});

function configureNodeProbe(script: string): void {
  vi.stubEnv(PI_BRIDGE_COMMAND_ENV, process.execPath);
  vi.stubEnv(PI_BRIDGE_ARGS_ENV, JSON.stringify(["-e", script, "--"]));
}

describe("Pi version probe", () => {
  it("preserves configured launch arguments and parses stdout", async () => {
    configureNodeProbe(
      'if (process.argv[1] !== "--version") process.exit(2); process.stdout.write("0.85.1\\n");',
    );
    expect(await probePiVersion()).toEqual({
      version: "0.85.1",
      failure: null,
    });
    expect(await getPiInstallGate()).toEqual({
      ok: true,
      installedVersion: "0.85.1",
    });
  });

  it("reports a non-zero exit even when stdout contains a version", async () => {
    configureNodeProbe('process.stdout.write("0.85.1\\n"); process.exit(2);');
    expect(await probePiVersion()).toMatchObject({
      version: null,
      failure: expect.stringContaining("exited with 2"),
    });
  });

  it("does not interpret stderr as a successful version response", async () => {
    configureNodeProbe('process.stderr.write("0.85.1\\n");');
    expect(await probePiVersion()).toMatchObject({
      version: null,
      failure: expect.stringContaining("printed no version"),
    });
  });

  it("retains the 15 s timeout even when the child prints a version", async () => {
    configureNodeProbe(
      'process.stdout.write("0.85.1\\n"); setInterval(() => {}, 1000);',
    );
    expect(await probePiVersion()).toMatchObject({
      version: null,
      failure: expect.stringContaining("timed out after 15 s"),
    });
  }, 25_000);

  it("reports a missing executable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bb-pi-missing-"));
    temporaryDirectories.push(root);
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, path.join(root, "missing-pi"));
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
    expect(await probePiVersion()).toMatchObject({
      version: null,
      failure: expect.stringContaining("exited with ENOENT"),
    });
  });

  it.skipIf(process.platform !== "win32")(
    "probes a Pi .cmd shim on PATH and passes the install gate",
    async () => {
      mark("shim:start");
      const root = await mkdtemp(path.join(os.tmpdir(), "bb pi version-"));
      mark("shim:directory", root);
      temporaryDirectories.push(root);
      const pkg = path.join(
        root,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
      );
      await mkdir(pkg, { recursive: true });
      await writeFile(
        path.join(pkg, "package.json"),
        JSON.stringify({ bin: { pi: "cli.cjs" } }),
      );
      mark("copy:start", process.execPath);
      await copyFile(process.execPath, path.join(root, "node.exe"));
      mark("copy:end");
      const cli = path.join(pkg, "cli.cjs");
      await writeFile(
        cli,
        `const fs = require("node:fs"); const record = stage => fs.appendFileSync(${JSON.stringify(evidencePath)}, JSON.stringify({stage, pid:process.pid,time:Date.now(),execPath:process.execPath})+"\\n"); record("cli:start"); process.on("exit",()=>record("cli:exit")); if (process.argv[2] !== "--version") process.exit(2); process.stdout.write("0.85.1\\n");`,
      );
      await writeFile(
        path.join(root, "pi.cmd"),
        npmNodeShim("node_modules\\@earendil-works\\pi-coding-agent\\cli.cjs"),
      );
      await writeFile(path.join(root, "pi"), "#!/bin/sh\nexit 1\n");
      vi.stubEnv("PATH", `${root}${path.delimiter}${process.env.PATH ?? ""}`);
      vi.stubEnv(PI_BRIDGE_COMMAND_ENV, "pi");
      vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
      mark("probe:start");
      expect(await probePiVersion()).toEqual({
        version: "0.85.1",
        failure: null,
      });
      mark("probe:end");
      mark("gate:start");
      expect(await getPiInstallGate()).toEqual({
        ok: true,
        installedVersion: "0.85.1",
      });
      mark("gate:end");
      mark("status:start");
      expect(await getPiProviderInstallationStatus(false)).toMatchObject({
        executablePath: path.join(root, "pi.cmd"),
        currentVersion: "0.85.1",
      });
      mark("status:end");
    },
  );
});
