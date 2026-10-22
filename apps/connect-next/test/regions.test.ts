import { afterEach, describe, expect, it } from "vitest";
import { configFromEnv } from "../src/config.js";
import {
  createLocalDirectory,
  type TunnelDirectory,
} from "../src/directory.js";
import { silentLog } from "../src/log.js";
import { createPeerServer } from "../src/peer-server.js";
import {
  bearerMatches,
  createRegions,
  replayState,
  replayStateFrom,
  verifyReplayState,
  type Regions,
} from "../src/regions.js";
import { closeServer, listen, waitFor } from "./harness.js";

const SECRET = "unit-peer-secret-0123456789abcdef0123";

interface Node {
  id: string;
  url: string;
  local: TunnelDirectory;
  regions: Regions;
  asked: string[];
  superseded: string[];
  presence: string[];
  stop(): Promise<void>;
}

const nodes: Node[] = [];

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop()));
});

async function startNode(
  id: string,
  peers: () => string[],
  options: { now?: () => number } = {},
): Promise<Node> {
  const local = createLocalDirectory({ graceMs: 200 });
  const regions = createRegions({
    local,
    self: { machineId: id, region: `r-${id}` },
    secret: SECRET,
    resolvePeers: async () => peers(),
    refreshMs: 60_000,
    helloTimeoutMs: 300,
    log: silentLog,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const asked: string[] = [];
  const superseded: string[] = [];
  const presence: string[] = [];
  regions.onSuperseded((label) => superseded.push(label));
  regions.directory.onLabelPresence((label, state) =>
    presence.push(`${label}:${state}`),
  );
  const peer = createPeerServer({
    regions,
    directory: regions.directory,
    baseDomain: "next.test",
    vhost: { host: "127.0.0.1", port: 1 },
    log: silentLog,
  });
  peer.server.prependListener("request", (request) => {
    if (request.url?.startsWith("/__peer/labels/")) asked.push(request.url);
  });
  const url = `http://127.0.0.1:${await listen(peer.server)}`;
  const node: Node = {
    id,
    url,
    local,
    regions,
    asked,
    superseded,
    presence,
    async stop() {
      await regions.stop(100);
      await closeServer(peer.server);
      peer.close();
    },
  };
  nodes.push(node);
  return node;
}

function proxy(label: string, clientId = "c1") {
  return { label, subdomain: label, clientId };
}

const never = new AbortController().signal;

describe("regional directory", () => {
  it("looks a label up on a miss and caches the negative answer briefly", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const x = await startNode("x", () => []);
    const y = await startNode("y", () => [x.url], { now });
    await y.regions.start();
    x.local.connected(proxy("bee"));
    expect(y.regions.directory.locate("bee").kind).toBe("offline");
    expect(
      await y.regions.directory.lookup("bee--8080", {
        signal: never,
        fresh: false,
      }),
    ).toEqual({ kind: "elsewhere", instance: "x" });
    expect(x.asked).toEqual(["/__peer/labels/bee"]);
    await y.regions.directory.lookup("bee", { signal: never, fresh: false });
    expect(x.asked).toHaveLength(1);

    for (let index = 0; index < 3; index += 1) {
      expect(
        await y.regions.directory.lookup("wasp", {
          signal: never,
          fresh: false,
        }),
      ).toEqual({ kind: "offline" });
    }
    expect(x.asked.filter((url) => url.endsWith("/wasp"))).toHaveLength(1);
    clock += 2_500;
    await y.regions.directory.lookup("wasp", { signal: never, fresh: false });
    expect(x.asked.filter((url) => url.endsWith("/wasp"))).toHaveLength(2);
  });

  it("lets the newest tunnel win and closes the older one", async () => {
    let clock = 5_000;
    const urls: string[] = [];
    const x = await startNode("x", () => urls, { now: () => clock });
    const y = await startNode("y", () => urls, { now: () => clock });
    urls.push(x.url, y.url);
    await Promise.all([x.regions.start(), y.regions.start()]);
    x.local.connected(proxy("bee", "old"));
    await waitFor(
      () => y.regions.directory.locate("bee").kind === "elsewhere",
      2_000,
      "y to hear x",
    );
    clock += 10;
    y.local.connected(proxy("bee", "new"));
    await waitFor(() => x.superseded.length === 1, 2_000, "x to step back");
    expect(x.regions.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "y",
    });
    expect(x.regions.directory.onlineLabels()).toEqual([]);
    x.local.disconnected(proxy("bee", "old"));
    expect(x.presence).toEqual(["bee:connected"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(y.regions.directory.locate("bee").kind).toBe("here");
    expect(x.regions.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "y",
    });
  });

  it("re-announces when an older tunnel is announced late", async () => {
    const x = await startNode("x", () => []);
    x.local.connected(proxy("bee"));
    x.regions.receive({
      label: "bee",
      machineId: "y",
      region: "r-y",
      state: "connected",
      at: 1,
    });
    expect(x.superseded).toEqual([]);
    expect(x.regions.directory.locate("bee").kind).toBe("here");
  });

  it("ignores a stale disconnect and drops a restarted peer's labels", async () => {
    const x = await startNode("x", () => []);
    x.regions.receive({
      label: "bee",
      machineId: "y",
      region: "r",
      state: "connected",
      at: 100,
    });
    x.regions.receive({
      label: "bee",
      machineId: "z",
      region: "r",
      state: "disconnected",
      at: 200,
    });
    x.regions.receive({
      label: "bee",
      machineId: "y",
      region: "r",
      state: "disconnected",
      at: 50,
    });
    expect(x.regions.directory.locate("bee")).toEqual({
      kind: "elsewhere",
      instance: "y",
    });
    x.regions.answerHello({ machineId: "y", region: "r", startedAt: 150 });
    expect(x.regions.directory.locate("bee").kind).toBe("offline");
  });

  it("wakes a waiting visitor when the label returns on another machine", async () => {
    const x = await startNode("x", () => []);
    x.local.connected(proxy("bee"));
    x.local.disconnected(proxy("bee"));
    const waiting = x.regions.directory.awaitReturn("bee", never);
    setTimeout(
      () =>
        x.regions.receive({
          label: "bee",
          machineId: "y",
          region: "r",
          state: "connected",
          at: Date.now(),
        }),
      20,
    );
    expect(await waiting).toEqual({ kind: "elsewhere", instance: "y" });
  });
});

describe("peer secrets and replay state", () => {
  it("compares bearers without leaking length", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches("Bearer x", SECRET)).toBe(false);
    expect(bearerMatches(undefined, SECRET)).toBe(false);
  });

  it("binds replay state to label, instance and time", () => {
    const now = Date.now();
    const state = replayState(SECRET, "bee", "m1", now);
    expect(verifyReplayState(SECRET, state, "bee", "m1", now)).toBe(true);
    expect(verifyReplayState(SECRET, state, "wasp", "m1", now)).toBe(false);
    expect(verifyReplayState(SECRET, state, "bee", "m2", now)).toBe(false);
    expect(verifyReplayState("other", state, "bee", "m1", now)).toBe(false);
    expect(verifyReplayState(SECRET, state, "bee", "m1", now + 120_000)).toBe(
      false,
    );
    expect(replayStateFrom(`instance=m0;region=sjc;t=1;state=${state}`)).toBe(
      state,
    );
    expect(replayStateFrom("instance=m0")).toBeNull();
  });

  it("reads the peer configuration", async () => {
    const key = JSON.stringify({
      kid: "k1",
      kty: "OKP",
      crv: "Ed25519",
      x: "x",
      d: "d",
    });
    const base = {
      ACCOUNT_API_URL: "https://connect.getbb.app",
      GATE_SECRET: "s",
      GATE_SIGNING_KEY: key,
    };
    expect(configFromEnv(base).peers).toBeNull();
    expect(
      configFromEnv({ ...base, PEER_SECRET: SECRET, FLY_APP_NAME: "app" })
        .peers,
    ).toEqual({
      secret: SECRET,
      appName: "app",
      internalPort: 7100,
      internalBindHost: "fly-local-6pn",
      refreshMs: 30_000,
    });
    expect(() => configFromEnv({ ...base, PEER_SECRET: SECRET })).toThrow(
      "FLY_APP_NAME",
    );
    expect(() =>
      configFromEnv({ ...base, PEER_SECRET: "short", FLY_APP_NAME: "a" }),
    ).toThrow("PEER_SECRET");
  });
});
