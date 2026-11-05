import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { createConnectPlugin } from "./plugin.js";
import plugin from "./server.js";
import { FakeAccount } from "./testing/fake-account.js";

const CONNECT_NEXT = { kind: "plugin", pluginId: "bb--connect-next" } as const;
const READ = "connect.internal_DO_NOT_USE.remoteAccess";
const WAIT = "connect.internal_DO_NOT_USE.waitForRemoteAccessChange";

interface RemoteAccess {
  revision: number;
  enabled: boolean;
}

const hosts: FakePluginHost[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.dispose();
});

async function load(settings: { remoteAccess?: boolean } = {}) {
  const account = new FakeAccount();
  const host = createFakePluginHost({
    pluginId: "connect",
    settings,
    sdk: { plugins: { callRpc: account.callRpc as never } },
  });
  await createConnectPlugin({
    accountRetryMinMs: 20,
    remoteAccessLongPollMs: 200,
  })(host.bb as unknown as Parameters<typeof plugin>[0]);
  hosts.push(host);
  return host;
}

function read(host: FakePluginHost) {
  return host.harness.callRpc(READ, null, {
    experimental_caller: CONNECT_NEXT,
  }) as Promise<RemoteAccess>;
}

function wait(host: FakePluginHost, afterRevision: number) {
  return host.harness.callRpc(
    WAIT,
    { afterRevision },
    { experimental_caller: CONNECT_NEXT },
  ) as Promise<RemoteAccess>;
}

describe("connect.internal_DO_NOT_USE.remoteAccess", () => {
  it("answers bb connect next only", async () => {
    const host = await load();
    await expect(host.harness.callRpc(READ, null)).rejects.toThrow(
      /only bb connect next/u,
    );
    await expect(
      host.harness.callRpc(
        WAIT,
        { afterRevision: 0 },
        { experimental_caller: { kind: "plugin", pluginId: "bb--mcp" } },
      ),
    ).rejects.toThrow(/only bb connect next/u);
  });

  it("starts from the saved setting", async () => {
    expect((await read(await load())).enabled).toBe(true);
    expect((await read(await load({ remoteAccess: false }))).enabled).toBe(
      false,
    );
  });

  it("wakes the long-poll when remote access is turned off and on", async () => {
    const host = await load();
    const start = await read(host);
    expect(await wait(host, start.revision)).toEqual(start);

    const off = wait(host, start.revision);
    await host.harness.runCli(["off"]);
    const afterOff = await off;
    expect(afterOff.enabled).toBe(false);
    expect(afterOff.revision).toBeGreaterThan(start.revision);

    const on = wait(host, afterOff.revision);
    await host.harness.setSettings({ remoteAccess: true });
    const afterOn = await on;
    expect(afterOn.enabled).toBe(true);
    expect(afterOn.revision).toBeGreaterThan(afterOff.revision);
  });

  it("releases a waiting long-poll with an error when connect stops", async () => {
    const host = await load();
    const start = await read(host);
    const waiting = wait(host, start.revision);
    hosts.splice(hosts.indexOf(host), 1);
    await host.harness.dispose();
    await expect(waiting).rejects.toThrow();
  });
});
