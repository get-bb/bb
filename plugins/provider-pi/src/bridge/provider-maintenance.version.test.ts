import { ChildProcess } from "node:child_process";
import { channel } from "node:diagnostics_channel";
import { experimental_killPortableProcess } from "@get-bb/plugin-sdk/provider-bridge";
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
const shimChildren: Array<{ child: ChildProcess; closed: Promise<void> }> = [];
const childProcessChannel = channel("child_process");
const trackShimChild = (message: unknown): void => {
  if (
    typeof message === "object" &&
    message !== null &&
    "process" in message &&
    message.process instanceof ChildProcess
  ) {
    const child = message.process;
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    shimChildren.push({ child, closed });
  }
};

afterEach(async () => {
  childProcessChannel.unsubscribe(trackShimChild);
  await Promise.all(
    shimChildren.splice(0).map(async ({ child, closed }) => {
      if (child.exitCode === null && child.signalCode === null) {
        experimental_killPortableProcess(child, "SIGKILL");
      }
      await closed;
    }),
  );
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
    expect(await probePiVersion(process.env)).toEqual({
      version: "0.85.1",
      failure: null,
    });
    expect(await getPiInstallGate(process.env)).toEqual({
      ok: true,
      installedVersion: "0.85.1",
    });
  });

  it("reports a non-zero exit even when stdout contains a version", async () => {
    configureNodeProbe('process.stdout.write("0.85.1\\n"); process.exit(2);');
    expect(await probePiVersion(process.env)).toMatchObject({
      version: null,
      failure: expect.stringContaining("exited with 2"),
    });
  });

  it("does not interpret stderr as a successful version response", async () => {
    configureNodeProbe('process.stderr.write("0.85.1\\n");');
    expect(await probePiVersion(process.env)).toMatchObject({
      version: null,
      failure: expect.stringContaining("printed no version"),
    });
  });

  it("retains the 15 s timeout even when the child prints a version", async () => {
    configureNodeProbe(
      'process.stdout.write("0.85.1\\n"); setInterval(() => {}, 1000);',
    );
    expect(await probePiVersion(process.env)).toMatchObject({
      version: null,
      failure: expect.stringContaining("timed out after 15 s"),
    });
  }, 25_000);

  it("reports a missing executable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bb-pi-missing-"));
    temporaryDirectories.push(root);
    vi.stubEnv(PI_BRIDGE_COMMAND_ENV, path.join(root, "missing-pi"));
    vi.stubEnv(PI_BRIDGE_ARGS_ENV, "[]");
    expect(await probePiVersion(process.env)).toMatchObject({
      version: null,
      failure: expect.stringContaining("exited with ENOENT"),
    });
  });

  it.skipIf(process.platform !== "win32")(
    "probes a Pi .cmd shim on PATH and passes the install gate",
    async ({ signal }) => {
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
      await copyFile(process.execPath, path.join(root, "node.exe"));
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
      signal.throwIfAborted();
      childProcessChannel.subscribe(trackShimChild);
      expect(await getPiInstallGate(process.env)).toEqual({
        ok: true,
        installedVersion: "0.85.1",
      });
      signal.throwIfAborted();
      expect(await getPiProviderInstallationStatus(process.env, false)).toMatchObject({
        executablePath: path.join(root, "pi.cmd"),
        currentVersion: "0.85.1",
      });
    },
  );
});
