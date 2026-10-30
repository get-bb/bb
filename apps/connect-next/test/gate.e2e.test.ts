import type { IncomingMessage } from "node:http";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  MCP_LOCAL_PATH,
  GATE_OAUTH_CLIENT_HEADER,
  GATE_OAUTH_GRANT_HEADER,
  GATE_OAUTH_SCOPE_HEADER,
} from "@bb/connect-db";
import {
  FRP_LOGIN_REFUSED_REASON,
  GATE_ASSERTION_HEADER,
  verifyGateAssertion,
} from "@bb/tunnel-contract/next";
import { createLocalDirectory } from "../src/directory.js";
import { silentLog } from "../src/log.js";
import { startConnectNext, type ConnectNext } from "../src/service.js";
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
if (!availability.ok)
  console.warn(`skipping connect-next e2e: ${availability.reason}`);

const OWNER = "user-owner";
const OTHER = "user-other";
const SESSION = "better-auth.session_token";
const DESKTOP = "bb-connect.desktop_session";
const BEE = `bee.${BASE_DOMAIN}`;
const GRACE_MS = 2_000;
const HEAD_MS = 3_000;

const fixture: AccountFixture = {
  labels: {
    bee: {
      kind: "server",
      serverId: "srv-bee",
      userId: OWNER,
      revoked: false,
      lastSeenAt: Date.now() - 5 * 60_000,
      credential: "cred-bee",
    },
    wasp: {
      kind: "server",
      serverId: "srv-wasp",
      userId: OWNER,
      revoked: false,
      lastSeenAt: null,
      credential: "cred-wasp",
    },
    moth: {
      kind: "server",
      serverId: "srv-moth",
      userId: OWNER,
      revoked: false,
      lastSeenAt: null,
      credential: "cred-moth",
    },
    mach: {
      kind: "machine",
      machineId: "machine-1",
      userId: OWNER,
      accountHandle: "owner",
      routingKey: "rk-mach",
      revoked: false,
      lastSeenAt: null,
      credential: "cred-mach",
    },
  },
  sessions: {
    "sess-owner": { userId: OWNER, needsRefresh: false },
    "sess-stranger": { userId: OTHER, needsRefresh: false },
    "sess-refresh": { userId: OWNER, needsRefresh: true },
  },
  desktopSessions: {
    "desk-owner": {
      userId: OWNER,
      setCookie: `${DESKTOP}=renewed; Path=/; HttpOnly`,
    },
  },
  machines: {
    "mc-owner": { machineId: "machine-owner", userId: OWNER },
    "mc-other": { machineId: "machine-other", userId: OTHER },
  },
  oauth: {
    "tok-good": {
      resource: `http://${BEE}/mcp`,
      grant: {
        scope: "bb",
        grantId: "grant-1",
        clientName: "Claude\u0007 Desktop",
      },
    },
    "tok-other": {
      resource: `http://wasp.${BASE_DOMAIN}/mcp`,
      grant: { scope: "bb", grantId: "grant-2", clientName: "x" },
    },
  },
  refreshSetCookie: `${SESSION}=refreshed; Domain=.getbb.app; Path=/; HttpOnly`,
};

const owner = { cookie: `${SESSION}=sess-owner` };

const machineLabelCalls: Array<{ credential: string; body: string }> = [];

describe.skipIf(!availability.ok)("connect-next gate end to end", () => {
  let binaries: FrpBinaries;
  let account: Awaited<ReturnType<typeof startAccountApi>>;
  let origin: Awaited<ReturnType<typeof startOrigin>>;
  let edge: Awaited<ReturnType<typeof startEdge>>;
  let gate: ConnectNext;
  let keys: Awaited<ReturnType<typeof testKeys>>;
  let bee: FrpcProcess;
  const clients: FrpcProcess[] = [];

  const get = (path: string, headers: Record<string, string> = owner) =>
    visit(gate.webPort, BEE, path, { headers });

  async function connect(
    label: string,
    credential: string,
    subdomains: string[],
    localPort: number = origin.port,
  ): Promise<FrpcProcess> {
    const client = await startFrpc({
      binary: binaries.frpc,
      edgePort: edge.port,
      label,
      credential,
      localPort,
      subdomains,
      loginFailExit: true,
    });
    clients.push(client);
    return client;
  }

  async function connectBee(): Promise<FrpcProcess> {
    const client = await connect("bee", "cred-bee", ["bee", "bee--3000"]);
    await waitFor(
      () =>
        gate.directory.locate("bee").kind === "here" &&
        gate.directory.locate("bee--3000").kind === "here",
      15_000,
      "bee to connect",
    );
    return client;
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
    gate = await startConnectNext(
      {
        baseDomain: BASE_DOMAIN,
        scheme: "http",
        accountApiUrl: account.url,
        gateSecret: GATE_SECRET,
        accountAppUrl: account.url,
        signingKeyJwk: keys.privateJwk,
        assetLinksFingerprints: "",
        region: "test-region",
        gateMachineId: "gate-machine-1",
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
        peers: null,
      },
      silentLog,
      {
        directory: createLocalDirectory({ graceMs: GRACE_MS }),
        deadlines: { headMs: HEAD_MS, transcriptionHeadMs: HEAD_MS * 3 },
        machineLabels: {
          async assign(credential, body) {
            machineLabelCalls.push({ credential, body: body.toString() });
            return {
              status: 200,
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ label: "laptop" }),
            };
          },
        },
      },
    );
    edge = await startEdge(gate.webPort);
    bee = await connectBee();
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.kill()));
    await gate?.stop();
    await Promise.all([edge?.close(), origin?.close(), account?.close()]);
  });

  describe("machine label assignment", () => {
    it("relays a machine's label request on a server address to the account API", async () => {
      const assigned = await visit(
        gate.webPort,
        BEE,
        "/api/connect/machine-label",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bb-connect-machine": "cred-machine",
          },
          body: JSON.stringify({ desiredName: "Laptop" }),
        },
      );
      expect(assigned.status).toBe(200);
      expect(JSON.parse(assigned.text)).toEqual({ label: "laptop" });
      expect(machineLabelCalls.at(-1)).toEqual({
        credential: "cred-machine",
        body: JSON.stringify({ desiredName: "Laptop" }),
      });

      const bare = await visit(
        gate.webPort,
        BEE,
        "/api/connect/machine-label",
        {
          method: "POST",
          body: "{}",
        },
      );
      expect(bare.status).toBe(401);
      const wrongMethod = await visit(
        gate.webPort,
        BEE,
        "/api/connect/machine-label",
        { headers: { "x-bb-connect-machine": "cred-machine" } },
      );
      expect(wrongMethod.status).toBe(405);
      const tooLarge = await visit(
        gate.webPort,
        BEE,
        "/api/connect/machine-label",
        {
          method: "POST",
          headers: { "x-bb-connect-machine": "cred-machine" },
          body: "x".repeat(5000),
        },
      );
      expect(tooLarge.status).toBe(413);
      expect(machineLabelCalls).toHaveLength(1);
    });
  });

  describe("frp admission", () => {
    it("dials through the WebSocket transport on the tunnel host", () => {
      expect(
        edge.connects.every((target) => target === `tunnel.${BASE_DOMAIN}:80`),
      ).toBe(true);
      expect(edge.connects.length).toBeGreaterThan(0);
    });

    it("reports presence for the label it holds", async () => {
      await gate.settlePresence();
      expect(account.presence).toContainEqual(
        expect.objectContaining({
          label: "bee",
          state: "connected",
          region: "test-region",
          gateMachineId: "gate-machine-1",
        }),
      );
      expect(
        account.presence.some((report) => report.label === "bee--3000"),
      ).toBe(false);
    });

    it("refuses a login with the wrong credential", async () => {
      const client = await connect("wasp", "cred-wrong", ["wasp"]);
      await waitFor(
        () => client.child.exitCode !== null,
        15_000,
        "frpc to give up",
      );
      expect(client.output()).toContain(FRP_LOGIN_REFUSED_REASON);
      expect(gate.directory.locate("wasp").kind).toBe("offline");
    });

    it("logs a client in through a brief account API outage instead of refusing it", async () => {
      const batchesBefore = account.resolveBatches.length;
      account.failNext(3);
      const client = await connect("moth", "cred-moth", ["moth"]);
      await waitFor(
        () => gate.directory.locate("moth").kind === "here",
        10_000,
        "moth to connect",
      );
      expect(client.output()).not.toContain("could not check");
      expect(client.output()).toContain("login to server success");
      expect(account.resolveBatches.length).toBeGreaterThan(batchesBefore);
      await gate.settlePresence();
      expect(account.presenceBatches.length).toBeGreaterThan(0);
      await client.kill();
    });

    it("refuses a client claiming another label's address", async () => {
      const client = await connect("wasp", "cred-wasp", [
        "bee",
        "wasp--abc",
        "bee--4000",
      ]);
      await waitFor(
        () =>
          (client.output().match(/not this server's address/gu) ?? []).length >=
          2,
        15_000,
        "the proxies to be refused",
      );
      expect(gate.directory.locate("bee--4000").kind).toBe("offline");
      await client.kill();
      expect(gate.directory.locate("bee").kind).toBe("here");
    });
  });

  describe("visitors", () => {
    it("answers health checks on any host", async () => {
      const health = await visit(
        gate.webPort,
        "10.0.0.1:8080",
        "/__gate/health",
      );
      expect(health.status).toBe(200);
    });

    it("404s unknown hosts and gate paths, redirects reserved handles", async () => {
      expect((await visit(gate.webPort, "example.com", "/")).status).toBe(404);
      expect((await get("/__tunnel")).status).toBe(404);
      const reserved = await visit(
        gate.webPort,
        `www.${BASE_DOMAIN}`,
        "/pricing?x=1",
      );
      expect(reserved.status).toBe(301);
      expect(reserved.headers.location).toBe(`${account.url}/pricing?x=1`);
      expect(
        (
          await visit(gate.webPort, `nobody.${BASE_DOMAIN}`, "/", {
            headers: owner,
          })
        ).status,
      ).toBe(404);
    });

    it("shows the machine page for a machine label", async () => {
      const page = await visit(
        gate.webPort,
        `mach.${BASE_DOMAIN}`,
        "/anything",
      );
      expect(page.status).toBe(200);
      expect(page.text).toContain("is a machine");
    });

    it("sends visitors without a session to sign in", async () => {
      const html = await get("/threads", { accept: "text/html" });
      expect(html.status).toBe(401);
      expect(html.text).toContain(
        `${account.url}/dashboard?returnTo=${encodeURIComponent(`http://${BEE}/threads`)}`,
      );
      const api = await get("/api/v1/threads", {});
      expect(api.status).toBe(401);
      const forged = await get("/", { cookie: `${SESSION}=forged` });
      expect(forged.status).toBe(401);
    });

    it("refuses another account's session", async () => {
      const stranger = await get("/", { cookie: `${SESSION}=sess-stranger` });
      expect(stranger.status).toBe(403);
      expect(stranger.text).toContain("not your server");
    });

    it("admits the owner with a signed assertion bound to method and path", async () => {
      const before = origin.seen.length;
      const answer = await visit(gate.webPort, BEE, "/echo?q=1&r=%2F", {
        method: "POST",
        headers: {
          ...owner,
          origin: `http://${BEE}`,
          "content-type": "text/plain",
        },
        body: "hello",
      });
      expect(answer.status).toBe(200);
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/echo?q=1&r=%2F");
      expect(seen?.body).toBe("hello");
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: {
          aud: "server:srv-bee",
          sub: OWNER,
          kind: "session",
          htm: "POST",
          htu: "/echo?q=1&r=%2F",
          target: null,
          oauth: null,
        },
      });
      expect(seen?.headers["x-bb-gate-auth"]).toBe("session");
      const token = String(seen?.headers[GATE_ASSERTION_HEADER]);
      const replay = await verifyGateAssertion(token, {
        keys: keys.keys,
        audience: "server:srv-bee",
        method: "POST",
        pathAndQuery: "/api/v1/hosts",
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      expect(replay).toEqual({ ok: false, reason: "wrong_path" });
      const otherMethod = await verifyGateAssertion(token, {
        keys: keys.keys,
        audience: "server:srv-bee",
        method: "DELETE",
        pathAndQuery: "/echo?q=1&r=%2F",
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      expect(otherMethod).toEqual({ ok: false, reason: "wrong_method" });
    });

    it("routes a visitor Host with a port and keeps the port on the upstream Host", async () => {
      const before = origin.seen.length;
      const answer = await visit(gate.webPort, `${BEE}:8443`, "/echo?port=1", {
        headers: { ...owner, origin: `http://${BEE}:8443` },
      });
      expect(answer.status).toBe(200);
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/echo?port=1");
      expect(seen?.headers.host).toBe(`${BEE}:8443`);
      expect(seen?.headers.origin).toBe(`http://${BEE}:8443`);
    });

    it("keeps unusual paths and queries byte for byte through frp", async () => {
      for (const path of [
        "/a/b%2Fc;x?y=a|b&z=%7C",
        "//double//slash/?",
        "/%7euser/caf%C3%A9?q=%E2%9C%93&&k",
        "/sp ace".replace(" ", "%20") + "?a=b+c",
      ]) {
        const answer = await get(path);
        expect(answer.status, path).toBe(200);
        expect(origin.seen.at(-1)?.url).toBe(path);
      }
    });

    it("admits the owner's desktop session and renews its cookie", async () => {
      const answer = await get("/echo", { cookie: `${DESKTOP}=desk-owner` });
      expect(answer.status).toBe(200);
      expect(answer.headers["set-cookie"]).toEqual([
        `${DESKTOP}=renewed; Path=/; HttpOnly`,
      ]);
    });

    it("refreshes a session near expiry through the account app", async () => {
      const answer = await get("/echo", { cookie: `${SESSION}=sess-refresh` });
      expect(answer.status).toBe(200);
      expect(answer.headers["set-cookie"]).toEqual([fixture.refreshSetCookie]);
      expect(account.refreshes).toContain(`${SESSION}=sess-refresh`);
      const resolvesBefore = account.resolves.length;
      await get("/echo", { cookie: `${SESSION}=sess-refresh` });
      expect(account.resolves.length).toBe(resolvesBefore + 1);
    });

    it("refuses foreign origins on state changes and WebSockets", async () => {
      const foreign = await visit(gate.webPort, BEE, "/echo", {
        method: "POST",
        headers: { ...owner, origin: "http://evil.test" },
        body: "x",
      });
      expect(foreign.status).toBe(403);
      const read = await get("/echo", { ...owner, origin: "http://evil.test" });
      expect(read.status).toBe(200);
      const refused = await new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${gate.webPort}/ws`, {
          headers: { host: BEE, ...owner, origin: "http://evil.test" },
        });
        socket.on("unexpected-response", (_request, response) =>
          resolve(response.statusCode ?? 0),
        );
        socket.on("open", () => reject(new Error("opened")));
        socket.on("error", () => {});
      });
      expect(refused).toBe(403);
    });

    it("strips platform cookies and private headers before forwarding", async () => {
      const before = origin.seen.length;
      await get("/echo", {
        cookie: `${SESSION}=sess-owner; theme=dark; ${DESKTOP}=x; __Secure-better-auth.session_data=y`,
        "x-bb-gate-auth": "machine",
        "x-bb-gate-machine-id": "forged",
        "x-bb-gate-oauth-scope": "bb",
        [GATE_ASSERTION_HEADER]: "forged.assertion",
        "x-bb-tunnel-target": "22",
        "x-bb-connect-machine": "mc-owner",
      });
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/echo");
      expect(seen?.assertion?.ok).toBe(true);
      expect(seen?.headers.cookie).toBe("theme=dark");
      expect(seen?.headers["x-bb-gate-auth"]).toBe("session");
      expect(seen?.headers["x-bb-gate-machine-id"]).toBeUndefined();
      expect(seen?.headers["x-bb-gate-oauth-scope"]).toBeUndefined();
      expect(seen?.headers["x-bb-tunnel-target"]).toBeUndefined();
      expect(seen?.headers["x-bb-connect-machine"]).toBeUndefined();
      expect(seen?.headers["x-forwarded-host"]).toBe(BEE);
    });

    it("logs an assertion the server refused and answers a plain gate error", async () => {
      const answer = await get("/refuse");
      expect(answer.status).toBe(502);
      expect(answer.text).not.toContain("gate_assertion_invalid");
      const plain401 = await get("/plain-401");
      expect(plain401.status).toBe(401);
      expect(JSON.parse(plain401.text)).toEqual({ code: "nope" });
    });

    it("drops platform and Domain= cookies from responses", async () => {
      const answer = await get("/set-cookies");
      expect(answer.headers["set-cookie"]).toEqual(["kept=1; Path=/"]);
    });

    it("serves shares with the port as target", async () => {
      const before = origin.seen.length;
      const share = await visit(
        gate.webPort,
        `bee--3000.${BASE_DOMAIN}`,
        "/echo",
        {
          headers: owner,
        },
      );
      expect(share.status).toBe(200);
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/echo");
      expect(seen?.headers.host).toBe(`bee--3000.${BASE_DOMAIN}`);
      expect(seen?.headers["x-bb-tunnel-target"]).toBeUndefined();
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: { target: "3000" },
      });
      const unshared = await visit(
        gate.webPort,
        `bee--5173.${BASE_DOMAIN}`,
        "/echo",
        {
          headers: owner,
        },
      );
      expect(unshared.status).toBe(503);
      const main = origin.seen.filter((entry) => entry.headers.host === BEE);
      expect(
        main.every(
          (entry) =>
            entry.assertion?.ok && entry.assertion.claims.target === null,
        ),
      ).toBe(true);
      const internal = await visit(
        gate.webPort,
        `bee--3000.${BASE_DOMAIN}`,
        "/internal/x",
        {
          headers: owner,
        },
      );
      expect(internal.status).toBe(404);
    });
  });

  it("rewrites a share's own Origin to its loopback origin, never a foreign one", async () => {
    const shareHost = `bee--3000.${BASE_DOMAIN}`;
    const before = origin.seen.length;
    const own = await visit(gate.webPort, shareHost, "/echo?own", {
      method: "POST",
      headers: { ...owner, origin: `http://${shareHost}` },
      body: "x",
    });
    expect(own.status).toBe(200);
    const foreign = await visit(gate.webPort, shareHost, "/echo?foreign", {
      headers: { ...owner, origin: "http://evil.test" },
    });
    expect(foreign.status).toBe(200);
    const main = await visit(gate.webPort, BEE, "/echo?main", {
      method: "POST",
      headers: { ...owner, origin: `http://${BEE}` },
      body: "x",
    });
    expect(main.status).toBe(200);
    const seen = (url: string) =>
      origin.seen.slice(before).find((entry) => entry.url === url);
    expect(seen("/echo?own")?.headers.origin).toBe("http://127.0.0.1:3000");
    expect(seen("/echo?own")?.assertion).toMatchObject({
      ok: true,
      claims: { target: "3000" },
    });
    expect(seen("/echo?foreign")?.headers.origin).toBe("http://evil.test");
    expect(seen("/echo?main")?.headers.origin).toBe(`http://${BEE}`);

    const echoed = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${gate.webPort}/hmr`, {
        headers: { host: shareHost, ...owner, origin: `http://${shareHost}` },
      });
      socket.on("open", () => socket.send("ping"));
      socket.on("message", (data) => {
        resolve(String(data));
        socket.close();
      });
      socket.on("unexpected-response", (_request, response) =>
        reject(new Error(`upgrade answered ${response.statusCode}`)),
      );
      socket.on("error", reject);
    });
    expect(echoed).toBe("echo:ping");
    const upgrade = seen("/hmr");
    expect(upgrade?.headers.origin).toBe("http://127.0.0.1:3000");
    expect(upgrade?.headers.upgrade).toBe("websocket");
    expect(upgrade?.assertion).toMatchObject({
      ok: true,
      claims: { target: "3000" },
    });
  });

  describe("machine credentials", () => {
    it("admits a machine of the server's owner", async () => {
      const before = origin.seen.length;
      const answer = await get("/api/v1/projects", {
        "x-bb-connect-machine": "mc-owner",
      });
      expect(answer.status).toBe(200);
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/api/v1/projects");
      expect(seen?.headers["x-bb-gate-auth"]).toBe("machine");
      expect(seen?.headers["x-bb-gate-machine-id"]).toBe("machine-owner");
      expect(seen?.headers["x-bb-connect-machine"]).toBeUndefined();
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: { kind: "machine", sub: "machine-owner" },
      });
    });

    it("refuses other machines, host management and /internal without one", async () => {
      expect(
        (await get("/internal/x", { "x-bb-connect-machine": "mc-other" }))
          .status,
      ).toBe(403);
      expect(
        (await get("/internal/x", { "x-bb-connect-machine": "nope" })).status,
      ).toBe(403);
      const manage = await visit(gate.webPort, BEE, "/api/v1/hosts/h1", {
        method: "PATCH",
        headers: { "x-bb-connect-machine": "mc-owner" },
      });
      expect(manage.status).toBe(403);
      expect(manage.text).toContain("cannot manage hosts");
      const enroll = await visit(
        gate.webPort,
        BEE,
        "/internal/hosts/enroll-key",
        {
          method: "POST",
          headers: { "x-bb-connect-machine": "mc-owner" },
        },
      );
      expect(enroll.status).toBe(403);
      expect((await get("/internal/x")).status).toBe(403);
      const share = await visit(
        gate.webPort,
        `bee--3000.${BASE_DOMAIN}`,
        "/api/v1/x",
        {
          headers: { "x-bb-connect-machine": "mc-owner" },
        },
      );
      expect(share.status).toBe(404);
    });
  });

  describe("MCP", () => {
    it("serves protected resource metadata", async () => {
      for (const path of [
        "/.well-known/oauth-protected-resource",
        "/.well-known/oauth-protected-resource/mcp",
      ]) {
        const answer = await visit(gate.webPort, BEE, path);
        expect(answer.status).toBe(200);
        expect(JSON.parse(answer.text)).toEqual({
          resource: `http://${BEE}/mcp`,
          authorization_servers: [account.url],
          scopes_supported: ["bb"],
          bearer_methods_supported: ["header"],
          resource_name: "bb",
        });
      }
    });

    it("challenges missing and invalid tokens", async () => {
      const missing = await visit(gate.webPort, BEE, "/mcp", {
        method: "POST",
      });
      expect(missing.status).toBe(401);
      expect(missing.headers["www-authenticate"]).toBe(
        `Bearer resource_metadata="http://${BEE}/.well-known/oauth-protected-resource/mcp", scope="bb"`,
      );
      for (const token of ["tok-bad", "tok-other"]) {
        const invalid = await visit(gate.webPort, BEE, "/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(invalid.status).toBe(401);
        expect(invalid.headers["www-authenticate"]).toBe(
          `Bearer error="invalid_token", resource_metadata="http://${BEE}/.well-known/oauth-protected-resource/mcp", scope="bb"`,
        );
      }
    });

    it("forwards a valid token to the local MCP path with OAuth headers", async () => {
      const before = origin.seen.length;
      const answer = await visit(gate.webPort, BEE, "/mcp?session=1", {
        method: "POST",
        headers: {
          authorization: "Bearer tok-good",
          cookie: "theme=dark",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(answer.status).toBe(200);
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url.startsWith(MCP_LOCAL_PATH));
      expect(seen?.url).toBe(`${MCP_LOCAL_PATH}?session=1`);
      expect(seen?.headers.authorization).toBeUndefined();
      expect(seen?.headers.cookie).toBeUndefined();
      expect(seen?.headers["x-bb-gate-auth"]).toBe("oauth");
      expect(seen?.headers[GATE_OAUTH_SCOPE_HEADER]).toBe("bb");
      expect(seen?.headers[GATE_OAUTH_GRANT_HEADER]).toBe("grant-1");
      expect(seen?.headers[GATE_OAUTH_CLIENT_HEADER]).toBe("Claude? Desktop");
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: {
          kind: "oauth",
          sub: OWNER,
          htu: `${MCP_LOCAL_PATH}?session=1`,
          oauth: {
            scope: "bb",
            grantId: "grant-1",
            clientName: "Claude? Desktop",
          },
        },
      });
    });

    it("hides the local MCP path from outside", async () => {
      expect((await get(MCP_LOCAL_PATH)).status).toBe(404);
      expect(
        (await get(MCP_LOCAL_PATH.replace("mcp", "%6dcp").toUpperCase()))
          .status,
      ).toBe(404);
    });
  });

  describe("install paths", () => {
    it("serves install files to anyone with hardened headers", async () => {
      const before = origin.seen.length;
      const answer = await visit(gate.webPort, BEE, "/install.sh");
      expect(answer.status).toBe(200);
      expect(answer.text).toContain("echo install");
      expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(answer.headers["content-security-policy"]).toBe("sandbox");
      expect(answer.headers["x-content-type-options"]).toBe("nosniff");
      expect(answer.headers["content-disposition"]).toBeUndefined();
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/install.sh");
      expect(seen?.headers["x-bb-gate-auth"]).toBeUndefined();
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: { kind: "public", sub: "" },
      });
      const share = await visit(
        gate.webPort,
        `bee--3000.${BASE_DOMAIN}`,
        "/install.sh",
      );
      expect(share.status).toBe(404);
    });
  });

  describe("caching and compression", () => {
    it("caches immutable assets per label", async () => {
      const first = await get("/asset.js", {
        ...owner,
        "accept-encoding": "gzip",
      });
      const second = await get("/asset.js", {
        ...owner,
        "accept-encoding": "gzip",
      });
      expect(first.headers["x-bb-cache"]).toBe("miss");
      expect(second.headers["x-bb-cache"]).toBe("hit");
      expect(origin.counts.get("/asset.js")).toBe(1);
      expect(gunzipSync(second.body).toString()).toBe(
        gunzipSync(first.body).toString(),
      );
      const conditional = await get("/asset.js", {
        ...owner,
        "accept-encoding": "gzip",
        "if-none-match": '"asset-1"',
      });
      expect(conditional.status).toBe(304);
      const stranger = await get("/asset.js", {
        cookie: `${SESSION}=sess-stranger`,
      });
      expect(stranger.status).toBe(403);
      await get("/short.js");
      await get("/short.js");
      expect(origin.counts.get("/short.js")).toBe(2);
    });

    it("revalidates the shell with its etag", async () => {
      const first = await get("/shell");
      expect(first.headers["x-bb-cache"]).toBe("miss");
      const before = origin.seen.length;
      const second = await get("/shell");
      expect(second.status).toBe(200);
      expect(second.headers["x-bb-cache"]).toBe("revalidated");
      expect(second.text).toContain("<title>shell</title>");
      expect(origin.seen.slice(before)[0]?.headers["if-none-match"]).toBe(
        '"shell-1"',
      );
    });

    it("hands renewed cookies to the visitor on cached responses without storing them", async () => {
      const desktop = { cookie: `${DESKTOP}=desk-owner` };
      const renewed = `${DESKTOP}=renewed; Path=/; HttpOnly`;
      for (const path of ["/shell", "/shell", "/asset.js", "/asset.js"]) {
        const answer = await get(path, desktop);
        expect(answer.status, path).toBe(200);
        expect(answer.headers["x-bb-cache"], path).toBeDefined();
        expect(answer.headers["set-cookie"], path).toEqual([renewed]);
      }
      for (const path of ["/shell", "/asset.js"]) {
        const answer = await get(path, owner);
        expect(answer.headers["set-cookie"], path).toBeUndefined();
      }
    });

    it("compresses when the visitor accepts it", async () => {
      const br = await get("/big.json", {
        ...owner,
        "accept-encoding": "gzip, br",
      });
      expect(br.headers["content-encoding"]).toBe("br");
      expect(br.headers.vary).toMatch(/accept-encoding/iu);
      expect(brotliDecompressSync(br.body).toString()).toBe(origin.BIG_JSON);
      expect(br.body.length).toBeLessThan(origin.BIG_JSON.length / 4);
      const gzip = await get("/big.json", {
        ...owner,
        "accept-encoding": "gzip",
      });
      expect(gunzipSync(gzip.body).toString()).toBe(origin.BIG_JSON);
      const plain = await get("/big.json");
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(plain.text).toBe(origin.BIG_JSON);
    });
  });

  describe("WebSockets", () => {
    it("proxies a WebSocket with an assertion", async () => {
      const before = origin.seen.length;
      const socket = new WebSocket(`ws://127.0.0.1:${gate.webPort}/ws?room=1`, {
        headers: { host: BEE, ...owner, origin: `http://${BEE}` },
      });
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.send("hi");
      const message = await new Promise<string>((resolve) =>
        socket.once("message", (data) => resolve(String(data))),
      );
      expect(message).toBe("echo:hi");
      socket.close();
      const seen = origin.seen
        .slice(before)
        .find((entry) => entry.url === "/ws?room=1");
      expect(seen?.assertion).toMatchObject({
        ok: true,
        claims: { kind: "session", htm: "GET", htu: "/ws?room=1" },
      });
    });

    it("negotiates permessage-deflate with the origin through the raw pipe", async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${gate.webPort}/ws`, {
        headers: { host: BEE, ...owner, origin: `http://${BEE}` },
      });
      const upgraded = new Promise<IncomingMessage>((resolve) =>
        socket.once("upgrade", resolve),
      );
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const upgrade = await upgraded;
      expect(socket.extensions).toContain("permessage-deflate");
      const before = upgrade.socket.bytesRead;
      socket.send(origin.BIG_JSON);
      const message = await new Promise<string>((resolve) =>
        socket.once("message", (data) => resolve(String(data))),
      );
      expect(message).toBe(`echo:${origin.BIG_JSON}`);
      expect(upgrade.socket.bytesRead - before).toBeLessThan(
        message.length / 4,
      );
      socket.close();
    });
  });

  describe("deadlines and offline", () => {
    it("answers 504 when the server does not send a response head", async () => {
      const started = Date.now();
      const answer = await get("/slow");
      expect(answer.status).toBe(504);
      expect(answer.text).toContain("stage: response-head");
      expect(Date.now() - started).toBeGreaterThanOrEqual(HEAD_MS - 50);
    });

    it("answers 503 for a label with no tunnel", async () => {
      const api = await visit(gate.webPort, `wasp.${BASE_DOMAIN}`, "/", {
        headers: owner,
      });
      expect(api.status).toBe(503);
      expect(api.headers["x-bb-tunnel-offline"]).toBe("1");
      const html = await visit(gate.webPort, `wasp.${BASE_DOMAIN}`, "/", {
        headers: { ...owner, accept: "text/html" },
      });
      expect(html.status).toBe(503);
      expect(html.text).toContain("Your bb is offline");
    });

    it("waits for a dropped tunnel to come back, then gives up after the grace", async () => {
      await bee.kill();
      await waitFor(
        () => !gate.directory.onlineLabels().includes("bee"),
        10_000,
        "bee to drop",
      );
      await gate.settlePresence();
      expect(account.presence.at(-1)).toMatchObject({
        label: "bee",
        state: "disconnected",
      });
      const pending = get("/echo");
      await new Promise((resolve) => setTimeout(resolve, 200));
      bee = await connectBee();
      expect((await pending).status).toBe(200);

      await bee.kill();
      await waitFor(
        () => gate.directory.locate("bee").kind === "offline",
        10_000,
        "bee to drop",
      );
      const started = Date.now();
      const waited = await get("/echo");
      expect(waited.status).toBe(503);
      expect(Date.now() - started).toBeGreaterThan(GRACE_MS - 600);
      const immediate = Date.now();
      expect((await get("/echo")).status).toBe(503);
      expect(Date.now() - immediate).toBeLessThan(500);
      const cached = await get("/asset.js", {
        ...owner,
        "accept-encoding": "gzip",
      });
      expect(cached.headers["x-bb-cache"]).toBe("hit");
    });

    it("answers with a bb page when nothing listens behind a proxy", async () => {
      const client = await connect(
        "wasp",
        "cred-wasp",
        ["wasp"],
        await freePort(),
      );
      try {
        await waitFor(
          () => gate.directory.locate("wasp").kind === "here",
          15_000,
          "wasp to connect",
        );
        const html = await visit(gate.webPort, `wasp.${BASE_DOMAIN}`, "/", {
          headers: { ...owner, accept: "text/html" },
        });
        expect(html.status).toBe(404);
        expect(html.text).toContain("Nothing answered at this address");
        expect(html.text).not.toContain("frp");
      } finally {
        await client.kill();
      }
    });

    it("answers 502 when the account API fails", async () => {
      account.setFailing(true);
      try {
        const answer = await get("/", { cookie: `${SESSION}=never-seen` });
        expect(answer.status).toBe(502);
      } finally {
        account.setFailing(false);
      }
    });
  });
});
