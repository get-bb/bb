import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PI_BRIDGE_ARGS_ENV, PI_BRIDGE_COMMAND_ENV } from "./rpc-child.js";
import {
  getPiInstallGate,
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
      const root = await mkdtemp(path.join(os.tmpdir(), "bb pi version-"));
      temporaryDirectories.push(root);
      const cli = path.join(root, "cli.cjs");
      await writeFile(
        cli,
        'if (process.argv[2] !== "--version") process.exit(2); process.stdout.write("0.85.1\\n");',
      );
      await writeFile(
        path.join(root, "pi.cmd"),
        `@"${process.execPath}" "${cli}" %*\r\n`,
      );
      await writeFile(path.join(root, "pi"), "#!/bin/sh\nexit 1\n");
      vi.stubEnv("PATH", `${root}${path.delimiter}${process.env.PATH ?? ""}`);
      vi.stubEnv(PI_BRIDGE_COMMAND_ENV, "pi");
      vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
      expect(await probePiVersion()).toEqual({
        version: "0.85.1",
        failure: null,
      });
      expect(await getPiInstallGate()).toEqual({
        ok: true,
        installedVersion: "0.85.1",
      });
    },
  );
});
