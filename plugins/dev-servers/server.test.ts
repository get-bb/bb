import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeHostResponse,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { serversTag, type DevServer } from "./contract.js";

const THREAD_ID = "thr_dev";

const SERVER: DevServer = {
  threadId: THREAD_ID,
  rootPid: 140,
  startedAt: 1_700_000_000_000,
  command: "npm run dev",
  cwd: "/work/app",
  ports: [{ port: 5173, address: "127.0.0.1" }],
};

interface Scenario {
  environmentId?: string | null;
  hostStatus?: "connected" | "disconnected";
  supported?: boolean;
  stopped?: boolean;
}

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
});

async function start(scenario: Scenario = {}) {
  const host = createFakePluginHost({
    pluginId: "bb--dev-servers",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (threadId !== THREAD_ID) throw new Error("HTTP 404");
          return makeThreadResponse({
            id: THREAD_ID,
            environmentId:
              scenario.environmentId === undefined
                ? "env_1"
                : scenario.environmentId,
          });
        },
      },
      environments: {
        get: async () => ({ id: "env_1", hostId: "host_1" }) as never,
      },
      hosts: {
        list: async () => [
          makeHostResponse({
            id: "host_1",
            name: "laptop",
            status: scenario.hostStatus ?? "connected",
          }),
        ],
      },
      system: {
        config: async () => ({ primaryHostId: "host_1" }) as never,
      },
    },
    experimental_callHostRpc: ({ method, input }) => {
      if (method !== "list") return { stopped: scenario.stopped ?? true };
      const threadId = (input as { threadId: string | null }).threadId;
      const servers = [
        SERVER,
        { ...SERVER, threadId: "thr_elsewhere", rootPid: 7 },
      ];
      return {
        supported: scenario.supported ?? true,
        servers: servers.filter(
          (server) => threadId === null || server.threadId === threadId,
        ),
      };
    },
  });
  hosts.push(host);
  await plugin(host.bb);
  return host;
}

describe("dev servers server entry", () => {
  it("lists a thread's servers from the machine of its environment", async () => {
    const host = await start();
    await expect(
      host.harness.callRpc("servers.list", { threadId: THREAD_ID }),
    ).resolves.toEqual({
      status: "ok",
      servers: [
        { ...SERVER, hostId: "host_1", hostName: "laptop", primaryHost: true },
      ],
    });
    expect(host.harness.experimental_hostRpcCalls).toMatchObject([
      { method: "list", input: { threadId: THREAD_ID }, hostId: "host_1" },
    ]);
  });

  it("says why it lists nothing", async () => {
    for (const [scenario, status] of [
      [{ environmentId: null }, "no-environment"],
      [{ hostStatus: "disconnected" }, "offline"],
      [{ supported: false }, "unsupported"],
    ] as const) {
      const host = await start(scenario);
      await expect(
        host.harness.callRpc("servers.list", { threadId: THREAD_ID }),
      ).resolves.toEqual({ status, servers: [] });
    }
  });

  it("stops a listed server with its start time and refreshes the list", async () => {
    const host = await start();
    await expect(
      host.harness.callRpc("servers.stop", {
        threadId: THREAD_ID,
        rootPid: 140,
        startedAt: 1_699_999_999_995,
      }),
    ).resolves.toEqual({ stopped: true });
    expect(host.harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
      method: "stop",
      input: {
        threadId: THREAD_ID,
        rootPid: 140,
        startedAt: 1_699_999_999_995,
      },
    });
    expect(
      host.harness.inspection.experimental_rpcInvalidations,
    ).toContainEqual([serversTag(THREAD_ID)]);
  });

  it("does not ask the machine to stop a pid that is not listed", async () => {
    const host = await start();
    await expect(
      host.harness.callRpc("servers.stop", {
        threadId: THREAD_ID,
        rootPid: 999,
        startedAt: null,
      }),
    ).resolves.toEqual({ stopped: false });
    expect(
      host.harness.experimental_hostRpcCalls.map((call) => call.method),
    ).toEqual(["list"]);
  });

  it("stops a thread's servers when it is archived or deleted", async () => {
    for (const event of ["thread.archived", "thread.deleted"] as const) {
      const host = await start();
      await host.harness.behavior.emitThreadEvent(event, {
        thread: makeThreadResponse({ id: THREAD_ID, environmentId: "env_1" }),
      });
      expect(
        host.harness.experimental_hostRpcCalls.map((call) => [
          call.method,
          call.input,
        ]),
      ).toEqual([
        ["list", { threadId: THREAD_ID }],
        [
          "stop",
          {
            threadId: THREAD_ID,
            rootPid: 140,
            startedAt: SERVER.startedAt,
          },
        ],
      ]);
    }
  });

  it("logs instead of stopping when the thread's machine is offline", async () => {
    const host = await start({ hostStatus: "disconnected" });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: THREAD_ID, environmentId: "env_1" }),
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
    expect(
      host.harness.inspection.logEntries.map((entry) => entry.message),
    ).toContainEqual(expect.stringContaining("is offline"));
  });

  it("leaves servers running after an archive when the setting is off", async () => {
    const host = await start();
    await host.harness.setSettings({ stopOnArchive: false });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: makeThreadResponse({ id: THREAD_ID, environmentId: "env_1" }),
    });
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
  });

  it("lists and stops from the CLI", async () => {
    const host = await start();
    const listed = await host.harness.runCli(["list", THREAD_ID]);
    expect(listed.stdout).toBe(
      `${THREAD_ID}\t140\t127.0.0.1:5173\tnpm run dev\n`,
    );
    const all = await host.harness.runCli(["list", "--json"]);
    expect(JSON.parse(all.stdout ?? "")).toMatchObject({
      servers: [{ rootPid: 140, hostName: "laptop" }],
    });
    expect(JSON.parse(all.stdout ?? "").servers).toHaveLength(1);
    expect(host.harness.experimental_hostRpcCalls.at(-1)).toMatchObject({
      input: { threadId: null },
    });
    const stopped = await host.harness.runCli(["stop", "140"], {
      threadId: THREAD_ID,
    });
    expect(stopped.exitCode, stopped.stderr).toBe(0);
    const missing = await host.harness.runCli(["stop", "999", "--json"], {
      threadId: THREAD_ID,
    });
    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.stdout)).toMatchObject({
      error: { code: "no_server" },
    });
    const noThread = await host.harness.runCli(["stop", "140"]);
    expect(noThread.exitCode).toBe(2);
  });
});
