import { execFile, spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  claimEnvironmentLaunchPath,
  createConnection,
  getEnvironmentLaunch,
  migrate,
  saveEnvironmentLaunch,
  type EnvironmentLaunchRow,
} from "@bb/db";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import type { PluginEnvironmentProviderCreateContext } from "@get-bb/plugin-sdk/environment-provider";
import { describe, expect, it } from "vitest";
import { createRiftHostEntry } from "./host.js";
import { riftHostContract } from "./contract.js";
import plugin from "./server.js";

const exec = promisify(execFile);

async function fixture() {
  const db = createConnection(":memory:");
  migrate(db);
  const root = await realpath(await mkdtemp(join(tmpdir(), "bb-rift-claims-")));
  const source = join(root, "repo");
  const dataDir = join(root, "data");
  const alias = join(root, "alias");
  await mkdir(source);
  await mkdir(dataDir);
  await symlink(dataDir, alias);
  await exec("git", ["init", "-b", "main"], { cwd: source });
  await exec(
    "git",
    [
      "-c",
      "user.name=BB",
      "-c",
      "user.email=bb@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "initial",
    ],
    { cwd: source },
  );
  const target = join(dataDir, "workspaces", "rift-attempt", "workspace");
  const launch: EnvironmentLaunchRow = {
    threadId: "rift-thread",
    providerId: "rift",
    attempt: 1,
    phase: "creating",
    startedAt: 0,
    failedAt: null,
    failure: null,
    message: null,
    transientFailures: 0,
    pathKey: "rift-attempt",
    hostId: "host",
    path: null,
    claimPath: null,
    ownsPath: true,
    mergeBaseBranch: null,
    resource: null,
    stepText: "",
    pendingLog: "",
    replacedEnvironmentId: null,
    environmentId: null,
    request: null,
    cancelPending: false,
    selection: { machine: { type: "existing", hostId: "host" }, inputs: {} },
  };
  const competitor = {
    ...launch,
    threadId: "checkout-thread",
    providerId: "project-checkout",
    pathKey: "checkout-attempt",
  };
  saveEnvironmentLaunch(db, launch);
  saveEnvironmentLaunch(db, competitor);
  const events: string[] = [];
  let beforeCommand = async (
    _command: string,
    _args: string[],
    _cwd: string,
  ) => {};
  const host = experimental_createHostEntryHarness(
    createRiftHostEntry(async (command, args, cwd, signal) => {
      events.push(`${command} ${args.join(" ")}`);
      await beforeCommand(command, args, cwd);
      signal.throwIfAborted();
      return (await exec(command, args, { cwd, signal })).stdout.trim();
    }),
    { experimental_paths: { dataDir: alias, tempDir: join(root, "temp") } },
  );
  const { bb, harness } = createFakePluginHost({
    experimental_callHostRpc: async (call) => {
      if (call.method === "resolvePath")
        return host.experimental_call(
          "resolvePath",
          riftHostContract.resolvePath.input.parse(call.input),
        );
      if (call.method === "create")
        return host.experimental_call(
          "create",
          riftHostContract.create.input.parse(call.input),
          { signal: call.signal },
        );
      if (call.method === "remove")
        return host.experimental_call(
          "remove",
          riftHostContract.remove.input.parse(call.input),
          { signal: call.signal },
        );
      throw new Error(`Unexpected method ${call.method}`);
    },
  });
  await plugin(bb);
  const provider = harness.registrations.environmentProviders.get("rift");
  if (provider === undefined) throw new Error("Missing Rift provider");
  const context: PluginEnvironmentProviderCreateContext = {
    thread: makeThreadResponse({ id: launch.threadId }),
    project: {
      id: "project",
      kind: "standard",
      name: "test",
      gitRemoteUrl: null,
      createdAt: 0,
      updatedAt: 0,
    },
    host: {
      id: "host",
      name: "test",
      machineProviderId: null,
      machineProviderSelection: null,
      lifecycle: {
        phase: "active",
        suspendedAt: null,
        retireAt: null,
        progress: null,
        teardown: null,
      },
      status: "connected",
      maxPermissionMode: "full",
      lastSeenAt: null,
      lastRejectedProtocolVersion: null,
      createdAt: 0,
      updatedAt: 0,
    },
    projectCheckout: { path: source },
    gitRemote: null,
    inputs: { branch: { kind: "default" }, copy: "all" },
    suggestedBranchName: "bb/rift",
    attempt: 1,
    pathKey: launch.pathKey,
    rebuild: false,
    previous: null,
    experimental_claimPath: async (path) => {
      events.push("claim");
      expect(path).toBe(target);
      return claimEnvironmentLaunchPath(db, launch, path);
    },
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
  };
  const remove = async () => {
    const row = getEnvironmentLaunch(db, launch.threadId);
    if (row === null) throw new Error("Missing launch");
    return provider.remove({
      environment: null,
      hostId: row.hostId,
      path: row.path,
      pathKey: row.pathKey,
      resource: null,
      attempt: row.attempt,
      report: context.report,
      signal: new AbortController().signal,
    });
  };
  return {
    db,
    launch,
    competitor,
    target,
    source,
    context,
    provider,
    events,
    remove,
    beforeCommand: (fn: typeof beforeCommand) => {
      beforeCommand = fn;
    },
    dispose: async () => {
      await host.experimental_dispose();
      await harness.lifecycle.dispose();
      db.$client.close();
      await exec("rift", ["remove", "-f", source]).catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe("Rift path admission with real launch transactions", () => {
  it("refuses a competitor's path before any copy, branch change or failure cleanup", async () => {
    const f = await fixture();
    try {
      await mkdir(f.target, { recursive: true });
      await exec("git", ["init", "-b", "competing"], { cwd: f.target });
      await writeFile(join(f.target, "sentinel"), "competitor");
      expect(claimEnvironmentLaunchPath(f.db, f.competitor, f.target)).toBe(
        true,
      );
      expect(await f.provider.create(f.context)).toMatchObject({
        status: "failed",
        failure: "terminal",
      });
      expect(await f.remove()).toEqual({ status: "removed" });
      expect(f.events).toEqual(["claim"]);
      expect(await readFile(join(f.target, "sentinel"), "utf8")).toBe(
        "competitor",
      );
      expect(
        (
          await exec("git", ["branch", "--show-current"], { cwd: f.target })
        ).stdout.trim(),
      ).toBe("competing");
      expect(getEnvironmentLaunch(f.db, f.competitor.threadId)?.claimPath).toBe(
        f.target,
      );
      expect(
        getEnvironmentLaunch(f.db, f.launch.threadId)?.claimPath,
      ).toBeNull();
    } finally {
      await f.dispose();
    }
  });

  it.runIf(spawnSync("rift", ["--help"]).status === 0)(
    "excludes a checkout between copying and branch mutation and throughout its own failed cleanup",
    async () => {
      const f = await fixture();
      try {
        let competed = false;
        f.beforeCommand(async (command, args, cwd) => {
          if (command === "git" && args[0] === "checkout" && cwd === f.target) {
            competed = true;
            await access(join(f.target, ".git"));
            expect(
              getEnvironmentLaunch(f.db, f.launch.threadId)?.claimPath,
            ).toBe(f.target);
            expect(
              claimEnvironmentLaunchPath(f.db, f.competitor, f.target),
            ).toBe(false);
            throw new Error("branch setup failed");
          }
          if (command === "rift" && args[0] === "remove") {
            expect(
              claimEnvironmentLaunchPath(f.db, f.competitor, f.target),
            ).toBe(false);
          }
        });
        expect(await f.provider.create(f.context)).toMatchObject({
          status: "failed",
        });
        expect(competed).toBe(true);
        expect(f.events[0]).toBe("claim");
        expect(await f.remove()).toEqual({ status: "removed" });
        await expect(access(f.target)).rejects.toThrow();
      } finally {
        await f.dispose();
      }
    },
  );

  it
    .runIf(spawnSync("rift", ["--help"]).status === 0)
    .each(["interrupted", "completed"])(
    "reclaims before validating or repairing a %s copy on replay",
    async (state) => {
      const f = await fixture();
      try {
        const controller = new AbortController();
        if (state === "interrupted") {
          f.beforeCommand(async (command, args, cwd) => {
            if (command === "git" && args[0] === "checkout" && cwd === f.target)
              controller.abort();
          });
          await expect(
            f.provider.create({ ...f.context, signal: controller.signal }),
          ).rejects.toThrow();
          await expect(access(`${f.target}.completed`)).rejects.toThrow();
        } else {
          expect(await f.provider.create(f.context)).toMatchObject({
            status: "created",
          });
          await access(`${f.target}.completed`);
        }
        await access(f.target);
        f.events.length = 0;
        f.beforeCommand(async () => {
          expect(f.events[0]).toBe("claim");
          expect(getEnvironmentLaunch(f.db, f.launch.threadId)?.claimPath).toBe(
            f.target,
          );
          expect(claimEnvironmentLaunchPath(f.db, f.competitor, f.target)).toBe(
            false,
          );
        });
        await writeFile(
          join(f.target, "replay-sentinel"),
          "retained only if complete",
        );
        expect(await f.provider.create(f.context)).toMatchObject({
          status: "created",
        });
        expect(f.events.filter((event) => event === "claim")).toHaveLength(1);
        if (state === "completed")
          await access(join(f.target, "replay-sentinel"));
        else
          await expect(
            access(join(f.target, "replay-sentinel")),
          ).rejects.toThrow();
        expect(await f.remove()).toEqual({ status: "removed" });
      } finally {
        await f.dispose();
      }
    },
  );
});
