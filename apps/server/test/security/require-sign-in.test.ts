import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAppSettings,
  getExperiments,
  setAppSettings,
  setExperiments,
} from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server.js";
import { isLocalNetworkOn } from "../../src/services/machines/server-access.js";
import {
  createTestAppHarness,
  createTestDaemonHostKey,
  localAuthorization,
  type TestAppHarness,
} from "../helpers/test-app.js";

const LAN_PEER = "192.168.1.20";
const LAN_HOST = `${LAN_PEER}:3334`;

interface Harness {
  harness: TestAppHarness;
  app: ReturnType<typeof createApp>["app"];
}

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

async function createHarness(): Promise<Harness> {
  const harness = await createTestAppHarness();
  const staticDir = await mkdtemp(join(tmpdir(), "bb-require-sign-in-"));
  await writeFile(
    join(staticDir, "index.html"),
    "<!doctype html><html><head></head><body></body></html>",
  );
  const { app } = createApp(harness.deps, { staticDir });
  cleanups.push(async () => {
    await harness.cleanup();
    await rm(staticDir, { recursive: true, force: true });
  });
  return { harness, app };
}

function send(
  target: Harness,
  path: string,
  args: {
    peer?: string;
    host?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<Response> {
  const peer = args.peer ?? LAN_PEER;
  const host = args.host ?? (peer === LAN_PEER ? LAN_HOST : "127.0.0.1:3334");
  const headers = new Headers(args.headers);
  headers.set("host", host);
  if (args.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    target.app.fetch(
      new Request(`http://${host}${path}`, {
        method: args.method ?? "GET",
        headers,
        ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
      }),
      { incoming: { socket: { remoteAddress: peer } } },
    ),
  );
}

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  if (header === null) throw new Error("expected a session cookie");
  return header.split(";", 1)[0]!;
}

function staleCookie(target: Harness): string {
  return `bb_session_${target.harness.config.serverPort}=bbs_from-an-old-data-dir`;
}

describe("sign-in optional (the default)", () => {
  it("lets every client in as before: LAN browsers, old mobile builds and plugins' raw loopback calls", async () => {
    const target = await createHarness();
    expect(getExperiments(target.harness.deps.db).requireSignIn).toBe(false);

    const oldMobileProbe = await send(target, "/api/v1/system/config");
    expect(oldMobileProbe.status).toBe(200);
    const lanBrowser = await send(target, "/api/v1/projects");
    expect(lanBrowser.status).toBe(200);
    const pluginRawLoopback = await send(target, "/api/v1/threads?limit=1", {
      peer: "127.0.0.1",
    });
    expect(pluginRawLoopback.status).toBe(200);

    const session = await send(target, "/api/v1/access/session");
    expect(await session.json()).toEqual({
      authenticated: true,
      via: "open",
      credentialId: null,
      problem: null,
      requireSignIn: false,
    });
    const shell = await (await send(target, "/")).text();
    expect(shell).toContain('{"authenticated":true}');
  });

  it("ignores a stale or foreign sign-in instead of showing the sign-in screen", async () => {
    const target = await createHarness();
    const foreign: Record<string, string>[] = [
      { cookie: staleCookie(target) },
      { authorization: "Bearer bbl_from-another-data-dir" },
    ];
    for (const headers of foreign) {
      const response = await send(target, "/api/v1/projects", { headers });
      expect(response.status, JSON.stringify(headers)).toBe(200);
    }
  });

  it("never opens the Local network route", async () => {
    const target = await createHarness();
    const { db } = target.harness.deps;
    setExperiments(db, { serverRoutes: true });
    setAppSettings(db, { ...getAppSettings(db), localNetworkEnabled: true });
    expect(isLocalNetworkOn({ db })).toBe(false);
    setExperiments(db, { requireSignIn: true });
    expect(isLocalNetworkOn({ db })).toBe(true);
  });
});

describe("sign-in required", () => {
  it("refuses a LAN peer, an nginx-style loopback proxy and a stale cookie", async () => {
    const target = await createHarness();
    setExperiments(target.harness.deps.db, { requireSignIn: true });
    const refused = [
      { label: "LAN peer", peer: LAN_PEER },
      { label: "nginx default proxy_pass", peer: "127.0.0.1" },
      {
        label: "stale cookie",
        peer: LAN_PEER,
        headers: { cookie: staleCookie(target) },
      },
    ];
    for (const { label, ...request } of refused) {
      const response = await send(target, "/api/v1/projects", request);
      expect(response.status, label).toBe(401);
    }
    const shell = await (await send(target, "/")).text();
    expect(shell).toContain('{"authenticated":false}');
  });
});

describe("turning sign-in on", () => {
  it("signs the browser that turns it on in, in the same request", async () => {
    const target = await createHarness();
    const response = await send(target, "/api/v1/access/require-sign-in", {
      method: "PUT",
      headers: { origin: `http://${LAN_HOST}` },
      body: { enabled: true },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requireSignIn: true,
      signedInThisBrowser: { kind: "browser", current: true },
    });
    const cookie = cookieFrom(response);
    expect(
      (await send(target, "/api/v1/projects", { headers: { cookie } })).status,
    ).toBe(200);
    expect((await send(target, "/api/v1/projects")).status).toBe(401);
  });

  it("does the same from the Experiments switch", async () => {
    const target = await createHarness();
    const response = await send(target, "/api/v1/settings/experiments", {
      method: "PUT",
      headers: { origin: `http://${LAN_HOST}` },
      body: { requireSignIn: true },
    });
    expect(response.status).toBe(200);
    const cookie = cookieFrom(response);
    expect(
      (await send(target, "/api/v1/projects", { headers: { cookie } })).status,
    ).toBe(200);
    expect((await send(target, "/api/v1/projects")).status).toBe(401);
  });

  it("refuses a caller that isn't signed in and can't take a cookie, leaving sign-in off", async () => {
    const target = await createHarness();
    const response = await send(target, "/api/v1/access/require-sign-in", {
      method: "PUT",
      body: { enabled: true },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "sign_in_this_device_first",
    });
    expect(getExperiments(target.harness.deps.db).requireSignIn).toBe(false);
    expect((await send(target, "/api/v1/projects")).status).toBe(200);
  });

  it("lets the server machine's local token switch it either way without a cookie", async () => {
    const target = await createHarness();
    const authorization = await localAuthorization(
      target.harness.config.dataDir,
    );
    for (const enabled of [true, false]) {
      const response = await send(target, "/api/v1/access/require-sign-in", {
        peer: "127.0.0.1",
        method: "PUT",
        headers: { authorization },
        body: { enabled },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(await response.json()).toEqual({
        requireSignIn: enabled,
        signedInThisBrowser: null,
      });
    }
  });

  it("keeps machines from changing it", async () => {
    const target = await createHarness();
    const response = await send(target, "/api/v1/access/require-sign-in", {
      method: "PUT",
      headers: {
        authorization: `Bearer ${createTestDaemonHostKey({ hostId: "host-1" })}`,
      },
      body: { enabled: true },
    });
    expect(response.status).toBe(403);
    expect(getExperiments(target.harness.deps.db).requireSignIn).toBe(false);
  });
});
