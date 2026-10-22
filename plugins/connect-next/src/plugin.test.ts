import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { createConnectNextPlugin } from "./plugin.js";
import { FakeAccount } from "./testing/fake-account.js";
import { waitFor } from "@bb/frp-client/testing";
import type { NextTunnel } from "./tunnel.js";
import type { ConnectNextStatus } from "./types.js";

const hosts: Array<{
  host: FakePluginHost;
  service: { controller: AbortController; done: Promise<void> };
}> = [];

afterEach(async () => {
  for (const { host, service } of hosts.splice(0)) {
    service.controller.abort();
    await service.done;
    await host.harness.dispose();
  }
});

async function load(
  settings: { enabled?: boolean } = {},
  env: NodeJS.ProcessEnv = {},
) {
  const account = new FakeAccount();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "connect-next-"));
  const host = createFakePluginHost({
    pluginId: "bb--connect-next",
    dataDir,
    settings,
    sdk: { plugins: { callRpc: account.callRpc as never } },
  });
  let tunnel: NextTunnel | null = null;
  const fakeFrpc = path.join(dataDir, "frpc-never-run");
  await fs.writeFile(fakeFrpc, "");
  await createConnectNextPlugin({
    env: { BB_CONNECT_FRPC: fakeFrpc, ...env },
    timing: { restartMinMs: 60_000 },
    onTunnel: (created) => {
      tunnel = created;
    },
  })(host.bb);
  const service = host.harness.runService("tunnel");
  hosts.push({ host, service });
  if (tunnel === null) throw new Error("no tunnel");
  return { host, account, tunnel: tunnel as NextTunnel };
}

async function status(host: FakePluginHost): Promise<ConnectNextStatus> {
  return (await host.harness.callRpc("status", null)) as ConnectNextStatus;
}

describe("connect-next plugin wiring", () => {
  it("turns machine tunnels on with the account's next domain and lists each machine", async () => {
    const { host, account } = await load(
      { enabled: true },
      { BB_CONNECT_NEXT_SERVER: "ws://tunnel.next.bb.localhost:41000" },
    );
    expect(host.harness.internal_DO_NOT_USE_nextTunnelConfig).toBeNull();
    account.signIn({
      serverId: "srv_1",
      label: "sawyer",
      credential: "c",
      baseUrl: "http://bb.localhost:5000",
    });
    await waitFor(
      () => host.harness.internal_DO_NOT_USE_nextTunnelConfig,
      (config) => config !== null,
    );
    expect(host.harness.internal_DO_NOT_USE_nextTunnelConfig).toEqual({
      domain: "next.bb.localhost:5000",
      server: {
        protocol: "websocket",
        host: "tunnel.next.bb.localhost",
        port: 41000,
      },
    });

    host.harness.internal_DO_NOT_USE_setNextTunnelStatuses([
      {
        hostId: "host-air",
        hostName: "Sawyer Air",
        label: "sawyer-air",
        state: "connected",
        lastError: null,
        nextRetryAt: null,
        since: 1,
        shares: [{ port: 3000, state: "active", error: null }],
      },
      {
        hostId: "host-idle",
        hostName: "Idle box",
        label: null,
        state: "idle",
        lastError: null,
        nextRetryAt: null,
        since: 1,
        shares: [],
      },
    ]);
    const listed = await status(host);
    expect(listed.machines).toEqual([
      {
        hostId: "host-air",
        hostName: "Sawyer Air",
        label: "sawyer-air",
        state: "connected",
        lastError: null,
        nextRetryAt: null,
        since: 1,
        shares: [
          {
            port: 3000,
            url: "http://sawyer-air--3000.next.bb.localhost:5000",
            state: "active",
            error: null,
          },
        ],
      },
    ]);
    expect(
      host.harness.realtimeSignals.some(
        (signal) =>
          (signal.payload as ConnectNextStatus).machines?.length === 1,
      ),
    ).toBe(true);
    const text = await host.harness.runCli(["status"]);
    expect(text.stdout).toContain(
      "machine Sawyer Air (host-air)  sawyer-air  connected",
    );
    expect(text.stdout).toContain(
      "share 3000  http://sawyer-air--3000.next.bb.localhost:5000  active",
    );

    await host.harness.runCli(["off"]);
    expect(host.harness.internal_DO_NOT_USE_nextTunnelConfig).toBeNull();
    expect((await status(host)).machines).toEqual([]);
  });

  it("is on once the plugin is enabled and only reports the address once signed in", async () => {
    const { host, account } = await load();
    expect(await status(host)).toMatchObject({
      enabled: true,
      state: "signed-out",
      label: null,
      url: null,
      server: null,
    });
    account.signIn({ serverId: "srv_1", label: "sawyer", credential: "c" });
    const signedIn = await waitFor(
      () => status(host),
      (current) => current.url !== null,
    );
    expect(signedIn).toMatchObject({
      url: "https://sawyer.next.getbb.app",
      server: "wss://tunnel.next.getbb.app/~!frp",
    });
    await host.harness.runCli(["off"]);
    const text = await host.harness.runCli(["status"]);
    expect(text.stdout).toContain("connect next is off");
    expect(text.stdout).toContain("https://sawyer.next.getbb.app");
  });

  it("derives the address and the tunnel server from the account's base URL", async () => {
    const { host, account } = await load({ enabled: true });
    account.signIn({
      serverId: "srv_1",
      label: "nexttest",
      credential: "c",
      baseUrl: "https://vibecodethis.site",
    });
    const staging = await waitFor(
      () => status(host),
      (current) => current.url !== null,
    );
    expect(staging).toMatchObject({
      url: "https://nexttest.next.vibecodethis.site",
      server: "wss://tunnel.next.vibecodethis.site/~!frp",
    });
    const configFile = path.join(
      host.bb.server.experimental_dataDir,
      "plugins",
      "bb--connect-next",
      "frp",
      "frpc.json",
    );
    const config = await waitFor(
      async () => JSON.parse(await fs.readFile(configFile, "utf8")),
      (value) => value !== null,
    );
    expect(config).toMatchObject({
      serverAddr: "tunnel.next.vibecodethis.site",
      serverPort: 443,
      transport: {
        protocol: "wss",
        tls: { serverName: "tunnel.next.vibecodethis.site" },
      },
    });
    const on = await host.harness.runCli(["on"]);
    expect(on.stdout).toContain("https://nexttest.next.vibecodethis.site");
  });

  it("keeps BB_CONNECT_NEXT_SERVER over the derived tunnel server", async () => {
    const { host, account } = await load(
      {},
      { BB_CONNECT_NEXT_SERVER: "ws://127.0.0.1:7000" },
    );
    expect(await status(host)).toMatchObject({
      server: "ws://127.0.0.1:7000/~!frp",
    });
    account.signIn({
      serverId: "srv_1",
      label: "cne2e",
      credential: "c",
      baseUrl: "http://bb.localhost:35067",
    });
    expect(
      await waitFor(
        () => status(host),
        (current) => current.url !== null,
      ),
    ).toMatchObject({
      url: "http://cne2e.next.bb.localhost:35067",
      server: "ws://127.0.0.1:7000/~!frp",
    });
  });

  it("turns on through RPC, persists the setting, and waits for sign-in", async () => {
    const { host } = await load();
    const result = (await host.harness.callRpc("setEnabled", {
      enabled: true,
    })) as ConnectNextStatus;
    expect(result).toMatchObject({ enabled: true, state: "signed-out" });
    const cli = await host.harness.runCli(["status", "--json"]);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      enabled: true,
      state: "signed-out",
    });
    const reloaded = await host.harness.reload(createConnectNextPlugin());
    expect(await status(reloaded)).toMatchObject({ enabled: true });
    await reloaded.harness.dispose();
  });

  it("opens the server's own tunnel ingress for its audience and closes it when turned off", async () => {
    const { host, account } = await load({ enabled: true });
    account.signIn({ serverId: "srv_1", label: "sawyer", credential: "c" });
    const configFile = path.join(
      host.bb.server.experimental_dataDir,
      "plugins",
      "bb--connect-next",
      "frp",
      "frpc.json",
    );
    const config = await waitFor(
      async () => JSON.parse(await fs.readFile(configFile, "utf8")),
      (value) => value !== null,
    );
    const ingresses = host.harness.internal_DO_NOT_USE_tunnelIngresses;
    expect(ingresses).toHaveLength(1);
    expect(ingresses[0]).toMatchObject({
      audience: "server:srv_1",
      closed: false,
    });
    const baseUrl = new URL(ingresses[0]?.baseUrl ?? "");
    expect(config.proxies[0]).toMatchObject({
      localIP: baseUrl.hostname,
      localPort: Number(baseUrl.port),
    });
    await host.harness.callRpc("setEnabled", { enabled: false });
    expect(ingresses[0]?.closed).toBe(true);
  });

  it("describes the address without naming one domain", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "connect-next-"));
    const host = createFakePluginHost({
      pluginId: "bb--connect-next",
      dataDir,
      sdk: { plugins: { callRpc: new FakeAccount().callRpc as never } },
    });
    const descriptions: string[] = [];
    const define = host.bb.settings.define.bind(host.bb.settings);
    host.bb.settings.define = ((
      schema: Record<string, { description?: string }>,
    ) => {
      for (const field of Object.values(schema)) {
        if (field.description !== undefined)
          descriptions.push(field.description);
      }
      return define(schema as never);
    }) as typeof host.bb.settings.define;
    await createConnectNextPlugin({ env: {} })(host.bb);
    await host.harness.dispose();
    const manifest = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { description: string; bb: { description: string } };
    descriptions.push(manifest.description, manifest.bb.description);
    expect(descriptions).toHaveLength(3);
    for (const description of descriptions) {
      expect(description).toContain("next.<your bb account's domain>");
      expect(description).not.toContain("getbb.app");
    }
  });

  it("prints help for the command group", async () => {
    const { host } = await load();
    const help = await host.harness.runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("status");
    expect(help.stdout).toContain("on");
    expect(help.stdout).toContain("off");
  });
});
