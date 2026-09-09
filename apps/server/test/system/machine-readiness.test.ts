import {
  beginMachineRestoreSetup,
  runMachineRestoreSetup,
} from "../../src/services/machines/restore-setup.js";
import { runEnvironmentHook } from "../../src/services/environments/environment-hooks.js";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  hosts,
  projectSources,
  environmentSetupOutcomes,
  createEnvironment,
  machineLifecycles,
  environmentHookOperations,
} from "@bb/db";
import {
  beginEnvironmentSetupOutcome,
  finishEnvironmentSetupOutcome,
} from "../../src/services/environments/setup-outcomes.js";
import { ensureHostReady } from "../../src/services/machines/readiness.js";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import { withTestHarness } from "../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";

it("serializes CLI installation and reads fenced core hook outcomes across lockfile, ABI and auth changes", async () => {
  await withTestHarness(async (harness) => {
    const { host, session } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    harness.deps.db
      .update(hosts)
      .set({ machineProviderId: "fixture-machine", resource: {} })
      .where(eq(hosts.id, host.id))
      .run();
    let installed = false;
    let hookRuns = 0;
    let hookFails = false;
    let installCount = 0;
    let lock = "a";
    let abi = "linux/x64/node-127";
    let dirty: string[] = [];
    let route = true;
    let reachable = true;
    let observedToken = "";
    let token = "first-token";
    harness.deps.db
      .update(projectSources)
      .set({ ownsPath: true })
      .where(eq(projectSources.projectId, project.id))
      .run();
    setPluginAgentContributions({
      listSkillRootContributions: () => [],
      listAgentTools: () => [],
      listInstructionContributions: () => [],
      findAgentTool: () => undefined,
      invokeAgentTool: async () => ({ success: false, contentItems: [] }),
      resolveMention: async () => ({ ok: false, error: "unused" }),
      resolveProviderEnvHealth: async () =>
        route
          ? {
              label: "Pool",
              statusMessage: "Routed",
              experimental_probe: {
                serverPath: "/pool/check",
                headers: { authorization: token },
              },
            }
          : null,
      resolveProviderEnv: async () => ({ entries: [] }),
    });
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: async ({ command }): Promise<HostRpcHandlerResult> => {
        switch (command.type) {
          case "environment.hook.run":
            hookRuns++;
            return hookFails
              ? {
                  ok: false,
                  errorCode: "setup_failed",
                  errorMessage: "Service failed to start",
                }
              : { ok: true, result: {} };
          case "environment.hook.cancel":
            return { ok: true, result: { status: "terminated" } };
          case "provider.installation.status":
            return {
              ok: true,
              result: {
                executableName: "codex",
                executablePath: installed ? "/bin/codex" : null,
                installed,
                installSource: installed ? "npmGlobal" : "notInstalled",
                currentVersion: installed ? "1.0.0" : null,
                latestVersion: "1.0.0",
                minimumSupportedVersion: "1.0.0",
                npmPackageName: "codex",
                npmGlobalPackageVersion: null,
                installAction: installed
                  ? null
                  : { kind: "install", label: "Install", command: "install" },
                needsUpdate: false,
                versionUnsupported: false,
              },
            };
          case "provider.installation.run":
            installed = true;
            installCount++;
            return {
              ok: true,
              result: {
                events: [
                  {
                    type: "completed",
                    provider: "codex",
                    exitCode: 0,
                    signal: null,
                    success: true,
                  },
                ],
              },
            };
          case "host.readiness.probe":
            observedToken = command.headers.authorization!;
            return {
              ok: true,
              result: { reachable, status: reachable ? 200 : 401 },
            };
          case "provider.health":
            return {
              ok: true,
              result: {
                supported: true,
                health: {
                  status: "unauthenticated",
                  statusMessage: null,
                  accountEmail: null,
                  planLabel: null,
                  installedVersion: "1.0.0",
                  minimumSupportedVersion: "1.0.0",
                  canInstall: false,
                  canUpdate: false,
                  loginCommand: "login",
                },
              },
            };
          case "workspace.readiness.inspect":
            return {
              ok: true,
              result: {
                commit: "commit",
                dirty,
                files: [{ path: "package-lock.json", sha256: lock }],
                abi,
              },
            };
          default:
            throw new Error(`Unexpected ${command.type}`);
        }
      },
    });
    try {
      const args = {
        hostId: host.id,
        projectId: project.id,
        providerId: "codex",
        threadId: null,
        path: "/tmp/test-project",
      };
      const ready = () => ensureHostReady(harness.deps, args);
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_required",
      });
      const identity = {
        hostId: host.id,
        path: args.path,
        operationId: "setup-1",
      };
      const recordSetup = async (operationId: string) => {
        await beginEnvironmentSetupOutcome(harness.deps, {
          ...identity,
          operationId,
        });
        await finishEnvironmentSetupOutcome(harness.deps, {
          ...identity,
          operationId,
          succeeded: true,
        });
      };
      await recordSetup("setup-1");
      expect(await Promise.all([ready(), ready()])).toEqual([
        expect.objectContaining({ status: "ready" }),
        expect.objectContaining({ status: "ready" }),
      ]);
      expect(installCount).toBe(1);
      token = "rotated-token";
      expect((await ready()).status).toBe("ready");
      expect(observedToken).toBe(token);
      lock = "b";
      dirty = [" M package-lock.json"];
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "dirty_checkout",
      });
      dirty = [];
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_stale",
      });
      await recordSetup("setup-2");
      expect((await ready()).status).toBe("ready");
      abi = "linux/arm64/node-127";
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_stale",
      });
      await beginEnvironmentSetupOutcome(harness.deps, {
        ...identity,
        operationId: "old",
      });
      await beginEnvironmentSetupOutcome(harness.deps, {
        ...identity,
        operationId: "new",
      });
      await finishEnvironmentSetupOutcome(harness.deps, {
        ...identity,
        operationId: "old",
        succeeded: true,
      });
      expect(
        harness.deps.db
          .select()
          .from(environmentSetupOutcomes)
          .where(eq(environmentSetupOutcomes.hostId, host.id))
          .get(),
      ).toMatchObject({ operationId: "new", state: "running" });
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_required",
      });
      await finishEnvironmentSetupOutcome(harness.deps, {
        ...identity,
        operationId: "new",
        succeeded: false,
      });
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_failed",
      });
      await recordSetup("setup-3");
      expect((await ready()).status).toBe("ready");
      reachable = false;
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "credential_route_unreachable",
      });
      route = false;
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "credentials_required",
      });
      route = true;
      reachable = true;
      createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: args.path,
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: null,
      });
      harness.db
        .insert(machineLifecycles)
        .values({
          hostId: host.id,

          recoveryState: "healthy",
          restoreOperationId: "restored-once",
        })
        .run();
      expect(
        (await Promise.all([ready(), ready()])).map((x) => x.status),
      ).toEqual(["ready", "ready"]);
      expect(hookRuns).toBe(1);
      expect((await ready()).status).toBe("ready");
      expect(hookRuns).toBe(1);
      hookFails = true;
      harness.db
        .update(machineLifecycles)
        .set({ restoreOperationId: "restored-again" })
        .where(eq(machineLifecycles.hostId, host.id))
        .run();
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_failed",
      });
      expect(hookRuns).toBe(2);
      expect(
        harness.db.select().from(environmentHookOperations).all(),
      ).toHaveLength(2);
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "setup_failed",
      });
      expect(hookRuns).toBe(2);
      expect(
        await ensureHostReady(harness.deps, {
          ...args,
          threadId: "bypassed-thread",
        }),
      ).toMatchObject({
        status: "blocked",
        code: "credential_route_unavailable",
      });
    } finally {
      setPluginAgentContributions(undefined);
    }
  });
});

it("limits restore setup to the persisted generation and does not rerun creation setup for later worktrees", async () =>
  withTestHarness(async (h) => {
    const { host, session } = seedHostSession(h.deps);
    const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
    const runs: string[] = [];
    registerHostRpcResponder(h, {
      hostId: host.id,
      sessionId: session.id,
      handle: async ({ command }): Promise<HostRpcHandlerResult> => {
        if (command.type === "workspace.readiness.inspect")
          return {
            ok: true,
            result: {
              commit: "a".repeat(40),
              dirty: [],
              files: [],
              abi: "linux/x64/node-127",
            },
          };
        if (command.type === "environment.hook.run") {
          runs.push(command.path);
          return { ok: true, result: {} };
        }
        throw new Error(`Unexpected RPC ${command.type}`);
      },
    });
    const original = createEnvironment(h.db, h.hub, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/old-checkout",
      providerOwnsPath: true,
      status: "ready",
    });
    h.db
      .insert(machineLifecycles)
      .values({
        hostId: host.id,

        recoveryState: "healthy",
      })
      .run();
    beginMachineRestoreSetup(h.deps, host.id, "earlier-resume");
    const pending = h.db.select().from(machineLifecycles).get();
    expect(pending?.restoreCheckouts).toEqual([
      { id: original.id, path: "/tmp/old-checkout" },
    ]);
    await runEnvironmentHook(h.deps, {
      id: "new-environment-normal-setup",
      hostId: host.id,
      path: "/tmp/new-worktree",
      kind: "setup",
      resumeOnly: false,
      report: { step() {}, log() {} },
      signal: AbortSignal.timeout(10_000),
    });
    createEnvironment(h.db, h.hub, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/new-worktree",
      providerOwnsPath: true,
      status: "ready",
    });
    await Promise.all([
      runMachineRestoreSetup(h.deps, host.id),
      runMachineRestoreSetup(h.deps, host.id),
    ]);
    expect(runs).toEqual(["/tmp/new-worktree", "/tmp/old-checkout"]);
    expect(h.db.select().from(machineLifecycles).get()).toMatchObject({
      restoreOperationId: null,
      restoreCheckouts: null,
    });
    await runMachineRestoreSetup(h.deps, host.id);
    expect(runs).toHaveLength(2);
  }));
