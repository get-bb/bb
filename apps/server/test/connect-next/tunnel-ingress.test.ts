import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type Server,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { getHost, setExperiments } from "@bb/db";
import {
  GATE_ASSERTION_HEADER,
  generateGateKeyPair,
  signGateAssertion,
  type GateAssertionKind,
  type GateAssertionOAuth,
  type GatePublicKey,
  type GateSigningKey,
} from "@bb/tunnel-contract/next";
import { serverTunnelIngress } from "bb-plugin-bb--connect-next/src/ingress.js";
import {
  VHOST_DOMAIN,
  installTestFrp,
  startFrps,
  startGateHooks,
  waitFor,
} from "@bb/frp-client/testing";
import { NextTunnel } from "bb-plugin-bb--connect-next/src/tunnel.js";
import { tunnelIngressHeaders } from "../../src/services/connect-next/tunnel-ingress.js";
import type { BbPluginApi } from "../../src/services/plugins/plugin-api.js";
import { seedHost } from "../helpers/seed.js";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

const AUDIENCE = "server:srv_ingress";
const PUBLIC_HOST = "ingress-test.next.getbb.app";
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;
const PLUGIN_ID = "ingress-fixture";
const ECHO_PATH = `/api/v1/plugins/${PLUGIN_ID}/http/echo`;
const SOCKET_PATH = `/api/v1/plugins/${PLUGIN_ID}/http/socket`;

const FIXTURE_SOURCE = `
  export default function plugin(bb: any) {
    const gateHeaders = (headers: Headers) => {
      const picked: Record<string, string> = {};
      for (const [name, value] of headers) {
        if (name.startsWith("x-bb-gate-") || name === "host" || name === "origin" || name === "authorization" || name === "cookie") {
          picked[name] = value;
        }
      }
      return picked;
    };
    bb.http.route("GET", "/echo", (c: any) =>
      c.json({ headers: gateHeaders(c.req.raw.headers), url: c.req.url }));
    bb.http.route("POST", "/echo", async (c: any) =>
      c.json({ headers: gateHeaders(c.req.raw.headers), body: await c.req.json() }));
    bb.http.experimental_websocket("/socket", (context: any) => ({
      onOpen(socket: any) {
        socket.send(JSON.stringify(gateHeaders(context.headers)));
      },
      onMessage(socket: any, data: any) {
        socket.send(data);
      },
    }));
  }
`;

interface KeyServer {
  url: string;
  hits: number;
  status: number;
  keys: GatePublicKey[];
  close(): Promise<void>;
}

async function startKeyServer(keys: GatePublicKey[]): Promise<KeyServer> {
  const state: KeyServer = {
    url: "",
    hits: 0,
    status: 200,
    keys,
    close: async () => {},
  };
  const server: Server = createServer((_request, response) => {
    state.hits += 1;
    response.statusCode = state.status;
    response.setHeader("content-type", "application/json");
    response.end(
      state.status === 200 ? JSON.stringify({ keys: state.keys }) : "{}",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("key server did not bind");
  }
  state.url = `http://127.0.0.1:${address.port}/.well-known/bb-connect-gate-keys.json`;
  state.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return state;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function send(
  baseUrl: string,
  args: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<RawResponse> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        method: args.method,
        path: args.path,
        headers: { host: PUBLIC_HOST, ...args.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end(args.body);
  });
}

function json(response: RawResponse): unknown {
  return JSON.parse(response.body);
}

function requireApi(server: RunningTestServer): BbPluginApi {
  const api = server.pluginService.getApi(PLUGIN_ID);
  if (!api) throw new Error("fixture plugin is not running");
  return api;
}

async function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = httpRequest({ host: "127.0.0.1", port, path: "/health" });
    request.on("response", (response) => {
      response.resume();
      resolve(true);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
}

async function canBind(port: number): Promise<boolean> {
  const probe = createNetServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

interface OpenedSocket {
  socket: WebSocket;
  firstMessage: Promise<string>;
}

function openSocket(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<OpenedSocket | { status: number; body: string }> {
  const socket = new WebSocket(`${baseUrl.replace(/^http/u, "ws")}${path}`, {
    headers: { host: PUBLIC_HOST, ...headers },
  });
  const firstMessage = new Promise<string>((resolve) => {
    socket.once("message", (data) => resolve(String(data)));
  });
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve({ socket, firstMessage }));
    socket.once("unexpected-response", (_request, response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    socket.once("error", reject);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

describe("bb connect next tunnel ingress", () => {
  let nowMs: number;
  let signing: GateSigningKey;
  let publicKey: GatePublicKey;
  let keyServer: KeyServer;
  let server: RunningTestServer;
  let workDir: string;
  let ingressBaseUrl: string;

  async function assertion(args: {
    kind?: GateAssertionKind;
    subject?: string;
    method: string;
    path: string;
    audience?: string;
    key?: GateSigningKey;
    nowSeconds?: number;
    oauth?: GateAssertionOAuth | null;
    target?: string | null;
  }): Promise<string> {
    return signGateAssertion(args.key ?? signing, {
      audience: args.audience ?? AUDIENCE,
      subject: args.subject ?? "user_1",
      kind: args.kind ?? "session",
      method: args.method,
      pathAndQuery: args.path,
      target: args.target ?? null,
      oauth: args.oauth ?? null,
      nowSeconds: args.nowSeconds ?? Math.floor(nowMs / 1000),
    });
  }

  async function gated(args: {
    kind?: GateAssertionKind;
    subject?: string;
    oauth?: GateAssertionOAuth | null;
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
    key?: GateSigningKey;
  }): Promise<RawResponse> {
    const token = await assertion(args);
    return send(ingressBaseUrl, {
      method: args.method,
      path: args.path,
      headers: { ...args.headers, [GATE_ASSERTION_HEADER]: token },
      ...(args.body === undefined ? {} : { body: args.body }),
    });
  }

  beforeEach(async () => {
    nowMs = Date.now();
    const pair = await generateGateKeyPair("k1");
    signing = pair.signingKey;
    publicKey = pair.publicKey;
    keyServer = await startKeyServer([publicKey]);
    server = await startTestServer({
      connectGateKeysUrl: keyServer.url,
      tunnelIngressNow: () => nowMs,
    });
    workDir = await mkdtemp(join(tmpdir(), "bb-tunnel-ingress-"));
    const rootDir = join(workDir, "bb-plugin-ingress-fixture");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "bb-plugin-ingress-fixture",
        version: "0.1.0",
        bb: {
          name: "Ingress fixture",
          description: "Tunnel ingress fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), FIXTURE_SOURCE);
    await server.pluginService.installPath(rootDir);
    const ingress = await requireApi(
      server,
    ).server.internal_DO_NOT_USE_openTunnelIngress({ audience: AUDIENCE });
    ingressBaseUrl = ingress.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    await keyServer.close();
    await rm(workDir, { recursive: true, force: true });
  });

  it("runs a verified request with the gate auth kind its claims carry", async () => {
    const host = seedHost(server.deps, { id: "host_ingress", name: "Before" });
    const path = `/api/v1/hosts/${host.id}`;
    const patch = (name: string) => ({
      method: "PATCH",
      path,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });

    const session = await gated({ ...patch("By session"), kind: "session" });
    expect(session.status).toBe(200);
    expect(getHost(server.db, host.id)?.name).toBe("By session");

    const machine = await gated({
      ...patch("By machine"),
      kind: "machine",
      subject: "machine_1",
    });
    expect(machine.status).toBe(403);
    expect(json(machine)).toMatchObject({
      code: "machine_host_management_forbidden",
    });

    const machineSpoofingSession = await gated({
      ...patch("Spoofed session"),
      kind: "machine",
      subject: "machine_1",
      headers: {
        "content-type": "application/json",
        "x-bb-gate-auth": "session",
      },
    });
    expect(machineSpoofingSession.status).toBe(403);

    const sessionSpoofingMachine = await gated({
      ...patch("Session again"),
      kind: "session",
      headers: {
        "content-type": "application/json",
        "x-bb-gate-auth": "machine",
        "x-bb-gate-machine-id": "machine_forged",
      },
    });
    expect(sessionSpoofingMachine.status).toBe(200);
    expect(getHost(server.db, host.id)?.name).toBe("Session again");
  });

  it("refuses requests without a valid assertion and runs nothing", async () => {
    const host = seedHost(server.deps, { id: "host_refused", name: "Kept" });
    const path = `/api/v1/hosts/${host.id}`;
    const body = JSON.stringify({ name: "Changed" });
    const headers = { "content-type": "application/json" };
    const forger = await generateGateKeyPair("k1");
    const cases: Array<{ reason: string; token: string | null }> = [
      { reason: "missing", token: null },
      { reason: "malformed", token: "not-a-token" },
      {
        reason: "expired",
        token: await assertion({
          method: "PATCH",
          path,
          nowSeconds: Math.floor(nowMs / 1000) - 600,
        }),
      },
      {
        reason: "wrong_audience",
        token: await assertion({
          method: "PATCH",
          path,
          audience: "server:someone_else",
        }),
      },
      {
        reason: "wrong_method",
        token: await assertion({ method: "GET", path }),
      },
      {
        reason: "wrong_path",
        token: await assertion({ method: "PATCH", path: `${path}?x=1` }),
      },
      {
        reason: "bad_signature",
        token: await assertion({
          method: "PATCH",
          path,
          key: forger.signingKey,
        }),
      },
      {
        reason: "unexpected_target",
        token: await assertion({ method: "PATCH", path, target: "3000" }),
      },
    ];
    for (const { reason, token } of cases) {
      const response = await send(ingressBaseUrl, {
        method: "PATCH",
        path,
        headers: {
          ...headers,
          "x-bb-gate-auth": "session",
          ...(token === null ? {} : { [GATE_ASSERTION_HEADER]: token }),
        },
        body,
      });
      expect(response.status, reason).toBe(401);
      expect(json(response), reason).toEqual({
        code: "gate_assertion_invalid",
        message: "This request did not come through the bb connect gate",
        reason,
      });
    }
    expect(getHost(server.db, host.id)?.name).toBe("Kept");

    const local = await send(server.baseUrl, {
      method: "PATCH",
      path,
      headers: { ...headers, host: new URL(server.baseUrl).host },
      body,
    });
    expect(local.status).toBe(200);
    expect(getHost(server.db, host.id)?.name).toBe("Changed");
  });

  it("hands plugin routes only the claimed identity with loopback host and origin", async () => {
    const machine = await gated({
      method: "GET",
      path: ECHO_PATH,
      kind: "machine",
      subject: "machine_42",
      headers: {
        origin: PUBLIC_ORIGIN,
        "x-bb-gate-auth": "session",
        "x-bb-gate-machine-id": "machine_forged",
        "x-bb-gate-oauth-scope": "bb",
        "x-bb-gate-owner": "someone",
      },
    });
    expect(machine.status).toBe(200);
    const loopbackOrigin = `http://127.0.0.1:${server.config.serverPort}`;
    expect(json(machine)).toEqual({
      headers: {
        host: new URL(loopbackOrigin).host,
        origin: loopbackOrigin,
        "x-bb-gate-auth": "machine",
        "x-bb-gate-machine-id": "machine_42",
      },
      url: `${loopbackOrigin}${ECHO_PATH}`,
    });

    const oauth = await gated({
      method: "POST",
      path: ECHO_PATH,
      kind: "oauth",
      oauth: { scope: "bb", grantId: "grant_1", clientName: "Claude" },
      headers: {
        "content-type": "application/json",
        authorization: "Bearer visitor-token",
        cookie: "session=visitor",
      },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(oauth.status).toBe(200);
    expect(json(oauth)).toEqual({
      headers: {
        host: new URL(loopbackOrigin).host,
        "x-bb-gate-auth": "oauth",
        "x-bb-gate-oauth-scope": "bb",
        "x-bb-gate-oauth-grant": "grant_1",
        "x-bb-gate-oauth-client": "Claude",
      },
      body: { hello: "world" },
    });

    const crossSite = await gated({
      method: "GET",
      path: ECHO_PATH,
      headers: { origin: "https://evil.example" },
    });
    expect(crossSite.status).toBe(403);
  });

  it("serves the install paths to a public assertion and nothing else", async () => {
    for (const method of ["GET", "HEAD"]) {
      const version = await gated({
        method,
        path: "/install/version",
        kind: "public",
        subject: "",
      });
      expect(version.status, method).toBe(200);
      if (method === "GET") {
        expect(json(version)).toMatchObject({
          version: expect.any(String),
          protocolVersion: expect.any(Number),
        });
      }
    }
    const script = await gated({
      method: "GET",
      path: "/install.sh",
      kind: "public",
      subject: "",
    });
    expect(script.status).toBe(200);
    expect(script.headers["content-type"]).toContain("text/x-shellscript");

    const host = seedHost(server.deps, { id: "host_public", name: "Kept" });
    const refused: Array<{ method: string; path: string; body?: string }> = [
      { method: "POST", path: "/install/version" },
      { method: "GET", path: `/api/v1/hosts/${host.id}` },
      {
        method: "PATCH",
        path: `/api/v1/hosts/${host.id}`,
        body: JSON.stringify({ name: "Changed" }),
      },
      { method: "GET", path: ECHO_PATH },
      { method: "GET", path: "/install.sh/../api/v1/hosts" },
      { method: "GET", path: "/" },
    ];
    for (const request of refused) {
      const response = await gated({
        ...request,
        kind: "public",
        subject: "",
        headers: { "content-type": "application/json" },
      });
      expect(response.status, `${request.method} ${request.path}`).toBe(401);
      expect(json(response)).toMatchObject({
        code: "gate_assertion_invalid",
        reason: "not_public",
      });
    }
    expect(getHost(server.db, host.id)?.name).toBe("Kept");

    const socket = await openSocket(ingressBaseUrl, "/ws", {
      [GATE_ASSERTION_HEADER]: await assertion({
        method: "GET",
        path: "/ws",
        kind: "public",
        subject: "",
      }),
    });
    expect(socket).toMatchObject({ status: 401 });
  });

  it("forwards a public assertion without gate auth, cookies or credentials", () => {
    const loopbackOrigin = "http://127.0.0.1:4100";
    const headers = tunnelIngressHeaders(
      [
        ["Host", PUBLIC_HOST],
        ["x-bb-gate-auth", "session"],
        ["x-bb-gate-machine-id", "machine_forged"],
        ["cookie", "session=visitor"],
        ["authorization", "Bearer visitor"],
        ["x-bb-enrollment", "enroll_1"],
        ["accept", "*/*"],
      ],
      {
        claims: {
          v: 1,
          kid: "k1",
          aud: AUDIENCE,
          sub: "",
          kind: "public",
          htm: "GET",
          htu: "/install.sh",
          target: null,
          oauth: null,
          iat: 0,
          exp: 60,
          jti: "j",
        },
        loopbackOrigin,
      },
    );
    expect(headers).toEqual({
      host: "127.0.0.1:4100",
      "x-bb-enrollment": "enroll_1",
      accept: "*/*",
    });
  });

  it("does not treat verified tunnel traffic as coming from this machine", async () => {
    const response = await gated({
      method: "GET",
      path: "/internal/server-move/pending",
    });
    expect(response.status).toBe(403);
    expect(json(response)).toMatchObject({ code: "loopback_only" });
  });

  it("verifies WebSocket upgrades for /ws and plugin sockets", async () => {
    setExperiments(server.db, { websocketCompression: true });
    const refused = await openSocket(ingressBaseUrl, "/ws", {});
    expect(refused).toMatchObject({ status: 401 });
    expect(JSON.parse((refused as { body: string }).body)).toMatchObject({
      reason: "missing",
    });

    const wrongPath = await openSocket(ingressBaseUrl, "/ws", {
      [GATE_ASSERTION_HEADER]: await assertion({
        method: "GET",
        path: "/ws?other=1",
      }),
    });
    expect(wrongPath).toMatchObject({ status: 401 });

    const crossSite = await openSocket(ingressBaseUrl, "/ws", {
      origin: "https://evil.example",
      [GATE_ASSERTION_HEADER]: await assertion({ method: "GET", path: "/ws" }),
    });
    expect(crossSite).toMatchObject({ status: 403 });

    const realtime = await openSocket(ingressBaseUrl, "/ws", {
      origin: PUBLIC_ORIGIN,
      [GATE_ASSERTION_HEADER]: await assertion({ method: "GET", path: "/ws" }),
    });
    if (!("socket" in realtime)) throw new Error("expected /ws to open");
    expect(realtime.socket.extensions).toContain("permessage-deflate");
    await closeSocket(realtime.socket);

    const plugin = await openSocket(ingressBaseUrl, SOCKET_PATH, {
      origin: PUBLIC_ORIGIN,
      "x-bb-gate-auth": "machine",
      [GATE_ASSERTION_HEADER]: await assertion({
        method: "GET",
        path: SOCKET_PATH,
      }),
    });
    if (!("socket" in plugin)) throw new Error("expected plugin socket");
    expect(plugin.socket.extensions).toBe("");
    const loopbackOrigin = `http://127.0.0.1:${server.config.serverPort}`;
    expect(JSON.parse(await plugin.firstMessage)).toEqual({
      host: new URL(loopbackOrigin).host,
      origin: loopbackOrigin,
      "x-bb-gate-auth": "session",
    });
    const echoed = new Promise<string>((resolve) => {
      plugin.socket.once("message", (data) => resolve(String(data)));
    });
    plugin.socket.send("ping");
    expect(await echoed).toBe("ping");
    await closeSocket(plugin.socket);
  });

  it("refetches the key set once for an unknown kid and follows rotation", async () => {
    const health = () => gated({ method: "GET", path: "/health" });
    expect((await health()).status).toBe(200);
    expect(keyServer.hits).toBe(1);

    const rotated = await generateGateKeyPair("k2");
    const withNewKey = () =>
      gated({ method: "GET", path: "/health", key: rotated.signingKey });
    const unknown = await withNewKey();
    expect(unknown.status).toBe(401);
    expect(json(unknown)).toMatchObject({ reason: "unknown_key" });
    expect(keyServer.hits).toBe(1);

    nowMs += 61_000;
    expect((await withNewKey()).status).toBe(401);
    expect(keyServer.hits).toBe(2);
    expect((await withNewKey()).status).toBe(401);
    expect(keyServer.hits).toBe(2);

    keyServer.keys = [publicKey, rotated.publicKey];
    nowMs += 61_000;
    expect((await withNewKey()).status).toBe(200);
    expect(keyServer.hits).toBe(3);
    expect((await health()).status).toBe(200);

    keyServer.keys = [rotated.publicKey];
    nowMs += 61_000;
    const retiredKid = await gated({
      method: "GET",
      path: "/health",
      key: (await generateGateKeyPair("k0")).signingKey,
    });
    expect(retiredKid.status).toBe(401);
    expect(keyServer.hits).toBe(4);
    expect((await health()).status).toBe(401);
    expect((await withNewKey()).status).toBe(200);

    keyServer.keys = [publicKey];
    nowMs += 16 * 60_000;
    expect((await withNewKey()).status).toBe(200);
    await vi.waitFor(() => expect(keyServer.hits).toBe(5));
    expect((await health()).status).toBe(200);
    expect((await withNewKey()).status).toBe(401);
  });

  it("fails closed without keys and keeps the last good set when the URL fails", async () => {
    keyServer.status = 500;
    const down = await gated({ method: "GET", path: "/health" });
    expect(down.status).toBe(401);
    expect(json(down)).toMatchObject({ reason: "no_keys" });
    expect(keyServer.hits).toBe(1);
    expect((await gated({ method: "GET", path: "/health" })).status).toBe(401);
    expect(keyServer.hits).toBe(1);

    keyServer.status = 200;
    nowMs += 61_000;
    expect((await gated({ method: "GET", path: "/health" })).status).toBe(200);
    expect(keyServer.hits).toBe(2);

    keyServer.status = 500;
    nowMs += 61_000;
    const unknownKid = await gated({
      method: "GET",
      path: "/health",
      key: (await generateGateKeyPair("k9")).signingKey,
    });
    expect(unknownKid.status).toBe(401);
    expect(keyServer.hits).toBe(3);
    expect((await gated({ method: "GET", path: "/health" })).status).toBe(200);
  });

  it("shares a listener per audience and frees the port when the last handle closes", async () => {
    const api = requireApi(server);
    const first = await api.server.internal_DO_NOT_USE_openTunnelIngress({
      audience: "server:srv_other",
    });
    const second = await api.server.internal_DO_NOT_USE_openTunnelIngress({
      audience: "server:srv_other",
    });
    expect(second.baseUrl).toBe(first.baseUrl);
    expect(first.baseUrl).not.toBe(ingressBaseUrl);
    const port = Number(new URL(first.baseUrl).port);

    await first.close();
    await first.close();
    expect(await canConnect(port)).toBe(true);
    await second.close();
    expect(await canConnect(port)).toBe(false);
    expect(await canBind(port)).toBe(true);
  });

  it("closes the plugin's ingresses and their sockets when the plugin is disabled", async () => {
    const port = Number(new URL(ingressBaseUrl).port);
    const plugin = await openSocket(ingressBaseUrl, SOCKET_PATH, {
      [GATE_ASSERTION_HEADER]: await assertion({
        method: "GET",
        path: SOCKET_PATH,
      }),
    });
    if (!("socket" in plugin)) throw new Error("expected plugin socket");
    const closed = new Promise<void>((resolve) => {
      plugin.socket.once("close", () => resolve());
    });

    await server.pluginService.setEnabled(PLUGIN_ID, false);
    await closed;
    expect(await canConnect(port)).toBe(false);
    expect(await canBind(port)).toBe(true);
  });

  it("carries gate-signed requests through real frps and the connect-next plugin's frpc", async () => {
    setExperiments(server.db, { websocketCompression: true });
    const binaries = await installTestFrp(join(workDir, "bin"));
    const hooks = await startGateHooks(() => "bbcred_ingress");
    const frps = await startFrps(binaries.frps, workDir, hooks.port);
    const logs: string[] = [];
    const record = (message: string) => {
      logs.push(message);
    };
    const tunnel = new NextTunnel({
      frpDir: join(workDir, "frp"),
      serverOverride: {
        protocol: "websocket",
        host: "127.0.0.1",
        port: frps.bindPort,
      },
      enabled: true,
      resolveBinary: async () => binaries.frpc,
      readCredential: async () => ({
        serverId: "srv_ingress",
        credential: "bbcred_ingress",
      }),
      openIngress: serverTunnelIngress(requireApi(server).server),
      trustedCertificates: async () => [],
      log: { debug: record, info: record, warn: record, error: record },
    });
    try {
      await tunnel.start();
      await tunnel.setIdentity({
        serverId: "srv_ingress",
        label: "sawyer",
        baseUrl: "https://getbb.app",
      });
      await waitFor(
        () => tunnel.status().state,
        (state) => state === "connected",
        60_000,
      );
      const vhost = `http://127.0.0.1:${frps.vhostPort}`;
      const host = `sawyer.${VHOST_DOMAIN}`;
      const path = `${ECHO_PATH}?a=1&b=%2Fx`;
      const token = await assertion({ method: "GET", path });

      const signed = await send(vhost, {
        method: "GET",
        path,
        headers: {
          host,
          [GATE_ASSERTION_HEADER]: token,
          "x-bb-gate-auth": "machine",
        },
      });
      expect(signed.status).toBe(200);
      const loopbackOrigin = `http://127.0.0.1:${server.config.serverPort}`;
      expect(json(signed)).toEqual({
        headers: {
          host: new URL(loopbackOrigin).host,
          "x-bb-gate-auth": "session",
        },
        url: `${loopbackOrigin}${path}`,
      });

      const unsigned = await send(vhost, {
        method: "GET",
        path,
        headers: { host, "x-bb-gate-auth": "session" },
      });
      expect(unsigned.status).toBe(401);
      expect(json(unsigned)).toMatchObject({ reason: "missing" });

      const replayed = await send(vhost, {
        method: "GET",
        path: `${ECHO_PATH}?a=2`,
        headers: { host, [GATE_ASSERTION_HEADER]: token },
      });
      expect(replayed.status).toBe(401);
      expect(json(replayed)).toMatchObject({ reason: "wrong_path" });

      const install = await send(vhost, {
        method: "GET",
        path: "/install/version",
        headers: {
          host,
          [GATE_ASSERTION_HEADER]: await assertion({
            method: "GET",
            path: "/install/version",
            kind: "public",
            subject: "",
          }),
        },
      });
      expect(install.status).toBe(200);

      const socket = await openSocket(vhost, SOCKET_PATH, {
        host,
        origin: `https://${host}`,
        [GATE_ASSERTION_HEADER]: await assertion({
          method: "GET",
          path: SOCKET_PATH,
        }),
      });
      if (!("socket" in socket)) throw new Error("expected plugin socket");
      expect(JSON.parse(await socket.firstMessage)).toMatchObject({
        "x-bb-gate-auth": "session",
      });
      await closeSocket(socket.socket);

      const realtime = await openSocket(vhost, "/ws", {
        host,
        origin: `https://${host}`,
        [GATE_ASSERTION_HEADER]: await assertion({
          method: "GET",
          path: "/ws",
        }),
      });
      if (!("socket" in realtime)) throw new Error("expected /ws to open");
      expect(realtime.socket.extensions).toContain("permessage-deflate");
      await closeSocket(realtime.socket);
      expect(logs.join("\n")).not.toContain("bbcred_ingress");
    } finally {
      await tunnel.stop();
      await frps.stop();
      await hooks.close();
    }
  }, 120_000);
});
