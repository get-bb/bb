import { getHost, updateHost } from "@bb/db";
import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPluginMachineProviderBridge } from "../src/services/plugins/plugin-machine-provider-registry.js";
import { registerHostRpcResponder } from "./helpers/host-rpc.js";
import { readJson } from "./helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadFixture,
  seedThreadRuntimeState,
} from "./helpers/seed.js";
import { type TestAppHarness, withTestHarness } from "./helpers/test-app.js";

function installMachineProvider(harness: TestAppHarness, hostId: string) {
  const resume = vi.fn(async () => ({ resource: { id: "owned" } }));
  const record = {
    pluginId: "test-machine",
    provider: validatePluginMachineProviderDeclaration({
      description: "Provision a test machine.",
      icon: "Terminal",
      id: "test-machine",
      displayName: "Test machine",
      reconcileCleanup: async () => ({ status: "removed" }),
      create: async () => ({
        status: "created",
        name: "Test machine",
        hostId,
        resource: { id: "owned" },
      }),
      suspend: async () => ({ resource: { id: "owned" } }),
      resume,
      remove: async () => ({ status: "removed" }),
    }),
  };
  setPluginMachineProviderBridge({
    listMachineProviders: () => [record],
    getMachineProvider: () => record,
    invokeProvider: async (_pluginId, _label, run) => ({
      ok: true,
      value: await run(),
    }),
    decisionTimeoutMs: 10_000,
  });
  updateHost(harness.db, harness.hub, hostId, {
    machineProviderId: "test-machine",
    resource: { id: "owned" },
  });
  return {
    resume,
    suspend() {
      updateHost(harness.db, harness.hub, hostId, {
        phase: "suspended",
        suspendedAt: Date.now(),
      });
    },
  };
}

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  vi.useRealTimers();
});

describe.sequential("suspended machine lifecycle policy", () => {
  it("does not resume for execution options", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const machine = installMachineProvider(harness, host.id);
      machine.suspend();
      const rpc = vi.spyOn(harness.hub, "requestHostOnlineRpc");

      const response = await harness.app.request(
        `/api/v1/system/execution-options?hostId=${host.id}&providerId=codex`,
      );

      expect(response.status).toBe(200);
      expect(machine.resume).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("does not resume while computing environment provider availability", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const machine = installMachineProvider(harness, host.id);
      machine.suspend();
      const rpc = vi.spyOn(harness.hub, "requestHostOnlineRpc");

      const response = await harness.app.request(
        `/api/v1/system/environment-providers?projectId=${project.id}&hostId=${host.id}`,
      );

      expect(response.status).toBe(200);
      expect(machine.resume).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("uses the persisted daemon data directory for thread storage location", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const machine = installMachineProvider(harness, host.id);
      machine.suspend();
      const rpc = vi.spyOn(harness.hub, "requestHostOnlineRpc");

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/thread-storage/location`,
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual({
        hostId: host.id,
        storageRootPath: `/tmp/bb-host-data/${host.id}/thread-storage/${thread.id}`,
      });
      expect(machine.resume).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("fails file reads fast without resuming", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const machine = installMachineProvider(harness, host.id);
      machine.suspend();
      const rpc = vi.spyOn(harness.hub, "requestHostOnlineRpc");

      const response = await harness.app.request("/api/v1/files/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hostId: host.id, path: "/tmp/read-me" }),
      });

      expect(response.status).toBe(502);
      expect(await readJson(response)).toMatchObject({
        code: "host_unavailable",
      });
      expect(machine.resume).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  it("does not resume when the desktop browser lease release timer expires", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, thread } = seedThreadFixture(harness);
      const machine = installMachineProvider(harness, host.id);
      const commands: HostDaemonOnlineRpcRequestMessage["command"][] = [];
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          commands.push(command);
          if (command.type === "desktop.browser.list_tabs") {
            return {
              ok: true,
              result: {
                tabs: [
                  {
                    tabId: "tab-1",
                    threadId: thread.id,
                    url: "https://example.com",
                    title: "Example",
                    profile: { kind: "automation", id: "profile-1" },
                    presentation: "hidden",
                    control: null,
                  },
                ],
              },
            };
          }
          if (command.type === "desktop.browser.acquire_control") {
            return {
              ok: true,
              result: {
                lease: {
                  leaseId: command.leaseId,
                  controllerLabel: command.controllerLabel,
                  expiresAt: command.expiresAt,
                },
              },
            };
          }
          if (command.type === "desktop.browser.reveal_tab") {
            return { ok: true, result: { ok: true } };
          }
          throw new Error(`Unexpected host RPC ${command.type}`);
        },
      });
      vi.useFakeTimers();
      const response = await harness.app.request(
        "/api/v1/desktop-browsers/acquire",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hostId: host.id,
            instanceId: "desktop-1",
            generation: "generation-1",
            threadId: thread.id,
            tabIds: ["tab-1"],
            controllerLabel: "Test",
            ttlMs: 1000,
          }),
        },
      );
      expect(response.status).toBe(200);
      machine.suspend();
      const commandCount = commands.length;

      await vi.advanceTimersByTimeAsync(1000);

      expect(machine.resume).not.toHaveBeenCalled();
      expect(commands).toHaveLength(commandCount);
    });
  });

  it("resumes a suspended machine for thread send", async () => {
    await withTestHarness(async (harness) => {
      const { host, session, environment, thread } = seedThreadFixture(
        harness,
        {
          thread: { status: "idle" },
        },
      );
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-thread-1",
        threadId: thread.id,
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type === "turn.submit") {
            return { ok: true, result: { appliedAs: "new-turn" } };
          }
          throw new Error(`Unexpected host RPC ${command.type}`);
        },
      });
      const machine = installMachineProvider(harness, host.id);
      machine.suspend();

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: [{ type: "text", text: "Resume for this work" }],
            mode: "auto",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(machine.resume).toHaveBeenCalledTimes(1);
      expect(getHost(harness.db, host.id)?.phase).toBe("active");
    });
  });
});
