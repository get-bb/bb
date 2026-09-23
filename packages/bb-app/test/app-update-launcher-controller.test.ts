import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatAppUpdateStatePath,
  formatAppUpdateVersionsDir,
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

function createController(args: {
  current: NpmAppRevision;
  dataDir: string;
  runner?: RunCommand | undefined;
  shutdowns?: string[];
}) {
  return createLauncherAppUpdateController({
    current: args.current,
    dataDir: args.dataDir,
    log: () => undefined,
    mode: "npm",
    repoRoot: null,
    requestShutdown: (message) => args.shutdowns?.push(message),
    restartNoticeMs: 0,
    runner: args.runner ?? failingRunner,
  });
}

function setUp(args: { runner?: RunCommand; stageTarget?: boolean } = {}) {
  const dataDir = scratchDir();
  const current = stagePackage({
    packageRoot: join(dataDir, "npx", "bb-app"),
    version: "1.0.0",
  });
  if (args.stageTarget !== false) {
    stagePackage({
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
  }
  const shutdowns: string[] = [];
  const controller = createController({
    current,
    dataDir,
    runner: args.runner,
    shutdowns,
  });
  const port = new FakeServerPort();
  controller.attachServer(port);
  return { controller, current, dataDir, port, shutdowns };
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
  it("stages, waits for the restart decision, and switches versions only after stopping", async () => {
    const { controller, current, dataDir, port, shutdowns } = setUp();
    const target = {
      kind: "npm",
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    };

    await stageAndRestart(port);
    await vi.waitFor(() => expect(shutdowns).toHaveLength(1));

    expect(port.statuses().map((status) => status.activity.phase)).toEqual(
      expect.arrayContaining(["preparing", "ready", "restarting"]),
    );
    expect(await readAppUpdateState(dataDir)).toMatchObject({
      current: null,
      pending: null,
    });
    expect(await controller.finalizeExit()).toBe(75);
    expect(await readAppUpdateState(dataDir)).toMatchObject({
      current: { ...target, nodeAbi: process.versions.modules },
      pending: { from: current, to: target },
    });
  });

  it("keeps the current version when the switch cannot be recorded", async () => {
    const { controller, dataDir, port, shutdowns } = setUp();

    await stageAndRestart(port);
    await vi.waitFor(() => expect(shutdowns).toHaveLength(1));
    writeFileSync(formatAppUpdateStatePath(dataDir), "{");

    expect(await controller.finalizeExit()).toBe(75);
    expect(readFileSync(formatAppUpdateStatePath(dataDir), "utf8")).toBe("{");
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

  it("refuses a second update while one is in flight", async () => {
    const { port } = setUp();

    port.request("r1", applyRequest());
    port.request("r2", applyRequest());

    expect(await port.response("r2")).toMatchObject({
      error: "An update is already in progress.",
    });
  });

  it("records the update and prunes older installs once the new version is healthy", async () => {
    const dataDir = scratchDir();
    const from = stagePackage({
      packageRoot: join(dataDir, "npx", "bb-app"),
      version: "1.0.0",
    });
    const stale = formatNpmRevisionPackageRoot(dataDir, "1.0.5");
    stagePackage({ packageRoot: stale, version: "1.0.5" });
    const current = stagePackage({
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
    const pending: AppUpdatePending = {
      from,
      id: "update-1",
      requestedAt: "2026-09-23T00:00:00.000Z",
      to: current,
    };
    await mutateAppUpdateState(dataDir, (state) => ({ ...state, pending }));
    const port = new FakeServerPort();
    const controller = createController({ current, dataDir });
    controller.attachServer(port);

    await controller.onFullStackReady();

    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({
      id: "update-1",
      message: null,
      outcome: "updated",
    });
    expect(port.statuses().at(-1)?.lastResult?.outcome).toBe("updated");
    expect(readdirSync(formatAppUpdateVersionsDir(dataDir))).toEqual(["1.1.0"]);
  });

  it("keeps unknown fields a newer bb added to the state file", async () => {
    const dataDir = scratchDir();
    const current = stagePackage({
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
    writeFileSync(
      formatAppUpdateStatePath(dataDir),
      JSON.stringify({
        current: null,
        futureField: { keep: true },
        lastResult: null,
        pending: {
          from: current,
          id: "update-1",
          requestedAt: "2026-09-23T00:00:00.000Z",
          to: current,
        },
        schemaVersion: 1,
      }),
    );

    await createController({ current, dataDir }).onFullStackReady();

    expect(
      JSON.parse(readFileSync(formatAppUpdateStatePath(dataDir), "utf8")),
    ).toMatchObject({ futureField: { keep: true }, pending: null });
  });

  it("records a failure when bb starts a different version than the pending update", async () => {
    const dataDir = scratchDir();
    const current = stagePackage({
      packageRoot: join(dataDir, "npx", "bb-app"),
      version: "1.0.0",
    });
    const target = stagePackage({
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      pending: {
        from: current,
        id: "update-1",
        requestedAt: "2026-09-23T00:00:00.000Z",
        to: target,
      },
    }));
    const controller = createController({ current, dataDir });

    await controller.onFullStackReady();

    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({
      message: "bb started 1.0.0 instead of 1.1.0.",
      outcome: "failed",
      phase: "startup",
    });
    expect(readdirSync(formatAppUpdateVersionsDir(dataDir))).toEqual(["1.1.0"]);
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
        outcome: "failed",
        phase: "install",
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
