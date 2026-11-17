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

afterEach(async () => {
  vi.unstubAllEnvs();
  resetPiInstallGateForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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
      const phases: Array<{ phase: string; elapsedMs: number }> = [];
      let previous = performance.now();
      const mark = (phase: string): void => {
        const now = performance.now();
        phases.push({ phase, elapsedMs: Math.round(now - previous) });
        previous = now;
        console.error("PI_VERSION_TIMING", JSON.stringify(phases.at(-1)));
      };
      const root = await mkdtemp(path.join(os.tmpdir(), "bb pi version-"));
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
      mark("prepare package");
      await copyFile(process.execPath, path.join(root, "node.exe"));
      mark("copy node.exe");
      const cli = path.join(pkg, "cli.cjs");
      await writeFile(
        cli,
        'if (process.argv[2] !== "--version") process.exit(2); process.stdout.write("0.85.1\\n");',
      );
      await writeFile(
        path.join(root, "pi.cmd"),
        npmNodeShim("node_modules\\@earendil-works\\pi-coding-agent\\cli.cjs"),
      );
      await writeFile(path.join(root, "pi"), "#!/bin/sh\nexit 1\n");
      vi.stubEnv("PATH", `${root}${path.delimiter}${process.env.PATH ?? ""}`);
      vi.stubEnv(PI_BRIDGE_COMMAND_ENV, "pi");
      vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
      mark("prepare shim and env");
      expect(await probePiVersion()).toEqual({
        version: "0.85.1",
        failure: null,
      });
      mark("direct probe");
      expect(await getPiInstallGate()).toEqual({
        ok: true,
        installedVersion: "0.85.1",
      });
      mark("install gate");
      expect(await getPiProviderInstallationStatus(false)).toMatchObject({
        executablePath: path.join(root, "pi.cmd"),
        currentVersion: "0.85.1",
      });
      mark("installation status");
      throw new Error(`PI_VERSION_TIMING_COMPLETE ${JSON.stringify(phases)}`);
    },
    60_000,
  );
});
