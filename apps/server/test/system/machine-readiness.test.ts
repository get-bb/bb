import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hosts, machineWorkspaceSetups } from "@bb/db";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { ensureHostReady } from "../../src/services/machines/readiness.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { setPluginAgentContributions } from "../../src/services/plugins/plugin-agent-contributions.js";
import { withTestHarness } from "../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";

it("serializes installation and setup, checks outputs, and invalidates on lockfile, ABI and auth changes", async () => {
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
    let installCount = 0;
    let setupCount = 0;
    let lock = "a";
    let abi = "linux/x64/node-127";
    let dirty: string[] = [];
    let route = true;
    let reachable = true;
    let outputs = false;
    let observedToken = "";
    let token = "first-token";
    const provider = validatePluginMachineProviderDeclaration({
      id: "fixture-machine",
      displayName: "Fixture",
      policy: {
        idleSuspendMs: null,
        retire: { after: "never" },
        removeRetryMs: 1000,
      },
      create: async () => ({
        status: "failed",
        failure: "terminal",
        message: "unused",
      }),
      remove: async () => ({ status: "removed" }),
      experimental_reconcileCleanup: async () => ({ status: "removed" }),
      experimental_workspaceSetup: async () => ({
        scriptText: "install-dependencies",
        scriptHash: "script",
        cacheManifest: {},
        checks: ["check-dependencies"],
      }),
    });
    const record = { pluginId: "fixture", provider };
    setPluginMachineProviderBridge({
      listMachineProviders: () => [record],
      getMachineProvider: () => record,
      invokeProvider: async (_id, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 1000,
    });
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
      handle: async ({ command }) => {
        switch (command.type) {
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
          case "workspace.readiness.run":
            if (command.script === "install-dependencies") {
              setupCount++;
              outputs = true;
            }
            return { ok: true, result: { exitCode: outputs ? 0 : 1 } };
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
      expect(await Promise.all([ready(), ready()])).toEqual([
        expect.objectContaining({ status: "ready" }),
        expect.objectContaining({ status: "ready" }),
      ]);
      expect(installCount).toBe(1);
      expect(setupCount).toBe(1);
      expect(
        harness.deps.db.select().from(machineWorkspaceSetups).all(),
      ).toHaveLength(1);
      token = "rotated-token";
      expect((await ready()).status).toBe("ready");
      expect(observedToken).toBe(token);
      expect(setupCount).toBe(1);
      outputs = false;
      await ready();
      expect(setupCount).toBe(2);
      lock = "b";
      dirty = [" M package-lock.json"];
      expect(await ready()).toMatchObject({
        status: "blocked",
        code: "dirty_checkout",
      });
      expect(setupCount).toBe(2);
      dirty = [];
      await ready();
      abi = "linux/arm64/node-127";
      await ready();
      expect(setupCount).toBe(4);
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
      setPluginMachineProviderBridge(undefined);
      setPluginAgentContributions(undefined);
    }
  });
});
