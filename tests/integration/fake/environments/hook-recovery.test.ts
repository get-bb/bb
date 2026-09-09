import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createConnection, getEnvironmentLaunch } from "@bb/db";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type { PluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginEnvironmentProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  runEnvironmentHook as runDaemonHook,
  cancelEnvironmentHook as cancelDaemonHook,
} from "../../../../apps/host-daemon/src/command-handlers/environment-hook.js";
import { createHarness as createDaemonHarness } from "../../../../apps/host-daemon/test/command/dispatch-helpers.js";
import { registerTestHostRpcCapture } from "../../../../apps/server/test/helpers/commands.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../../../apps/server/test/helpers/test-app.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../../../apps/server/test/helpers/seed.js";
import { toThreadResponseFromThread } from "../../../../apps/server/src/services/threads/thread-runtime-display.js";
import { setPluginEnvironmentProviderBridge } from "../../../../apps/server/src/services/plugins/plugin-environment-provider-registry.js";
import {
  askProviderLaunch,
  cancelProviderLaunch,
} from "../../../../apps/server/src/services/environments/provider-orchestration.js";
import type { TestEnvironmentProviderContext } from "../../../../apps/server/test/helpers/provider-decisions.js";

afterEach(() => setPluginEnvironmentProviderBridge(undefined));

function setup(
  harness: TestAppHarness,
  overrides: Partial<PluginEnvironmentProviderDeclaration>,
) {
  const { host, session } = seedHostSession(harness.deps, { id: "host_test" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/project",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    status: "starting",
  });
  const record = {
    pluginId: "test",
    provider: validatePluginEnvironmentProviderDeclaration({
      id: "test-provider",
      displayName: "Test",
      create: async () => ({
        status: "created",
        path: "/tmp/test",
        ownsPath: true,
      }),
      remove: async () => ({ status: "removed" }),
      ...overrides,
    }),
  };
  setPluginEnvironmentProviderBridge({
    listEnvironmentProviders: () => [record],
    getEnvironmentProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_id, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  const context: TestEnvironmentProviderContext = {
    thread: toThreadResponseFromThread(harness.deps, { thread }),
    project,
    host: makeHost({ id: host.id, name: host.name }),
    machine: { type: "existing", hostId: host.id },
    projectCheckout: null,
    gitRemote: null,
    inputs: null,
    suggestedBranchName: "bb/test",
    environment: null,
  };
  const row = () => {
    const value = getEnvironmentLaunch(harness.db, thread.id);
    if (value === null) throw new Error("Missing launch");
    return value;
  };
  return {
    host,
    session,
    thread,
    record,
    context,
    row,
    ask: () => askProviderLaunch(harness.deps, record, context, null),
    settled: async () => expect.poll(() => row().phase).not.toBe("creating"),
  };
}

it("disconnect during real setup retains the claim until daemon cancellation confirms termination", async () =>
  withTestHarness(async (harness) => {
    const path = await mkdtemp(join(tmpdir(), "bb-hook-disconnect-"));
    const options = createDaemonHarness().dispatchOptions({ dataDir: path });
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    let online = false;
    let terminated = false;
    let running: Promise<void> = Promise.resolve();
    let operationId: string | null = null;
    try {
      await writeFile(
        join(path, ".bb-env-setup.sh"),
        "echo started > started\nsleep 120\necho unsafe > completed\n",
      );
      const fixture = setup(harness, {
        create: async (context) => {
          await context.experimental_claimPath(path);
          return { status: "created", path, ownsPath: true };
        },
        remove: async () => {
          expect(terminated).toBe(true);
          return remove();
        },
      });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: async (command) => {
          if (command.kind !== "setup") {
            await runDaemonHook(command, options);
            return;
          }
          operationId = command.operationId;
          running = runDaemonHook(command, options).then(
            () => undefined,
            () => {
              terminated = true;
            },
          );
          await expect
            .poll(async () =>
              readFile(join(path, "started"), "utf8").catch(() => ""),
            )
            .toBe("started\n");
          throw new Error("simulated disconnect");
        },
        onEnvironmentHookCancel: async (operationId) => {
          if (!online) throw new Error("daemon unreachable");
          await cancelDaemonHook(
            { type: "environment.hook.cancel", operationId },
            options,
          );
        },
      });
      fixture.ask();
      await fixture.settled();
      await expect(
        cancelProviderLaunch(harness.deps, fixture.thread.id),
      ).rejects.toThrow("daemon unreachable");
      expect(remove).not.toHaveBeenCalled();
      expect(fixture.row()).toMatchObject({
        cancelPending: true,
        claimPath: path,
      });
      expect(terminated).toBe(false);
      online = true;
      await cancelProviderLaunch(harness.deps, fixture.thread.id);
      expect(terminated).toBe(true);
      expect(remove).toHaveBeenCalledOnce();
      expect(fixture.row()).toMatchObject({
        cancelPending: false,
        claimPath: null,
      });
      await expect(readFile(join(path, "completed"))).rejects.toThrow();
    } finally {
      if (operationId !== null)
        await cancelDaemonHook(
          { type: "environment.hook.cancel", operationId },
          options,
        ).catch(() => undefined);
      await running;
      await rm(path, { recursive: true, force: true });
    }
  }));

it("restores a serialized database mid-setup and reconciles one daemon operation", async () =>
  withTestHarness(async (harness) => {
    const path = await mkdtemp(join(tmpdir(), "bb-hook-restart-"));
    const options = createDaemonHarness().dispatchOptions({ dataDir: path });
    const create = vi.fn(async () => ({
      status: "created" as const,
      path,
      ownsPath: true,
    }));
    const fixture = setup(harness, { create });
    const ids: string[] = [];
    const resumes: boolean[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let restored: ReturnType<typeof createConnection> | undefined;
    try {
      await writeFile(
        join(path, ".bb-env-setup.sh"),
        "echo started >> started\nwhile [ ! -f proceed ]; do sleep 0.05; done\necho completed >> completed\n",
      );
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: async (command) => {
          ids.push(command.operationId);
          resumes.push(command.resumeOnly);
          await runDaemonHook(command, options);
          await gate;
        },
      });
      fixture.ask();
      await expect
        .poll(async () =>
          readFile(join(path, "started"), "utf8").catch(() => ""),
        )
        .toBe("started\n");
      restored = createConnection(harness.db.$client.serialize());
      const deps = { ...harness.deps, db: restored };
      askProviderLaunch(deps, fixture.record, fixture.context, null);
      await expect.poll(() => ids.length).toBe(2);
      expect(new Set(ids).size).toBe(1);
      expect(resumes).toEqual([false, true]);
      expect(create).toHaveBeenCalledOnce();
      await writeFile(join(path, "proceed"), "");
      release?.();
      await expect
        .poll(() => getEnvironmentLaunch(deps.db, fixture.thread.id)?.phase)
        .toBe("ready");
      await fixture.settled();
      expect(await readFile(join(path, "started"), "utf8")).toBe("started\n");
      expect(await readFile(join(path, "completed"), "utf8")).toBe(
        "completed\n",
      );
    } finally {
      release?.();
      for (const operationId of new Set(ids))
        await cancelDaemonHook(
          { type: "environment.hook.cancel", operationId },
          options,
        ).catch(() => undefined);
      restored?.$client.close();
      await rm(path, { recursive: true, force: true });
    }
  }));

it("retains the claim when the daemon cannot confirm whether setup started", async () =>
  withTestHarness(async (harness) => {
    const path = await mkdtemp(join(tmpdir(), "bb-hook-dropped-"));
    const options = createDaemonHarness().dispatchOptions({ dataDir: path });
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    let online = false;
    let dropped: Parameters<typeof runDaemonHook>[0] | null = null;
    try {
      await writeFile(join(path, ".bb-env-setup.sh"), "echo unsafe > marker\n");
      const fixture = setup(harness, {
        create: async (context) => {
          await context.experimental_claimPath(path);
          return { status: "created", path, ownsPath: true };
        },
        remove,
      });
      registerTestHostRpcCapture(harness.deps, {
        hostId: fixture.host.id,
        sessionId: fixture.session.id,
        onEnvironmentHook: async (command) => {
          if (command.kind === "setup") {
            dropped = command;
            throw new Error("dropped before dispatch");
          }
          await runDaemonHook(command, options);
        },
        onEnvironmentHookCancel: async (operationId) => {
          if (!online) throw new Error("daemon unreachable");
          const result = await cancelDaemonHook(
            { type: "environment.hook.cancel", operationId },
            options,
          );
          expect(result).toEqual({ status: "unknown" });
          return result;
        },
      });
      fixture.ask();
      await fixture.settled();
      await expect(
        cancelProviderLaunch(harness.deps, fixture.thread.id),
      ).rejects.toThrow("daemon unreachable");
      expect(fixture.row()).toMatchObject({
        cancelPending: true,
        claimPath: path,
      });
      expect(remove).not.toHaveBeenCalled();
      online = true;
      await expect(
        cancelProviderLaunch(harness.deps, fixture.thread.id),
      ).rejects.toThrow("outcome is unknown");
      expect(remove).not.toHaveBeenCalled();
      expect(fixture.row()).toMatchObject({
        cancelPending: true,
        claimPath: path,
      });
      if (dropped === null) throw new Error("Missing dropped command");
      await expect(runDaemonHook(dropped, options)).rejects.toThrow(
        "cancelled before dispatch",
      );
      await expect(readFile(join(path, "marker"))).rejects.toThrow();
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  }));
