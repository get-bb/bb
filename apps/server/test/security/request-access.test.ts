import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { resolveRequestAccess } from "../../src/request-access.js";
import { createApp } from "../../src/server.js";
import { createAccessService } from "../../src/services/access/access-service.js";
import {
  createTestAppHarness,
  createTestDaemonHostKey,
  createTestDb,
  startTestServer,
  type RunningTestServer,
  type TestAppHarness,
} from "../helpers/test-app.js";

const LAN_PEER = "192.168.1.20";

interface Harness {
  harness: TestAppHarness;
  app: ReturnType<typeof createApp>["app"];
  cleanup(): Promise<void>;
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function createHarness(appUrl?: string): Promise<Harness> {
  const harness = await createTestAppHarness(
    appUrl === undefined ? {} : { appUrl },
  );
  const staticDir = await mkdtemp(join(tmpdir(), "bb-access-shell-"));
  await writeFile(
    join(staticDir, "index.html"),
    "<!doctype html><html><head></head><body></body></html>",
  );
  const { app } = createApp(harness.deps, { staticDir });
  const result = {
    harness,
    app,
    async cleanup() {
      await harness.cleanup();
      await rm(staticDir, { recursive: true, force: true });
    },
  };
  cleanups.push(result.cleanup);
  return result;
}

function send(
  target: Harness,
  path: string,
  args: {
    peer: string;
    host?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<Response> {
  const headers = new Headers(args.headers);
  headers.set("host", args.host ?? `${args.peer}:3334`);
  if (args.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    target.app.fetch(
      new Request(`http://${args.host ?? `${args.peer}:3334`}${path}`, {
        method: args.method ?? "GET",
        headers,
        ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      }),
      { incoming: { socket: { remoteAddress: args.peer } } },
    ),
  );
}

async function mintCode(target: Harness): Promise<string> {
  const response = await send(target, "/api/v1/access/pairings", {
    peer: "127.0.0.1",
    host: "127.0.0.1:3334",
    method: "POST",
  });
  expect(response.status).toBe(200);
  const body: { code: string } = await response.json();
  return body.code;
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("expected a session cookie");
  return header.split(";", 1)[0]!;
}

describe("who may reach the API", () => {
  it("refuses a LAN peer without a credential, even when it claims a gate verdict", async () => {
    const target = await createHarness();
    for (const headers of [
      {},
      { "x-bb-gate-auth": "session" },
      { "x-bb-gate-auth": "machine", "x-bb-gate-machine-id": "m1" },
    ]) {
      const response = await send(target, "/api/v1/projects", {
        peer: LAN_PEER,
        headers,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "unauthenticated" });
    }
    expect((await send(target, "/health", { peer: LAN_PEER })).status).toBe(
      200,
    );
    const shell = await send(target, "/", { peer: LAN_PEER });
    const html = await shell.text();
    expect(html).toContain('id="bb-access"');
    expect(html).not.toContain('id="bb-plugin-list"');
  });

  it("treats Tailscale Serve and other proxies on loopback as remote", async () => {
    const target = await createHarness("https://m.tail.ts.net");
    const remote: { host: string; headers: Record<string, string> }[] = [
      {
        host: "m.tail.ts.net",
        headers: {
          "x-forwarded-for": "100.64.1.2",
          "x-forwarded-host": "m.tail.ts.net",
          "x-forwarded-proto": "https",
        },
      },
      { host: "m.tail.ts.net", headers: {} },
      {
        host: "127.0.0.1:3334",
        headers: { "x-forwarded-for": "127.0.0.1, 203.0.113.9" },
      },
      { host: "127.0.0.1:3334", headers: { "x-real-ip": "203.0.113.9" } },
      { host: "127.0.0.1:3334", headers: { via: "1.1 proxy" } },
      { host: "127.0.0.1:3334", headers: { forwarded: "for=127.0.0.1" } },
      {
        host: "127.0.0.1:3334",
        headers: { "tailscale-user-login": "owner@example.com" },
      },
      {
        host: "127.0.0.1:3334",
        headers: { "x-forwarded-host": "m.tail.ts.net" },
      },
    ];
    for (const request of remote) {
      const response = await send(target, "/api/v1/projects", {
        peer: "127.0.0.1",
        ...request,
      });
      expect(response.status, JSON.stringify(request)).toBe(401);
    }
  });

  it("lets the server machine in with no setup, including the dev proxy's forwarded headers", async () => {
    const target = await createHarness();
    for (const request of [
      { peer: "127.0.0.1", host: "127.0.0.1:3334", headers: {} },
      { peer: "::ffff:127.0.0.1", host: "localhost:3334", headers: {} },
      {
        peer: "127.0.0.1",
        host: "127.0.0.1:3334",
        headers: {
          "x-forwarded-for": "127.0.0.1",
          "x-forwarded-host": "localhost:5173",
          "x-forwarded-proto": "http",
        },
      },
    ]) {
      const response = await send(target, "/api/v1/projects", request);
      expect(response.status, JSON.stringify(request)).toBe(200);
    }
  });

  it("ignores gate headers without the tunnel marker on the server machine", async () => {
    const target = await createHarness();
    const response = await send(target, "/api/v1/access/pairings", {
      peer: "127.0.0.1",
      host: "127.0.0.1:3334",
      method: "POST",
      headers: { "x-bb-gate-auth": "machine" },
    });
    expect(response.status).toBe(200);
    const session = await send(target, "/api/v1/access/session", {
      peer: "127.0.0.1",
      host: "127.0.0.1:3334",
      headers: { "x-bb-gate-auth": "session" },
    });
    expect(await session.json()).toMatchObject({ via: "local" });
  });

  it("honours the gate's verdict only with this start's tunnel marker", async () => {
    const target = await createHarness();
    const marker = target.harness.deps.access.tunnelMarker;
    const viaGate = (headers: Record<string, string>) =>
      send(target, "/api/v1/access/pairings", {
        peer: "127.0.0.1",
        host: "127.0.0.1:3334",
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.9", ...headers },
      });
    expect(
      (
        await viaGate({
          "x-bb-tunnel-marker": marker,
          "x-bb-gate-auth": "session",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await viaGate({
          "x-bb-tunnel-marker": marker,
          "x-bb-gate-auth": "machine",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await viaGate({
          "x-bb-tunnel-marker": `${marker}x`,
          "x-bb-gate-auth": "session",
        })
      ).status,
    ).toBe(401);
    expect((await viaGate({ "x-bb-tunnel-marker": marker })).status).toBe(401);
  });

  it("treats a daemon host key on a direct route as a machine", async () => {
    const target = await createHarness();
    const authorization = `Bearer ${createTestDaemonHostKey()}`;
    expect(
      (
        await send(target, "/api/v1/projects", {
          peer: LAN_PEER,
          headers: { authorization },
        })
      ).status,
    ).toBe(200);
    const pairing = await send(target, "/api/v1/access/pairings", {
      peer: LAN_PEER,
      method: "POST",
      headers: { authorization },
    });
    expect(pairing.status).toBe(403);
    expect(
      (
        await send(target, "/api/v1/projects", {
          peer: LAN_PEER,
          headers: { authorization: "Bearer not-a-host-key" },
        })
      ).status,
    ).toBe(401);
  });
});

describe("pairing", () => {
  it("signs a LAN browser in once per code with an HttpOnly cookie", async () => {
    const target = await createHarness();
    const code = await mintCode(target);
    const redeemed = await send(target, "/api/v1/access/pairings/redeem", {
      peer: LAN_PEER,
      method: "POST",
      headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/605.1.15" },
      body: { kind: "browser", code: code.toLowerCase().replace("-", " ") },
    });
    expect(redeemed.status).toBe(200);
    const setCookie = redeemed.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^bb_session_3334=bbs_/u);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
    expect(await redeemed.json()).toMatchObject({
      kind: "browser",
      credential: {
        label: "Safari on iPhone",
        origin: `http://${LAN_PEER}:3334`,
        secureOnly: false,
      },
    });
    const cookie = sessionCookie(redeemed);
    expect(
      (
        await send(target, "/api/v1/projects", {
          peer: LAN_PEER,
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    const shell = await send(target, "/", {
      peer: LAN_PEER,
      headers: { cookie },
    });
    expect(await shell.text()).toContain('id="bb-plugin-list"');

    const replay = await send(target, "/api/v1/access/pairings/redeem", {
      peer: LAN_PEER,
      method: "POST",
      body: { kind: "browser", code },
    });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ code: "invalid_pairing_code" });
  });

  it("returns a token to a device and accepts it as a bearer", async () => {
    const target = await createHarness();
    const code = await mintCode(target);
    const redeemed = await send(target, "/api/v1/access/pairings/redeem", {
      peer: LAN_PEER,
      method: "POST",
      body: { kind: "device", code, label: "bb CLI on laptop" },
    });
    const body: { token: string; cookieName: string } = await redeemed.json();
    expect(redeemed.headers.get("set-cookie")).toBeNull();
    expect(body.cookieName).toBe("bb_session_3334");
    const list = await send(target, "/api/v1/access/credentials", {
      peer: LAN_PEER,
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(await list.json()).toMatchObject({
      credentials: [{ label: "bb CLI on laptop", current: true }],
    });
  });

  it("stops accepting codes after ten wrong guesses", async () => {
    const target = await createHarness();
    const code = await mintCode(target);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const wrong = await send(target, "/api/v1/access/pairings/redeem", {
        peer: LAN_PEER,
        method: "POST",
        body: { kind: "browser", code: "AAAAA-AAAAA" },
      });
      expect(wrong.status).toBe(401);
    }
    const right = await send(target, "/api/v1/access/pairings/redeem", {
      peer: LAN_PEER,
      method: "POST",
      body: { kind: "browser", code },
    });
    expect(right.status).toBe(429);
  });

  it("keeps a sign-in made over HTTPS off plain HTTP", async () => {
    const target = await createHarness("https://m.tail.ts.net");
    const code = await mintCode(target);
    const redeemed = await send(target, "/api/v1/access/pairings/redeem", {
      peer: "127.0.0.1",
      host: "m.tail.ts.net",
      method: "POST",
      headers: {
        "x-forwarded-for": "100.64.1.2",
        "x-forwarded-proto": "https",
      },
      body: { kind: "browser", code },
    });
    expect(redeemed.headers.get("set-cookie")).toContain("Secure");
    const cookie = sessionCookie(redeemed);
    expect(
      (
        await send(target, "/api/v1/projects", {
          peer: "127.0.0.1",
          host: "m.tail.ts.net",
          headers: {
            cookie,
            "x-forwarded-for": "100.64.1.2",
            "x-forwarded-proto": "https",
          },
        })
      ).status,
    ).toBe(200);
    const plain = await send(target, "/api/v1/projects", {
      peer: LAN_PEER,
      headers: { cookie },
    });
    expect(plain.status).toBe(401);
    expect(await plain.json()).toMatchObject({
      code: "credential_requires_https",
    });
  });
});

describe("revoking", () => {
  let server: RunningTestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("cuts a signed-in browser off, including its open realtime socket", async () => {
    server = await startTestServer();
    const port = new URL(server.baseUrl).port;
    const mint = await fetch(`${server.baseUrl}/api/v1/access/pairings`, {
      method: "POST",
    });
    const { code }: { code: string } = await mint.json();
    const redeemed = await fetch(
      `${server.baseUrl}/api/v1/access/pairings/redeem`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": LAN_PEER,
        },
        body: JSON.stringify({ kind: "browser", code }),
      },
    );
    expect(redeemed.status).toBe(200);
    const cookie = sessionCookie(redeemed);
    const { credential }: { credential: { id: string } } =
      await redeemed.json();

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { cookie, "x-forwarded-for": LAN_PEER },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const closed = new Promise<number>((resolve) =>
      socket.once("close", (code) => resolve(code)),
    );

    const revoked = await fetch(
      `${server.baseUrl}/api/v1/access/credentials/${credential.id}`,
      { method: "DELETE" },
    );
    expect(revoked.status).toBe(200);
    expect(await closed).toBe(4401);
    const after = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: { cookie, "x-forwarded-for": LAN_PEER },
    });
    expect(after.status).toBe(401);
  });

  it("refuses an unauthenticated realtime socket from off the machine", async () => {
    server = await startTestServer();
    const port = new URL(server.baseUrl).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { "x-forwarded-for": LAN_PEER },
    });
    const status = await new Promise<number>((resolve) =>
      socket.once("unexpected-response", (_request, response) =>
        resolve(response.statusCode ?? 0),
      ),
    );
    expect(status).toBe(401);
  });
});

describe("header sanitising on a real listener", () => {
  it("removes gate headers without the marker and the marker itself before any handler", async () => {
    const access = createAccessService({ db: createTestDb() });
    const app = new Hono();
    app.use("*", async (context, next) => {
      await resolveRequestAccess(
        context,
        {
          access,
          config: { serverPort: 1 },
          machineAuth: { verifyDaemonHostKey: async () => null },
        },
        "127.0.0.1",
      );
      return next();
    });
    app.get("/", (context) =>
      context.json({
        gate: context.req.header("x-bb-gate-auth") ?? null,
        scope: context.req.header("x-bb-gate-oauth-scope") ?? null,
        marker: context.req.header("x-bb-tunnel-marker") ?? null,
      }),
    );
    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const listening = serve(
        { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
        () => resolve(listening),
      );
    });
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("expected a TCP listener");
    }
    const url = `http://127.0.0.1:${address.port}/`;
    const forged = await fetch(url, {
      headers: {
        "x-bb-gate-auth": "oauth",
        "x-bb-gate-oauth-scope": "bb",
        "x-bb-tunnel-marker": "guess",
      },
    });
    expect(await forged.json()).toEqual({
      gate: null,
      scope: null,
      marker: null,
    });
    const tunnelled = await fetch(url, {
      headers: {
        "x-bb-gate-auth": "oauth",
        "x-bb-gate-oauth-scope": "bb",
        "x-bb-tunnel-marker": access.tunnelMarker,
      },
    });
    expect(await tunnelled.json()).toEqual({
      gate: "oauth",
      scope: "bb",
      marker: null,
    });
  });
});
