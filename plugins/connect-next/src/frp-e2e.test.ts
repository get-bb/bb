import * as fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import { FRP_CREDENTIAL_META } from "@bb/tunnel-contract/next";
import { createConnectNextPlugin } from "./plugin.js";
import { FakeAccount } from "./testing/fake-account.js";
import {
  GATE_REFUSAL_REASON,
  PROXY_REFUSAL_REASON,
  installTestFrp,
  makeTestCertificate,
  opensslAvailable,
  ownsSubdomain,
  processAlive,
  startFrps,
  startGateHooks,
  startOrigin,
  startTlsFront,
  vhostGet,
  waitFor,
  type RunningFrps,
} from "@bb/frp-client/testing";
import { FakeConnectShares, routeRpc } from "./testing/fake-connect.js";
import { recordingIngress } from "./testing/recording-ingress.js";
import type { NextTunnel } from "./tunnel.js";
import type { ConnectNextStatus } from "./types.js";

const CREDENTIAL = "bbcred_e2e_secret_value";
const LABEL = "sawyer";
const SERVER_ID = "srv_e2e";

let workDir: string;
let binaries: Awaited<ReturnType<typeof installTestFrp>>;
let hooks: Awaited<ReturnType<typeof startGateHooks>>;
let frps: RunningFrps;
let origin: Awaited<ReturnType<typeof startOrigin>>;
let acceptedCredential = CREDENTIAL;
let claimableLabel: string | null = null;

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "connect-next-e2e-"));
  binaries = await installTestFrp(path.join(workDir, "bin"));
  hooks = await startGateHooks(
    () => acceptedCredential,
    (user, subdomain) =>
      claimableLabel === null
        ? ownsSubdomain(user, subdomain)
        : subdomain === claimableLabel,
  );
  frps = await startFrps(binaries.frps, workDir, hooks.port);
  origin = await startOrigin();
}, 180_000);

afterAll(async () => {
  await frps?.stop();
  await hooks?.close();
  await origin?.close();
  await fs.rm(workDir, { recursive: true, force: true });
});

interface Loaded {
  host: FakePluginHost;
  account: FakeAccount;
  connect: FakeConnectShares;
  tunnel: NextTunnel;
  ingress: ReturnType<typeof recordingIngress>;
  dataDir: string;
  service: { controller: AbortController; done: Promise<void> };
}

const loaded: Loaded[] = [];

afterEach(async () => {
  for (const current of loaded.splice(0)) {
    current.service.controller.abort();
    await current.service.done;
    await current.host.harness.dispose();
  }
  acceptedCredential = CREDENTIAL;
  claimableLabel = null;
});

async function load(options: {
  server: string;
  enabled?: boolean;
  trustedCertificates?: () => Promise<string[]>;
}): Promise<Loaded> {
  const account = new FakeAccount();
  const connect = new FakeConnectShares();
  const dataDir = await fs.mkdtemp(path.join(workDir, "data-"));
  const ingress = recordingIngress(() => origin.baseUrl);
  const host = createFakePluginHost({
    pluginId: "bb--connect-next",
    dataDir,
    settings: { enabled: options.enabled ?? true },
    sdk: {
      plugins: { callRpc: routeRpc({ account, connect }) as never },
    },
  });
  let tunnel: NextTunnel | null = null;
  await createConnectNextPlugin({
    env: {
      BB_CONNECT_NEXT_SERVER: options.server,
      BB_CONNECT_FRPC: binaries.frpc,
    },
    openIngress: ingress.openIngress,
    ...(options.trustedCertificates === undefined
      ? {}
      : { trustedCertificates: options.trustedCertificates }),
    timing: {
      restartMinMs: 100,
      restartMaxMs: 500,
      refusedRetryMs: 60_000,
      stopGraceMs: 2_000,
    },
    accountRetryMinMs: 50,
    onTunnel: (created) => {
      tunnel = created;
    },
  })(host.bb);
  if (tunnel === null) throw new Error("plugin did not create a tunnel");
  const service = host.harness.runService("tunnel");
  const current = {
    host,
    account,
    connect,
    tunnel,
    ingress,
    dataDir,
    service,
  };
  loaded.push(current);
  return current;
}

async function rpcStatus(current: Loaded): Promise<ConnectNextStatus> {
  return (await current.host.harness.callRpc(
    "status",
    null,
  )) as ConnectNextStatus;
}

function waitForState(current: Loaded, state: ConnectNextStatus["state"]) {
  return waitFor(
    () => rpcStatus(current),
    (status) => status.state === state,
  );
}

function logText(current: Loaded): string {
  return current.host.harness.logEntries
    .map((entry) => entry.message)
    .join("\n");
}

const localServer = () => `ws://127.0.0.1:${frps.bindPort}`;

async function startDevServer() {
  const hosts: string[] = [];
  const server = http.createServer((request, response) => {
    hosts.push(request.headers.host ?? "");
    if (request.headers.host !== `127.0.0.1:${port}`) {
      response.writeHead(403).end("blocked host");
      return;
    }
    response.end(`dev server saw ${request.url}`);
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
  return {
    port,
    hosts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe("connect next with real frpc and frps", () => {
  it("reaches the origin through frps's vhost with the server's label and credential", async () => {
    const current = await load({ server: localServer() });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    const status = await waitForState(current, "connected");
    expect(status).toMatchObject({
      enabled: true,
      label: LABEL,
      url: "https://sawyer.next.getbb.app",
      lastError: null,
    });
    expect(current.ingress.opened).toEqual([`server:${SERVER_ID}`]);

    const response = await vhostGet(frps.vhostPort, LABEL, "/api/health?x=1");
    expect(response).toEqual({
      status: 200,
      body: "origin saw /api/health?x=1",
    });
    expect(origin.requests.at(-1)).toMatchObject({
      method: "GET",
      url: "/api/health?x=1",
      host: `${LABEL}.next.test`,
    });

    const login = hooks.calls.filter((call) => call.op === "Login").at(-1);
    expect(login?.content).toMatchObject({
      user: LABEL,
      metas: { [FRP_CREDENTIAL_META]: CREDENTIAL },
    });
    const proxy = hooks.calls.filter((call) => call.op === "NewProxy").at(-1);
    expect(proxy?.content).toMatchObject({
      proxy_type: "http",
      subdomain: LABEL,
    });

    const configFile = path.join(
      current.dataDir,
      "plugins",
      "bb--connect-next",
      "frp",
      "frpc.json",
    );
    const config = JSON.parse(await fs.readFile(configFile, "utf8"));
    expect(config).toMatchObject({
      serverAddr: "127.0.0.1",
      serverPort: frps.bindPort,
      user: LABEL,
      loginFailExit: false,
      metadatas: { credential: CREDENTIAL },
      transport: { protocol: "websocket" },
      proxies: [
        {
          type: "http",
          subdomain: LABEL,
          localIP: "127.0.0.1",
          localPort: origin.port,
        },
      ],
    });
    if (process.platform !== "win32") {
      expect((await fs.stat(configFile)).mode & 0o777).toBe(0o600);
    }
    expect(logText(current)).toContain("frpc:");
    expect(logText(current)).not.toContain(CREDENTIAL);
    expect(
      current.host.harness.realtimeSignals.some(
        (signal) =>
          signal.channel === "connect-next" &&
          (signal.payload as ConnectNextStatus).state === "connected",
      ),
    ).toBe(true);
  }, 60_000);

  it("reports a refused credential without logging it and stops dialing", async () => {
    acceptedCredential = "bbcred_someone_else";
    const current = await load({ server: localServer() });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    const status = await waitForState(current, "refused");
    expect(status.lastError).toContain(GATE_REFUSAL_REASON);
    expect(status.nextRetryAt).not.toBeNull();
    await waitFor(
      () => current.tunnel.childPid(),
      (pid) => pid === null,
    );
    expect(logText(current)).toContain(GATE_REFUSAL_REASON);
    expect(logText(current)).not.toContain(CREDENTIAL);
    const cli = await current.host.harness.runCli(["status"]);
    expect(cli.stdout).toContain("credential refused");
    expect(cli.stdout).not.toContain(CREDENTIAL);
  }, 60_000);

  it("reports a refused proxy claim", async () => {
    claimableLabel = "someone-else";
    const current = await load({ server: localServer() });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    const status = await waitForState(current, "refused");
    expect(status.lastError).toContain(PROXY_REFUSAL_REASON);
    await waitFor(
      () => current.tunnel.childPid(),
      (pid) => pid === null,
    );
  }, 60_000);

  it("restarts frpc after it is killed", async () => {
    const current = await load({ server: localServer() });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    await waitForState(current, "connected");
    const first = current.tunnel.childPid();
    expect(first).not.toBeNull();
    process.kill(first ?? 0, "SIGKILL");
    await waitFor(
      () => current.tunnel.childPid(),
      (pid) => pid !== null && pid !== first,
    );
    await waitForState(current, "connected");
    expect(logText(current)).toMatch(/frpc exited/u);
    await waitFor(
      () => vhostGet(frps.vhostPort, LABEL, "/again"),
      (response) => response.status === 200,
    );
    expect(origin.requests.at(-1)?.url).toBe("/again");
    expect(current.ingress.opened).toHaveLength(1);
  }, 60_000);

  it("closes the ingress and frpc on stop, off, and sign-out", async () => {
    const current = await load({ server: localServer() });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    await waitForState(current, "connected");
    const first = current.tunnel.childPid() ?? 0;

    const off = await current.host.harness.runCli(["off", "--json"]);
    expect(JSON.parse(off.stdout)).toMatchObject({
      enabled: false,
      state: "off",
    });
    expect(processAlive(first)).toBe(false);
    expect(current.ingress.open).toBe(0);
    expect(current.ingress.closed).toBe(1);

    const on = await current.host.harness.runCli(["on"]);
    expect(on.stdout).toContain("https://sawyer.next.getbb.app");
    await waitForState(current, "connected");
    const second = current.tunnel.childPid() ?? 0;

    current.account.signOut();
    await waitForState(current, "signed-out");
    await current.tunnel.idle();
    expect(processAlive(second)).toBe(false);
    expect(current.ingress.open).toBe(0);

    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    await waitForState(current, "connected");
    const third = current.tunnel.childPid() ?? 0;

    loaded.splice(loaded.indexOf(current), 1);
    current.service.controller.abort();
    await current.service.done;
    expect(processAlive(third)).toBe(false);
    expect(current.ingress.open).toBe(0);
    expect(current.ingress.closed).toBe(3);
    await current.host.harness.dispose();
  }, 90_000);

  it("reports the gate going away and reconnects when it is back", async () => {
    const own = await startFrps(binaries.frps, workDir, hooks.port);
    try {
      const current = await load({ server: `ws://127.0.0.1:${own.bindPort}` });
      current.account.signIn({
        serverId: SERVER_ID,
        label: LABEL,
        credential: CREDENTIAL,
      });
      await waitForState(current, "connected");
      const pid = current.tunnel.childPid();
      await own.stop();
      const away = await waitFor(
        () => rpcStatus(current),
        (status) => status.state === "offline",
      );
      expect(away.lastError).toEqual(expect.any(String));
      expect(away.lastError?.trim()).not.toBe("");
      const back = await startFrps(binaries.frps, workDir, hooks.port, {
        bindPort: own.bindPort,
        vhostPort: own.vhostPort,
      });
      try {
        await waitFor(
          () => rpcStatus(current),
          (status) => status.state === "connected",
          60_000,
        );
        expect(current.tunnel.childPid()).toBe(pid);
        const response = await vhostGet(back.vhostPort, LABEL, "/back");
        expect(response.body).toBe("origin saw /back");
      } finally {
        await back.stop();
      }
    } finally {
      await own.stop();
    }
  }, 120_000);

  it("serves the server's shares as extra proxies, changed by hot reload", async () => {
    const dev = await startDevServer();
    try {
      const current = await load({ server: localServer() });
      current.account.signIn({
        serverId: SERVER_ID,
        label: LABEL,
        credential: CREDENTIAL,
      });
      await waitForState(current, "connected");
      const pid = current.tunnel.childPid();
      const shareLabel = `${LABEL}--${dev.port}`;

      current.connect.setPorts([dev.port]);
      const shared = await waitFor(
        () => rpcStatus(current),
        (status) => status.shares[0]?.state === "active",
      );
      expect(shared.shares).toEqual([
        {
          port: dev.port,
          url: `https://${shareLabel}.next.getbb.app`,
          state: "active",
          error: null,
        },
      ]);
      expect(
        await vhostGet(frps.vhostPort, shareLabel, "/@vite/client"),
      ).toEqual({ status: 200, body: "dev server saw /@vite/client" });
      expect(dev.hosts.at(-1)).toBe(`127.0.0.1:${dev.port}`);
      const proxy = hooks.calls.filter((call) => call.op === "NewProxy").at(-1);
      expect(proxy?.content).toMatchObject({ subdomain: shareLabel });
      const cli = await current.host.harness.runCli(["status"]);
      expect(cli.stdout).toContain(
        `share ${dev.port}  https://${shareLabel}.next.getbb.app  active`,
      );

      current.connect.setPorts([]);
      await waitFor(
        () => vhostGet(frps.vhostPort, shareLabel, "/gone"),
        (response) => response.status === 404,
      );
      expect((await rpcStatus(current)).shares).toEqual([]);
      expect((await vhostGet(frps.vhostPort, LABEL, "/main")).status).toBe(200);

      current.connect.setPorts([dev.port]);
      await waitFor(
        () => vhostGet(frps.vhostPort, shareLabel, "/again"),
        (response) => response.status === 200,
      );
      expect(current.tunnel.childPid()).toBe(pid);
      expect(logText(current)).not.toContain(CREDENTIAL);
    } finally {
      await dev.close();
    }
  }, 60_000);

  it("starts frpc with shares that existed before it connected", async () => {
    const dev = await startDevServer();
    try {
      const current = await load({ server: localServer() });
      current.connect.setPorts([dev.port]);
      current.account.signIn({
        serverId: SERVER_ID,
        label: LABEL,
        credential: CREDENTIAL,
      });
      await waitFor(
        () => rpcStatus(current),
        (status) =>
          status.state === "connected" && status.shares[0]?.state === "active",
      );
      expect(
        (await vhostGet(frps.vhostPort, `${LABEL}--${dev.port}`, "/")).status,
      ).toBe(200);
      const config = JSON.parse(
        await fs.readFile(
          path.join(
            current.dataDir,
            "plugins",
            "bb--connect-next",
            "frp",
            "frpc.json",
          ),
          "utf8",
        ),
      );
      expect(config.proxies).toEqual([
        expect.objectContaining({ name: "bb", subdomain: LABEL }),
        {
          name: `share-${dev.port}`,
          type: "http",
          localIP: "127.0.0.1",
          localPort: dev.port,
          subdomain: `${LABEL}--${dev.port}`,
          hostHeaderRewrite: `127.0.0.1:${dev.port}`,
        },
      ]);
    } finally {
      await dev.close();
    }
  }, 60_000);

  it("stays off until the setting is turned on", async () => {
    const current = await load({ server: localServer(), enabled: false });
    current.account.signIn({
      serverId: SERVER_ID,
      label: LABEL,
      credential: CREDENTIAL,
    });
    await waitFor(
      () => rpcStatus(current),
      (status) => status.label === LABEL,
    );
    expect(await rpcStatus(current)).toMatchObject({
      enabled: false,
      state: "off",
    });
    expect(current.ingress.opened).toEqual([]);
    await current.host.harness.setSettings({ enabled: true });
    await waitForState(current, "connected");
  }, 60_000);
});

describe.runIf(await opensslAvailable())(
  "connect next over wss with real frpc",
  () => {
    it("verifies the gate's certificate", async () => {
      const certificate = await makeTestCertificate(workDir);
      const front = await startTlsFront(certificate, frps.bindPort);
      try {
        const untrusted = await load({
          server: `wss://127.0.0.1:${front.port}`,
        });
        untrusted.account.signIn({
          serverId: SERVER_ID,
          label: LABEL,
          credential: CREDENTIAL,
        });
        const offline = await waitForState(untrusted, "offline");
        expect(offline.lastError).toMatch(/x509|certificate/u);
        expect(offline.server).toBe(`wss://127.0.0.1:${front.port}/~!frp`);
        loaded.splice(loaded.indexOf(untrusted), 1);
        untrusted.service.controller.abort();
        await untrusted.service.done;
        await untrusted.host.harness.dispose();

        const trusted = await load({
          server: `wss://127.0.0.1:${front.port}`,
          trustedCertificates: async () => [certificate.cert],
        });
        trusted.account.signIn({
          serverId: SERVER_ID,
          label: LABEL,
          credential: CREDENTIAL,
        });
        await waitForState(trusted, "connected");
        const response = await vhostGet(frps.vhostPort, LABEL, "/over-wss");
        expect(response.body).toBe("origin saw /over-wss");
        const config = JSON.parse(
          await fs.readFile(
            path.join(
              trusted.dataDir,
              "plugins",
              "bb--connect-next",
              "frp",
              "frpc.json",
            ),
            "utf8",
          ),
        );
        expect(config.transport).toMatchObject({
          protocol: "wss",
          tls: { enable: true, serverName: "127.0.0.1" },
        });
      } finally {
        await front.close();
      }
    }, 90_000);
  },
);
