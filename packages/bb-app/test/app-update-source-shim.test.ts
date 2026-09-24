import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  mutateAppUpdateState,
  readAppUpdateState,
  type AppUpdatePending,
} from "@bb/config/app-update";
import type { ChildProcessExitResult } from "@bb/config/child-process-exit";
import { runCommand } from "../src/app-update/run-command.js";
import { runSourceShim } from "../src/app-update/source-shim.js";
import type {
  AcquireShimLock,
  LauncherRun,
  LauncherUpdateMode,
  ShimOutput,
} from "../src/app-update/shim-support.js";
import {
  createGitCheckout,
  git,
  publish,
  writeRepoFile,
  type GitCheckoutFixture,
} from "./app-update-git-fixture.js";

const fixtures: GitCheckoutFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

interface SourceUpdateSetup {
  checkout: string;
  dataDir: string;
  from: string;
  pending: AppUpdatePending;
  to: string;
}

async function setUpIncomingCommit(): Promise<SourceUpdateSetup> {
  const fixture = await createGitCheckout();
  fixtures.push(fixture);
  const from = await git(fixture.checkout, "rev-parse", "HEAD");
  const to = await publish(fixture.upstream, "1.1.0", "Add feature");
  await git(fixture.checkout, "fetch", "-q", "origin", "main");
  const dataDir = join(fixture.root, "data");
  mkdirSync(dataDir);
  return {
    checkout: fixture.checkout,
    dataDir,
    from,
    pending: {
      from: { commit: from, kind: "source", version: "1.0.0" },
      id: "update-1",
      requestedAt: "2026-09-23T00:00:00.000Z",
      to: { commit: to, kind: "source", version: "1.1.0" },
    },
    to,
  };
}

type LaunchStep = () => Promise<ChildProcessExitResult>;

function scriptedLauncher(checkout: string, steps: LaunchStep[]) {
  const launchedHeads: string[] = [];
  const modes: LauncherUpdateMode[] = [];
  return {
    launchedHeads,
    modes,
    spawnLauncher: (mode: LauncherUpdateMode): LauncherRun => {
      modes.push(mode);
      const step = steps.shift();
      if (step === undefined) throw new Error("Unexpected launch");
      const exit = (async () => {
        launchedHeads.push(await git(checkout, "rev-parse", "HEAD"));
        return step();
      })();
      return { exit, kill: () => undefined };
    },
  };
}

function output(): ShimOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    error: (message) => lines.push(`error: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    lines,
    warn: (message) => lines.push(`warn: ${message}`),
  };
}

function shimArgs(args: {
  acquireLock?: AcquireShimLock;
  checkout: string;
  dataDir: string;
  installDependencies?: () => Promise<void>;
  output?: ShimOutput;
  prepareRuntime?: () => Promise<void>;
  readHead?: () => Promise<string>;
  spawnLauncher: (mode: LauncherUpdateMode) => LauncherRun;
}) {
  return {
    ...(args.acquireLock === undefined
      ? {}
      : { acquireLock: args.acquireLock }),
    dataDir: args.dataDir,
    installDependencies: args.installDependencies ?? (async () => undefined),
    output: args.output ?? output(),
    prepareRuntime: args.prepareRuntime ?? (async () => undefined),
    readHead: args.readHead ?? (() => git(args.checkout, "rev-parse", "HEAD")),
    repoRoot: args.checkout,
    runner: runCommand,
    spawnLauncher: args.spawnLauncher,
  };
}

describe("runSourceShim", () => {
  it("fast-forwards, reinstalls, rebuilds, and relaunches on a requested update", async () => {
    const setup = await setUpIncomingCommit();
    const calls: string[] = [];
    const launcher = scriptedLauncher(setup.checkout, [
      async () => {
        await mutateAppUpdateState(setup.dataDir, (state) => ({
          ...state,
          pending: setup.pending,
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      async () => ({ code: 0, signal: null }),
    ]);

    const code = await runSourceShim(
      shimArgs({
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        installDependencies: async () => {
          calls.push("install");
        },
        prepareRuntime: async () => {
          calls.push("build");
        },
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(code).toBe(0);
    expect(launcher.launchedHeads).toEqual([setup.from, setup.to]);
    expect(calls).toEqual(["install", "build"]);
  });

  it("stops on the new commit and keeps the pending update when the rebuild fails", async () => {
    const setup = await setUpIncomingCommit();
    const shimOutput = output();
    const launcher = scriptedLauncher(setup.checkout, [
      async () => {
        await mutateAppUpdateState(setup.dataDir, (state) => ({
          ...state,
          pending: setup.pending,
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
    ]);

    const code = await runSourceShim(
      shimArgs({
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        output: shimOutput,
        prepareRuntime: async () => {
          throw new Error("turbo build failed");
        },
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(code).toBe(1);
    expect(launcher.launchedHeads).toEqual([setup.from]);
    expect(await git(setup.checkout, "rev-parse", "HEAD")).toBe(setup.to);
    expect((await readAppUpdateState(setup.dataDir)).pending?.id).toBe(
      "update-1",
    );
    expect(shimOutput.lines).toContainEqual(
      expect.stringContaining("turbo build failed"),
    );
  });

  it("keeps the current commit when the checkout changed before the restart", async () => {
    const setup = await setUpIncomingCommit();
    const launcher = scriptedLauncher(setup.checkout, [
      async () => {
        await mutateAppUpdateState(setup.dataDir, (state) => ({
          ...state,
          pending: setup.pending,
        }));
        writeRepoFile(setup.checkout, "packages/bb-app/package.json", "{}\n");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      async () => ({ code: 0, signal: null }),
    ]);

    await runSourceShim(
      shimArgs({
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(launcher.launchedHeads).toEqual([setup.from, setup.from]);
    const state = await readAppUpdateState(setup.dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({
      outcome: "failed",
      phase: "install",
    });
  });

  it("leaves a pending update found at startup to the launcher", async () => {
    const setup = await setUpIncomingCommit();
    await mutateAppUpdateState(setup.dataDir, (state) => ({
      ...state,
      pending: setup.pending,
    }));
    const launcher = scriptedLauncher(setup.checkout, [
      async () => ({ code: 0, signal: null }),
    ]);

    await runSourceShim(
      shimArgs({
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(launcher.launchedHeads).toEqual([setup.from]);
    expect((await readAppUpdateState(setup.dataDir)).pending?.id).toBe(
      "update-1",
    );
  });

  it("runs without update handling when another shim manages the data directory", async () => {
    const setup = await setUpIncomingCommit();
    await mutateAppUpdateState(setup.dataDir, (state) => ({
      ...state,
      pending: setup.pending,
    }));
    const launcher = scriptedLauncher(setup.checkout, [
      async () => ({ code: 1, signal: null }),
    ]);

    await runSourceShim(
      shimArgs({
        acquireLock: async () => null,
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(launcher.modes).toEqual(["passive"]);
    expect((await readAppUpdateState(setup.dataDir)).pending?.id).toBe(
      "update-1",
    );
  });

  it("does not need git when nothing is pending", async () => {
    const setup = await setUpIncomingCommit();
    const launcher = scriptedLauncher(setup.checkout, [
      async () => ({ code: 3, signal: null }),
    ]);

    const code = await runSourceShim(
      shimArgs({
        checkout: setup.checkout,
        dataDir: setup.dataDir,
        readHead: async () => {
          throw new Error("not a git repository");
        },
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(code).toBe(3);
  });
});
