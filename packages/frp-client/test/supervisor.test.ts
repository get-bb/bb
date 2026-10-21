import * as fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  FrpcSupervisor,
  frpProxyDiff,
  type FrpProxy,
  type FrpcReloadRequest,
  type FrpcSupervisorStatus,
} from "../src/index.js";
import {
  installTestFrp,
  ownsSubdomain,
  startFrps,
  startGateHooks,
  startOrigin,
  vhostGet,
  waitFor,
  type RunningFrps,
} from "../src/testing/frp-fixture.js";

const LABEL = "sawyer";
const CREDENTIAL = "bbcred_supervisor_secret";

let workDir: string;
let binaries: Awaited<ReturnType<typeof installTestFrp>>;
let hooks: Awaited<ReturnType<typeof startGateHooks>>;
let frps: RunningFrps;
let main: Awaited<ReturnType<typeof startOrigin>>;
let devServer: Awaited<ReturnType<typeof startDevServer>>;
let refusedSubdomain: string | null = null;

function listenOn(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

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
  const port = await listenOn(server);
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

async function startStream() {
  let ticks = 0;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    const timer = setInterval(() => {
      ticks += 1;
      response.write(".");
    }, 50);
    response.once("close", () => clearInterval(timer));
  });
  const port = await listenOn(server);
  return {
    port,
    get ticks() {
      return ticks;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function openStream(vhostPort: number, label: string) {
  let received = 0;
  let ended = false;
  const request = http.request({
    host: "127.0.0.1",
    port: vhostPort,
    path: "/stream",
    headers: { host: `${label}.next.test` },
    agent: false,
  });
  const ready = new Promise<void>((resolve, reject) => {
    request.once("error", reject);
    request.once("response", (response) => {
      response.on("data", (chunk: Buffer) => {
        received += chunk.length;
        resolve();
      });
      response.once("close", () => {
        ended = true;
      });
    });
  });
  request.end();
  return {
    ready,
    get received() {
      return received;
    },
    get ended() {
      return ended;
    },
    close: () => request.destroy(),
  };
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "frp-client-sup-"));
  binaries = await installTestFrp(path.join(workDir, "bin"));
  hooks = await startGateHooks(
    () => CREDENTIAL,
    (user, subdomain) =>
      subdomain !== refusedSubdomain && ownsSubdomain(user, subdomain),
  );
  frps = await startFrps(binaries.frps, workDir, hooks.port);
  main = await startOrigin();
  devServer = await startDevServer();
}, 180_000);

afterAll(async () => {
  await frps?.stop();
  await hooks?.close();
  await main?.close();
  await devServer?.close();
  await fs.rm(workDir, { recursive: true, force: true });
});

const supervisors: FrpcSupervisor[] = [];

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.stop();
  refusedSubdomain = null;
});

function proxy(name: string, subdomain: string, port: number): FrpProxy {
  return {
    name,
    subdomain,
    localIP: "127.0.0.1",
    localPort: port,
    hostHeaderRewrite: name === "bb" ? null : `127.0.0.1:${port}`,
  };
}

function shareProxy(port: number): FrpProxy {
  return proxy(`share-${port}`, `${LABEL}--${port}`, port);
}

async function supervise(
  mainPort: number,
  options: { requestReload?: FrpcReloadRequest } = {},
) {
  const frpDir = await fs.mkdtemp(path.join(workDir, "frp-"));
  let desired: FrpProxy[] = [proxy("bb", LABEL, mainPort)];
  const setProxies = (next: FrpProxy[]) => {
    desired = next;
    return supervisor.proxiesChanged();
  };
  const logs: string[] = [];
  const statuses: FrpcSupervisorStatus[] = [];
  const supervisor = new FrpcSupervisor({
    frpDir,
    primaryProxy: "bb",
    resolveBinary: async () => binaries.frpc,
    trustedCertificates: async () => [],
    prepare: async () => ({
      kind: "launch",
      server: {
        protocol: "websocket",
        host: "127.0.0.1",
        port: frps.bindPort,
      },
      user: LABEL,
      credential: CREDENTIAL,
    }),
    proxies: () => desired,
    log: {
      info: (message) => logs.push(message),
      warn: (message) => logs.push(message),
    },
    onStatusChange: (status) => statuses.push(status),
    timing: { restartMinMs: 100, restartMaxMs: 500, stopGraceMs: 2_000 },
    ...options,
  });
  supervisors.push(supervisor);
  supervisor.start();
  await waitFor(
    () => supervisor.status().state,
    (state) => state === "connected",
  );
  return { supervisor, setProxies, logs, statuses, frpDir };
}

function proxyState(supervisor: FrpcSupervisor, name: string) {
  return supervisor.status().proxies.find((entry) => entry.name === name);
}

describe("frpProxyDiff", () => {
  it("names added, removed and changed proxies", () => {
    const a = shareProxy(3000);
    const b = shareProxy(4000);
    const moved = { ...shareProxy(5000), localPort: 5001 };
    expect(
      frpProxyDiff([a, b, shareProxy(5000)], [b, moved, shareProxy(6000)]),
    ).toEqual({
      added: [shareProxy(6000)],
      removed: [a],
      changed: [moved],
    });
    expect(frpProxyDiff([a, b], [b, a])).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });
});

describe("FrpcSupervisor with real frpc and frps", () => {
  it("adds and removes a proxy by hot reload without dropping the main proxy's connection", async () => {
    const stream = await startStream();
    try {
      const { supervisor, setProxies, logs, frpDir } = await supervise(
        stream.port,
      );
      const pid = supervisor.childPid();
      const open = openStream(frps.vhostPort, LABEL);
      await open.ready;

      await setProxies([
        proxy("bb", LABEL, stream.port),
        shareProxy(devServer.port),
      ]);
      await waitFor(
        () => proxyState(supervisor, `share-${devServer.port}`)?.state,
        (state) => state === "active",
      );
      const shared = await vhostGet(
        frps.vhostPort,
        `${LABEL}--${devServer.port}`,
        "/src/main.ts",
      );
      expect(shared).toEqual({
        status: 200,
        body: "dev server saw /src/main.ts",
      });
      expect(devServer.hosts.at(-1)).toBe(`127.0.0.1:${devServer.port}`);

      const config = JSON.parse(
        await fs.readFile(path.join(frpDir, "frpc.json"), "utf8"),
      );
      expect(config.webServer).toMatchObject({ addr: "127.0.0.1" });
      expect(config.webServer.password.length).toBeGreaterThanOrEqual(32);
      if (process.platform !== "win32") {
        expect(
          (await fs.stat(path.join(frpDir, "frpc.json"))).mode & 0o777,
        ).toBe(0o600);
      }

      const before = open.received;
      await setProxies([proxy("bb", LABEL, stream.port)]);
      await waitFor(
        () => vhostGet(frps.vhostPort, `${LABEL}--${devServer.port}`, "/gone"),
        (response) => response.status === 404,
      );
      expect(proxyState(supervisor, `share-${devServer.port}`)).toBeUndefined();
      await waitFor(
        () => open.received,
        (received) => received > before + 5,
      );
      expect(open.ended).toBe(false);
      expect(supervisor.childPid()).toBe(pid);
      expect(supervisor.status().state).toBe("connected");
      expect(logs.join("\n")).toContain("success reload conf");
      expect(logs.join("\n")).not.toContain(config.webServer.password);
      expect(logs.join("\n")).not.toContain(CREDENTIAL);
      open.close();
    } finally {
      await stream.close();
    }
  }, 90_000);

  it("restarts frpc with the new proxies when the reload request fails", async () => {
    const { supervisor, setProxies, logs } = await supervise(main.port, {
      requestReload: async () => {
        throw new Error("admin server unreachable");
      },
    });
    const pid = supervisor.childPid();
    await setProxies([
      proxy("bb", LABEL, main.port),
      shareProxy(devServer.port),
    ]);
    await waitFor(
      () => supervisor.childPid(),
      (next) => next !== null && next !== pid,
    );
    await waitFor(
      () => proxyState(supervisor, `share-${devServer.port}`)?.state,
      (state) => state === "active",
    );
    expect(supervisor.status().state).toBe("connected");
    expect(
      (
        await vhostGet(
          frps.vhostPort,
          `${LABEL}--${devServer.port}`,
          "/restarted",
        )
      ).status,
    ).toBe(200);
    expect(logs.join("\n")).toMatch(/did not reload.*restarting/u);
  }, 90_000);

  it("reports a refused share proxy without touching the main proxy", async () => {
    refusedSubdomain = `${LABEL}--${devServer.port}`;
    const { supervisor, setProxies } = await supervise(main.port);
    const pid = supervisor.childPid();
    await setProxies([
      proxy("bb", LABEL, main.port),
      shareProxy(devServer.port),
    ]);
    const refused = await waitFor(
      () => proxyState(supervisor, `share-${devServer.port}`),
      (entry) => entry?.state === "refused",
    );
    expect(refused?.error).toContain("a server may only claim its own label");
    expect(supervisor.status().state).toBe("connected");
    expect(supervisor.childPid()).toBe(pid);
    expect((await vhostGet(frps.vhostPort, LABEL, "/still")).status).toBe(200);
  }, 90_000);
});
