import * as http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  createLocalDirectory,
  type TunnelDirectory,
} from "../src/directory.js";
import { silentLog } from "../src/log.js";
import { replayState } from "../src/regions.js";
import { startConnectNext, type ConnectNext } from "../src/service.js";
import { ENTRY_HEADER, startBlackHole, startFlyProxy } from "./fly.js";
import { frpBinaries, type FrpBinaries } from "./frp-binaries.js";
import {
  BASE_DOMAIN,
  GATE_SECRET,
  freePort,
  gateAudienceForServer,
  startAccountApi,
  startEdge,
  startFrpc,
  startOrigin,
  testKeys,
  visit,
  waitFor,
  type AccountFixture,
  type FrpcProcess,
} from "./harness.js";

const availability = await frpBinaries();
if (!availability.ok) {
  console.warn(`skipping connect-next regions e2e: ${availability.reason}`);
}

const OWNER = "user-owner";
const SESSION = "better-auth.session_token";
const BEE = `bee.${BASE_DOMAIN}`;
const PEER_SECRET = "peer-secret-for-tests-0123456789abcdef";
const owner = { cookie: `${SESSION}=sess-owner` };
const DRAIN_MS = 2_000;

const fixture: AccountFixture = {
  labels: {
    bee: {
      kind: "server",
      serverId: "srv-bee",
      userId: OWNER,
      revoked: false,
      lastSeenAt: null,
      credential: "cred-bee",
    },
    moth: {
      kind: "server",
      serverId: "srv-moth",
      userId: OWNER,
      revoked: false,
      lastSeenAt: null,
      credential: "cred-moth",
    },
  },
  sessions: {
    "sess-owner": { userId: OWNER, needsRefresh: false },
    "sess-refresh": { userId: OWNER, needsRefresh: true },
  },
  desktopSessions: {},
  machines: {},
  oauth: {},
  refreshSetCookie: `${SESSION}=refreshed; Path=/`,
};

interface Instance {
  id: string;
  internalPort: number;
  gate: ConnectNext;
  edge: Awaited<ReturnType<typeof startEdge>>;
}

function postChunked(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string>,
  chunks: Buffer[],
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const sent = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { ...headers, host, "transfer-encoding": "chunked" },
        agent: false,
      },
      (answer) => {
        const parts: Buffer[] = [];
        answer.on("data", (chunk: Buffer) => parts.push(chunk));
        answer.on("end", () =>
          resolve({
            status: answer.statusCode ?? 0,
            text: Buffer.concat(parts).toString(),
          }),
        );
      },
    );
    sent.on("error", reject);
    for (const chunk of chunks) sent.write(chunk);
    sent.end();
  });
}

describe.skipIf(!availability.ok)("connect-next across regions", () => {
  let binaries: FrpBinaries;
  let account: Awaited<ReturnType<typeof startAccountApi>>;
  let origin: Awaited<ReturnType<typeof startOrigin>>;
  let keys: Awaited<ReturnType<typeof testKeys>>;
  let fly: Awaited<ReturnType<typeof startFlyProxy>>;
  let blackHole: Awaited<ReturnType<typeof startBlackHole>>;
  const instances = new Map<string, Instance>();
  const locals = new Map<string, TunnelDirectory>();
  const webPorts = new Map<string, number>();
  const internalPorts = new Map<string, number>();
  const clients: FrpcProcess[] = [];
  let first: FrpcProcess;

  function peerUrls(): string[] {
    return [
      ...[...internalPorts.values()].map((port) => `http://127.0.0.1:${port}`),
      blackHole.url,
    ];
  }

  function instance(id: string): Instance {
    const found = instances.get(id);
    if (found === undefined) throw new Error(`no instance ${id}`);
    return found;
  }

  async function startInstance(id: string): Promise<Instance> {
    const internalPort = internalPorts.get(id) ?? (await freePort());
    internalPorts.set(id, internalPort);
    const local = createLocalDirectory({ graceMs: 1_000 });
    locals.set(id, local);
    const gate = await startConnectNext(
      {
        baseDomain: BASE_DOMAIN,
        scheme: "http",
        accountApiUrl: account.url,
        gateSecret: GATE_SECRET,
        accountAppUrl: account.url,
        signingKeyJwk: keys.privateJwk,
        assetLinksFingerprints: "",
        region: `region-${id}`,
        gateMachineId: id,
        bindHost: "127.0.0.1",
        ports: {
          web: 0,
          frpBind: await freePort(),
          vhost: await freePort(),
          hooks: 0,
          frpTcp: null,
        },
        frps: binaries.frps,
        frpLogLevel: "info",
        cacheMaxBytes: 16 * 1024 * 1024,
        cacheMaxEntryBytes: 1024 * 1024,
        presenceRefreshMs: 60_000,
        peers: {
          secret: PEER_SECRET,
          appName: "bb-connect-next-test",
          internalPort,
          internalBindHost: "127.0.0.1",
          refreshMs: 60_000,
        },
      },
      silentLog,
      {
        directory: local,
        deadlines: { headMs: 10_000, transcriptionHeadMs: 10_000 },
        resolvePeers: async () => peerUrls(),
        drainMs: DRAIN_MS,
        peerTimings: { helloTimeoutMs: 500 },
      },
    );
    const edge = await startEdge(gate.webPort);
    const started = { id, internalPort, gate, edge };
    instances.set(id, started);
    webPorts.set(id, gate.webPort);
    return started;
  }

  async function stopInstance(id: string): Promise<void> {
    const found = instance(id);
    instances.delete(id);
    webPorts.delete(id);
    await found.gate.stop();
    await found.edge.close();
  }

  async function connectBee(id: string): Promise<FrpcProcess> {
    const client = await startFrpc({
      binary: binaries.frpc,
      edgePort: instance(id).edge.port,
      label: "bee",
      credential: "cred-bee",
      localPort: origin.port,
      subdomains: ["bee", "bee--3000"],
      loginFailExit: true,
    });
    clients.push(client);
    await waitFor(
      () => instance(id).gate.directory.locate("bee").kind === "here",
      15_000,
      `bee to connect to ${id}`,
    );
    return client;
  }

  function via(entry: string, host: string, path: string, init = {}) {
    const options = init as {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    return visit(fly.port, host, path, {
      ...options,
      headers: { ...owner, ...options.headers, [ENTRY_HEADER]: entry },
    });
  }

  function internal(id: string, path: string, headers: Record<string, string>) {
    return new Promise<number>((resolve, reject) => {
      const sent = http.request(
        {
          host: "127.0.0.1",
          port: instance(id).internalPort,
          path,
          headers,
          agent: false,
        },
        (answer) => {
          answer.resume();
          resolve(answer.statusCode ?? 0);
        },
      );
      sent.on("error", reject);
      sent.end();
    });
  }

  beforeAll(async () => {
    if (!availability.ok) return;
    binaries = availability.binaries;
    keys = await testKeys();
    account = await startAccountApi(fixture);
    origin = await startOrigin({
      keys: keys.keys,
      audience: gateAudienceForServer("srv-bee"),
    });
    blackHole = await startBlackHole();
    for (const id of ["m-a", "m-b", "m-c"]) {
      internalPorts.set(id, await freePort());
    }
    for (const id of ["m-a", "m-b", "m-c"]) await startInstance(id);
    fly = await startFlyProxy(webPorts);
    first = await connectBee("m-b");
    await waitFor(
      () =>
        instance("m-a").gate.directory.locate("bee").kind === "elsewhere" &&
        instance("m-c").gate.directory.locate("bee").kind === "elsewhere",
      5_000,
      "the other machines to hear about bee",
    );
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.kill()));
    await Promise.all([...instances.keys()].map((id) => stopInstance(id)));
    await Promise.all([
      fly?.close(),
      blackHole?.close(),
      origin?.close(),
      account?.close(),
    ]);
  });

  it("finds its peers over the injected internal DNS", () => {
    for (const id of instances.keys()) {
      expect(instance(id).gate.regions?.peerCount()).toBe(3);
    }
    expect(instance("m-a").gate.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "m-b",
    });
  });

  it("replays a visitor on A to the tunnel on B", async () => {
    const answer = await via("m-a", BEE, "/echo?x=1");
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ ok: true, url: "/echo?x=1" });
    expect(fly.chains.at(-1)).toEqual(["m-a", "m-b"]);
    expect(origin.seen.at(-1)?.assertion).toMatchObject({
      ok: true,
      claims: { aud: "server:srv-bee", sub: OWNER, target: null },
    });
    expect(origin.seen.at(-1)?.headers["fly-replay-src"]).toBeUndefined();
    const share = await via("m-c", `bee--3000.${BASE_DOMAIN}`, "/s");
    expect(share.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-c", "m-b"]);
    expect(origin.seen.at(-1)?.assertion).toMatchObject({
      ok: true,
      claims: { target: "3000" },
    });
    const local = await via("m-b", BEE, "/echo");
    expect(local.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-b"]);
    expect(fly.failures).toEqual([]);
  });

  it("refreshes a session only on the gate that serves the visit", async () => {
    const before = account.refreshes.length;
    const answer = await via("m-a", BEE, "/echo?refresh=1", {
      headers: { cookie: `${SESSION}=sess-refresh` },
    });
    expect(answer.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-a", "m-b"]);
    expect(answer.headers["set-cookie"]).toEqual([fixture.refreshSetCookie]);
    expect(account.refreshes.length - before).toBe(1);
  });

  it("answers sign-in locally without asking peers", async () => {
    const answer = await visit(fly.port, BEE, "/api/v1/threads", {
      headers: { [ENTRY_HEADER]: "m-a" },
    });
    expect(answer.status).toBe(401);
    expect(fly.chains.at(-1)).toEqual(["m-a"]);
  });

  it("replays a WebSocket upgrade", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${fly.port}/ws`, {
      headers: { ...owner, host: BEE, [ENTRY_HEADER]: "m-a" },
    });
    const reply = await new Promise<string>((resolve, reject) => {
      socket.on("open", () => socket.send("hi"));
      socket.on("message", (data) => resolve(String(data)));
      socket.on("error", reject);
    });
    socket.close();
    expect(reply).toBe("echo:hi");
    expect(fly.chains.at(-1)).toEqual(["m-a", "m-b"]);
    expect(fly.failures).toEqual([]);
  });

  it("proxies bodies too large to replay over the private network", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 7);
    const answer = await via("m-a", BEE, "/upload", {
      method: "POST",
      headers: { origin: `http://${BEE}`, "content-type": "text/plain" },
      body: big,
    });
    expect(answer.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-a"]);
    const seen = origin.seen.at(-1);
    expect(seen?.url).toBe("/upload");
    expect(seen?.body.length).toBe(big.length);
    expect(seen?.headers["x-bb-gate-peer-auth"]).toBeUndefined();
    expect(seen?.assertion).toMatchObject({
      ok: true,
      claims: { htm: "POST", htu: "/upload" },
    });

    const chunked = await postChunked(
      fly.port,
      BEE,
      "/stream",
      { ...owner, origin: `http://${BEE}`, [ENTRY_HEADER]: "m-c" },
      [Buffer.from("one,"), Buffer.from("two,"), Buffer.from("three")],
    );
    expect(chunked.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-c"]);
    expect(origin.seen.at(-1)?.body).toBe("one,two,three");
    expect(fly.failures).toEqual([]);
  });

  it("does not replay a replayed request again", async () => {
    const state = replayState(PEER_SECRET, "bee", "m-c", Date.now());
    const replayed = await visit(instance("m-c").gate.webPort, BEE, "/echo", {
      headers: {
        ...owner,
        "fly-replay-src": `instance=m-a;region=x;t=1;state=${state}`,
      },
    });
    expect(replayed.status).toBe(200);
    expect(replayed.headers["fly-replay"]).toBeUndefined();
    expect(origin.seen.at(-1)?.headers["fly-replay-src"]).toBeUndefined();

    const forged = await visit(instance("m-c").gate.webPort, BEE, "/echo", {
      headers: {
        ...owner,
        "fly-replay-src": `instance=m-a;state=${state.slice(0, -2)}xx`,
      },
    });
    expect(forged.status).toBe(409);
    expect(forged.headers["fly-replay"]).toMatch(/^instance=m-b;state=/u);

    const elsewhere = replayState(PEER_SECRET, "bee", "m-a", Date.now());
    const misdirected = await visit(
      instance("m-c").gate.webPort,
      BEE,
      "/echo",
      {
        headers: {
          ...owner,
          "fly-replay-src": `instance=m-a;state=${elsewhere}`,
        },
      },
    );
    expect(misdirected.status).toBe(409);
  });

  it("refuses peer requests without the shared secret", async () => {
    expect(await internal("m-b", "/__peer/labels/bee", {})).toBe(401);
    expect(
      await internal("m-b", "/__peer/labels/bee", {
        authorization: "Bearer wrong",
      }),
    ).toBe(401);
    expect(
      await internal("m-b", "/__peer/labels/bee", {
        authorization: `Bearer ${PEER_SECRET}`,
      }),
    ).toBe(200);
    const before = origin.seen.length;
    expect(
      await internal("m-b", "/echo", {
        host: BEE,
        "x-bb-gate-peer-auth": "Bearer wrong",
      }),
    ).toBe(401);
    expect(origin.seen.length).toBe(before);
    expect(
      await internal("m-b", "/echo", {
        host: BEE,
        "x-bb-gate-peer-auth": `Bearer ${PEER_SECRET}`,
      }),
    ).toBe(401);
    expect(origin.seen.length).toBe(before + 1);
    expect(origin.seen.at(-1)?.assertion).toBeNull();
    const upgrade = await new Promise<number>((resolve) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${instance("m-b").internalPort}/ws`,
        { headers: { host: BEE, "x-bb-gate-peer-auth": "Bearer wrong" } },
      );
      socket.on("unexpected-response", (_request, answer) =>
        resolve(answer.statusCode ?? 0),
      );
      socket.on("error", () => resolve(-1));
    });
    expect(upgrade).toBe(401);
  });

  it("answers offline quickly when a peer does not answer", async () => {
    const started = Date.now();
    const answer = await via("m-a", `moth.${BASE_DOMAIN}`, "/");
    const elapsed = Date.now() - started;
    expect(answer.status).toBe(503);
    expect(answer.text).toContain("offline");
    expect(elapsed).toBeLessThan(1_500);
    expect(fly.chains.at(-1)).toEqual(["m-a"]);
  });

  it("moves a label to the newest tunnel and drops the older one", async () => {
    const presenceBefore = account.presence.length;
    expect(instance("m-b").gate.frpConnections.count("bee")).toBe(1);
    first.child.kill("SIGSTOP");
    await connectBee("m-c");
    await waitFor(
      () =>
        instance("m-b").gate.directory.locate("bee").kind === "elsewhere" &&
        instance("m-a").gate.directory.locate("bee").kind === "elsewhere",
      5_000,
      "the move to be heard",
    );
    expect(instance("m-a").gate.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "m-c",
    });
    expect(instance("m-b").gate.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "m-c",
    });
    await waitFor(
      () => instance("m-b").gate.frpConnections.count("bee") === 0,
      5_000,
      "m-b to close the older client",
    );
    await waitFor(
      () =>
        locals.get("m-b")?.locate("bee").kind === "offline" &&
        locals.get("m-b")?.locate("bee--3000").kind === "offline",
      5_000,
      "m-b to drop the older proxy",
    );
    const answer = await via("m-a", BEE, "/echo");
    expect(answer.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-a", "m-c"]);
    const fromB = await via("m-b", BEE, "/echo");
    expect(fromB.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-b", "m-c"]);
    await Promise.all(
      [...instances.values()].map((entry) => entry.gate.settlePresence()),
    );
    const reports = account.presence.slice(presenceBefore);
    expect(reports).toContainEqual(
      expect.objectContaining({
        label: "bee",
        state: "connected",
        gateMachineId: "m-c",
      }),
    );
    expect(
      reports.some(
        (report) =>
          report.gateMachineId === "m-b" && report.state === "disconnected",
      ),
    ).toBe(false);
    await first.kill();
    expect(fly.failures).toEqual([]);
  });

  it("rebuilds its map from peer snapshots after a restart", async () => {
    await stopInstance("m-a");
    const restarted = await startInstance("m-a");
    expect(restarted.gate.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "m-c",
    });
    const answer = await via("m-a", BEE, "/echo");
    expect(answer.status).toBe(200);
    expect(fly.chains.at(-1)).toEqual(["m-a", "m-c"]);
    expect(fly.failures).toEqual([]);
  });

  it("fails over within a few seconds when the holder stops, even through an edge that keeps the client open", async () => {
    const failover = await startEdge(() => [fly.port], {
      holdClient: true,
      header: {
        name: ENTRY_HEADER,
        value: () => (instances.has("m-c") ? "m-c" : "m-b"),
      },
    });
    try {
      await Promise.all(clients.map((client) => client.kill()));
      await waitFor(
        () => locals.get("m-c")?.locate("bee").kind === "offline",
        5_000,
        "bee to leave m-c",
      );
      const client = await startFrpc({
        binary: binaries.frpc,
        edgePort: failover.port,
        label: "bee",
        credential: "cred-bee",
        localPort: origin.port,
        subdomains: ["bee"],
        loginFailExit: true,
      });
      clients.push(client);
      await waitFor(
        () => instance("m-c").gate.directory.locate("bee").kind === "here",
        10_000,
        "bee to connect to m-c",
      );
      const socket = new WebSocket(`ws://127.0.0.1:${fly.port}/ws`, {
        headers: { ...owner, host: BEE, [ENTRY_HEADER]: "m-c" },
      });
      await new Promise<void>((resolve, reject) => {
        socket.on("open", () => resolve());
        socket.on("error", reject);
      });
      const socketClosed = new Promise<void>((resolve) =>
        socket.on("close", () => resolve()),
      );
      const presenceBefore = account.presence.length;
      const stopping = Date.now();
      const leaving = instance("m-c");
      const stopped = leaving.gate.stop().then(async () => {
        instances.delete("m-c");
        webPorts.delete("m-c");
        await leaving.edge.close();
      });
      await socketClosed;
      const holder = () =>
        ["m-a", "m-b"].find(
          (id) => locals.get(id)?.locate("bee").kind === "here",
        );
      await waitFor(
        () => holder() !== undefined,
        5_000,
        "bee to fail over while m-c drains",
      );
      const failoverMs = Date.now() - stopping;
      const during = await via("m-c", BEE, "/echo");
      const health = await visit(
        leaving.gate.webPort,
        "anything",
        "/__gate/health",
      );
      await stopped;
      const stopMs = Date.now() - stopping;
      expect(failoverMs).toBeLessThan(DRAIN_MS);
      expect(stopMs).toBeLessThan(DRAIN_MS + 1_500);
      expect(during.status).toBe(200);
      expect(health.status).toBe(503);
      expect(fly.chains.at(-1)?.[0]).toBe("m-c");
      expect(fly.chains.at(-1)?.at(-1)).toBe(holder());
      await Promise.all(
        [...instances.values()].map((entry) => entry.gate.settlePresence()),
      );
      const reports = account.presence.slice(presenceBefore);
      expect(reports).toContainEqual(
        expect.objectContaining({
          label: "bee",
          state: "disconnected",
          gateMachineId: "m-c",
        }),
      );
      expect(reports).toContainEqual(
        expect.objectContaining({
          label: "bee",
          state: "connected",
          gateMachineId: holder(),
        }),
      );
      const answer = await via("m-a", BEE, "/echo");
      expect(answer.status).toBe(200);
      expect(fly.failures).toEqual([]);
    } finally {
      await failover.close();
    }
  });
});
