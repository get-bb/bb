import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  launcherToServerMessageSchema,
  mutateAppUpdateState,
  readAppUpdateState,
  type AppUpdatePending,
  type LauncherToServerMessage,
  type NpmAppRevision,
} from "@bb/config/app-update";
import {
  createLauncherAppUpdateController,
  type LauncherServerPort,
} from "../src/app-update/launcher-controller.js";
import {
  formatNpmRevisionPackageRoot,
  NPM_REVISION_MIGRATION_JOURNAL,
  NPM_REVISION_REQUIRED_FILES,
} from "../src/app-update/npm-revision.js";
import type { RunCommand } from "../src/app-update/run-command.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-controller-"));
  scratchDirs.push(dir);
  return dir;
}

function stagePackage(args: {
  migrations: string[];
  packageRoot: string;
  version: string;
}): NpmAppRevision {
  for (const file of NPM_REVISION_REQUIRED_FILES) {
    mkdirSync(dirname(join(args.packageRoot, file)), { recursive: true });
    writeFileSync(join(args.packageRoot, file), "");
  }
  writeFileSync(
    join(args.packageRoot, "package.json"),
    JSON.stringify({ name: "bb-app", version: args.version }),
  );
  mkdirSync(dirname(join(args.packageRoot, NPM_REVISION_MIGRATION_JOURNAL)), {
    recursive: true,
  });
  writeFileSync(
    join(args.packageRoot, NPM_REVISION_MIGRATION_JOURNAL),
    JSON.stringify({ entries: args.migrations.map((tag) => ({ tag })) }),
  );
  return { kind: "npm", packageRoot: args.packageRoot, version: args.version };
}

class FakeServerPort extends EventEmitter implements LauncherServerPort {
  connected = true;
  readonly sent: LauncherToServerMessage[] = [];

  send(
    message: LauncherToServerMessage,
    callback: (error: Error | null) => void,
  ): boolean {
    this.sent.push(launcherToServerMessageSchema.parse(message));
    callback(null);
    return true;
  }

  request(requestId: string, request: unknown): void {
    this.emit("message", {
      channel: "bb-app-update/request",
      request,
      requestId,
    });
  }

  async response(requestId: string) {
    await vi.waitFor(() => {
      expect(
        this.sent.some(
          (message) =>
            message.channel === "bb-app-update/response" &&
            message.requestId === requestId,
        ),
      ).toBe(true);
    });
    return this.sent.find(
      (message) =>
        message.channel === "bb-app-update/response" &&
        message.requestId === requestId,
    );
  }

  statuses() {
    return this.sent.flatMap((message) =>
      message.channel === "bb-app-update/status" ? [message.status] : [],
    );
  }
}

const failingRunner: RunCommand = async () => ({
  code: 1,
  outputTail: ["npm error 404 Not Found - bb-app@1.1.0"],
  signal: null,
  stdout: "",
});

function setUp(
  args: {
    currentMigrations?: string[];
    runner?: RunCommand;
    stageTarget?: boolean;
    targetMigrations?: string[];
  } = {},
) {
  const dataDir = scratchDir();
  const dbPath = join(dataDir, "bb.db");
  writeFileSync(dbPath, "database");
  const current = stagePackage({
    migrations: args.currentMigrations ?? ["0001_a"],
    packageRoot: join(dataDir, "npx", "bb-app"),
    version: "1.0.0",
  });
  if (args.stageTarget !== false) {
    stagePackage({
      migrations: args.targetMigrations ?? ["0001_a"],
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
  }
  const shutdowns: string[] = [];
  let fullStackRunning = true;
  const controller = createLauncherAppUpdateController({
    current,
    dataDir,
    dbPath,
    isFullStackRunning: () => fullStackRunning,
    log: () => undefined,
    mode: "npm",
    probationMaxExits: 3,
    probationMs: 30,
    repoRoot: null,
    requestShutdown: (message) => shutdowns.push(message),
    restartNoticeMs: 0,
    runner: args.runner ?? failingRunner,
  });
  const port = new FakeServerPort();
  controller.attachServer(port);
  return {
    controller,
    current,
    dataDir,
    dbPath,
    port,
    setFullStackRunning: (running: boolean) => {
      fullStackRunning = running;
    },
    shutdowns,
  };
}

function applyRequest() {
  return {
    target: { kind: "npm", version: "1.1.0" },
    targetVersion: "1.1.0",
    type: "apply",
  };
}

async function stageAndRestart(port: FakeServerPort): Promise<void> {
  port.request("apply", applyRequest());
  await vi.waitFor(() =>
    expect(port.statuses().at(-1)?.activity.phase).toBe("ready"),
  );
  port.request("restart", { type: "restart" });
  expect(await port.response("restart")).toMatchObject({ error: null });
}

describe("launcher app update controller", () => {
  it("stages, waits for the restart decision, and records the switch only after stopping", async () => {
    const { controller, dataDir, port, shutdowns } = setUp();

    await stageAndRestart(port);
    await vi.waitFor(() => expect(shutdowns).toHaveLength(1));

    expect(port.statuses().map((status) => status.activity.phase)).toEqual(
      expect.arrayContaining(["preparing", "ready", "restarting"]),
    );
    expect((await readAppUpdateState(dataDir)).pending).toBeNull();
    expect(await controller.finalizeExit()).toBe(75);
    expect((await readAppUpdateState(dataDir)).pending).toMatchObject({
      databaseBackupDir: null,
      rollbackStartedAt: null,
      to: {
        packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
        version: "1.1.0",
      },
    });
  });

  it("backs up the database before recording the switch when the target adds migrations", async () => {
    const { controller, dataDir, port, shutdowns } = setUp({
      targetMigrations: ["0001_a", "0002_b"],
    });

    await stageAndRestart(port);
    await vi.waitFor(() => expect(shutdowns).toHaveLength(1));
    expect((await readAppUpdateState(dataDir)).pending).toBeNull();

    expect(await controller.finalizeExit()).toBe(75);
    const backupDir = (await readAppUpdateState(dataDir)).pending
      ?.databaseBackupDir;
    expect(readFileSync(join(backupDir ?? "", "bb.db"), "utf8")).toBe(
      "database",
    );
  });

  it("records nothing pending when bb stops before the restart decision", async () => {
    const { controller, dataDir, port, shutdowns } = setUp();

    port.request("apply", applyRequest());
    await vi.waitFor(() =>
      expect(port.statuses().at(-1)?.activity.phase).toBe("ready"),
    );
    expect(await controller.finalizeExit()).toBeNull();
    controller.dispose();

    port.request("late", { type: "restart" });
    expect(await port.response("late")).toMatchObject({
      error: "No update is waiting to restart.",
    });
    expect(shutdowns).toEqual([]);
    expect((await readAppUpdateState(dataDir)).pending).toBeNull();
  });

  it("cancels the restart when the server reports new threads", async () => {
    const { controller, dataDir, port, shutdowns } = setUp();

    port.request("apply", applyRequest());
    await vi.waitFor(() =>
      expect(port.statuses().at(-1)?.activity.phase).toBe("ready"),
    );
    port.request("cancel", {
      message: "2 threads started while bb was downloading the update.",
      type: "cancel",
    });
    await port.response("cancel");

    await vi.waitFor(async () =>
      expect((await readAppUpdateState(dataDir)).lastResult).toMatchObject({
        message: "2 threads started while bb was downloading the update.",
        outcome: "failed",
      }),
    );
    expect(shutdowns).toEqual([]);
    expect(await controller.finalizeExit()).toBeNull();
  });

  it("stops an in-flight download on shutdown without recording a failure", async () => {
    const runner: RunCommand = (call) =>
      new Promise((resolvePromise) => {
        call.signal?.addEventListener("abort", () =>
          resolvePromise({
            code: null,
            outputTail: ["Cancelled"],
            signal: "SIGTERM",
            stdout: "",
          }),
        );
      });
    const { controller, dataDir, port } = setUp({ runner, stageTarget: false });

    port.request("apply", applyRequest());
    await vi.waitFor(() =>
      expect(port.statuses().at(-1)?.activity.phase).toBe("preparing"),
    );
    controller.dispose();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));

    const state = await readAppUpdateState(dataDir);
    expect(state.lastResult).toBeNull();
    expect(state.pending).toBeNull();
  });

  it("keeps running and records the failure when the download fails", async () => {
    const { controller, dataDir, port, shutdowns } = setUp({
      stageTarget: false,
    });

    port.request("r1", applyRequest());
    await vi.waitFor(async () =>
      expect((await readAppUpdateState(dataDir)).lastResult?.outcome).toBe(
        "failed",
      ),
    );

    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({ phase: "install" });
    expect(state.lastResult?.message).toContain("npm install failed");
    expect(shutdowns).toEqual([]);
    await vi.waitFor(() =>
      expect(port.statuses().at(-1)?.activity.phase).toBe("idle"),
    );
    expect(await controller.finalizeExit()).toBeNull();
  });

  it("keeps the current version and records nothing pending when the database backup fails", async () => {
    const { controller, dataDir, port, shutdowns } = setUp({
      targetMigrations: ["0001_a", "0002_b"],
    });
    writeFileSync(join(dataDir, "app-update-backups"), "not a directory");

    await stageAndRestart(port);
    await vi.waitFor(() => expect(shutdowns).toHaveLength(1));

    expect(await controller.finalizeExit()).toBe(75);
    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({
      outcome: "failed",
      phase: "prepare",
    });
  });

  it("refuses a second update while one is in flight", async () => {
    const { port } = setUp();

    port.request("r1", applyRequest());
    port.request("r2", applyRequest());

    expect(await port.response("r2")).toMatchObject({
      error: "An update is already in progress.",
    });
  });

  it("marks the new version updated, then confirms it after probation", async () => {
    const dataDir = scratchDir();
    const from: NpmAppRevision = {
      kind: "npm",
      packageRoot: join(dataDir, "old"),
      version: "1.0.0",
    };
    const current: NpmAppRevision = {
      kind: "npm",
      packageRoot: join(dataDir, "new"),
      version: "1.1.0",
    };
    const backupDir = join(dataDir, "app-update-backups", "update-1");
    const orphanedBackupDir = join(dataDir, "app-update-backups", "leaked");
    mkdirSync(backupDir, { recursive: true });
    mkdirSync(orphanedBackupDir, { recursive: true });
    const pending: AppUpdatePending = {
      databaseBackupDir: backupDir,
      failure: null,
      from,
      healthyAt: null,
      id: "update-1",
      requestedAt: "2026-09-23T00:00:00.000Z",
      rollbackStartedAt: null,
      to: current,
    };
    await mutateAppUpdateState(dataDir, (state) => ({ ...state, pending }));
    const port = new FakeServerPort();
    const controller = createLauncherAppUpdateController({
      current,
      dataDir,
      dbPath: join(dataDir, "bb.db"),
      isFullStackRunning: () => true,
      log: () => undefined,
      mode: "npm",
      probationMs: 20,
      repoRoot: null,
      requestShutdown: () => undefined,
      restartNoticeMs: 0,
      runner: failingRunner,
    });
    controller.attachServer(port);

    await controller.onFullStackReady();
    const healthy = await readAppUpdateState(dataDir);
    expect(healthy.lastResult).toMatchObject({
      id: "update-1",
      outcome: "updated",
    });
    expect(healthy.pending?.healthyAt).not.toBeNull();
    expect(port.statuses().at(-1)?.probation).toBe(true);

    await vi.waitFor(async () =>
      expect((await readAppUpdateState(dataDir)).pending).toBeNull(),
    );
    expect(existsSync(backupDir)).toBe(false);
    expect(existsSync(orphanedBackupDir)).toBe(false);
    controller.dispose();
  });

  it("fails probation after repeated crashes and asks the shim to roll back", async () => {
    const dataDir = scratchDir();
    const current: NpmAppRevision = {
      kind: "npm",
      packageRoot: join(dataDir, "new"),
      version: "1.1.0",
    };
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      pending: {
        databaseBackupDir: null,
        failure: null,
        from: {
          kind: "npm",
          packageRoot: join(dataDir, "old"),
          version: "1.0.0",
        },
        healthyAt: null,
        id: "update-1",
        requestedAt: "2026-09-23T00:00:00.000Z",
        rollbackStartedAt: null,
        to: current,
      },
    }));
    const shutdowns: string[] = [];
    const controller = createLauncherAppUpdateController({
      current,
      dataDir,
      dbPath: join(dataDir, "bb.db"),
      isFullStackRunning: () => true,
      log: () => undefined,
      mode: "npm",
      probationMaxExits: 3,
      probationMs: 60_000,
      repoRoot: null,
      requestShutdown: (message) => shutdowns.push(message),
      restartNoticeMs: 0,
      runner: failingRunner,
    });

    await controller.onFullStackReady();
    expect(await controller.onManagedProcessExit()).toBe("continue");
    expect(await controller.onManagedProcessExit()).toBe("continue");
    expect(await controller.onManagedProcessExit()).toBe("probation-failed");

    expect(shutdowns).toHaveLength(1);
    expect((await readAppUpdateState(dataDir)).pending?.failure).toMatchObject({
      phase: "probation",
    });
    expect(await controller.finalizeExit()).toBe(76);
    controller.dispose();
  });

  it("ignores managed process exits outside probation", async () => {
    const { controller } = setUp();

    await controller.onFullStackReady();

    expect(await controller.onManagedProcessExit()).toBe("continue");
    expect(await controller.onManagedProcessExit()).toBe("continue");
    expect(await controller.onManagedProcessExit()).toBe("continue");
  });

  it("acknowledges the last result on request", async () => {
    const { dataDir, port, current } = setUp();
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      lastResult: {
        acknowledged: false,
        finishedAt: "2026-09-23T00:00:00.000Z",
        from: current,
        id: "result-1",
        logTail: [],
        message: "boom",
        outcome: "rolled-back",
        phase: "startup",
        to: current,
      },
    }));

    port.request("r1", { id: "result-1", type: "acknowledge-result" });
    await port.response("r1");

    expect((await readAppUpdateState(dataDir)).lastResult?.acknowledged).toBe(
      true,
    );
    expect(port.statuses().at(-1)?.lastResult?.acknowledged).toBe(true);
  });
});
