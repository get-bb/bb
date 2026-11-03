import { createMachineLabelProxy } from "../src/machine-label.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  GATE_PRESENCE_BATCH_MAX,
  GATE_RESOLVE_BATCH_MAX,
  type GatePresenceRequest,
  type GateResolveRequest,
  type GateResolveResponse,
} from "@bb/tunnel-contract/next";
import {
  createAccountApi,
  parseGateResolveResponse,
} from "../src/account-api.js";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import type { AccountApi } from "../src/account-api.js";
import {
  brotliQuality,
  compressor,
  LARGE_BROTLI_QUALITY,
  LARGE_DYNAMIC_BYTES,
  preferredEncoding,
  shouldCompress,
  STORED_BROTLI_QUALITY,
} from "../src/compress.js";
import { silentLog } from "../src/log.js";
import { startPresence } from "../src/presence.js";
import { trackServerFrames, WEBSOCKET_GOING_AWAY } from "../src/ws-frames.js";
import { configFromEnv } from "../src/config.js";
import { createLocalDirectory } from "../src/directory.js";
import { isOwnSubdomain, parseHookCall } from "../src/frp-hooks.js";
import { isTenantSetCookie, tenantCookies } from "../src/forwarding.js";
import { Lru } from "../src/lru.js";
import { isMcpLocalPath } from "../src/mcp.js";

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition never held");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const ASK: GateResolveRequest = {
  label: "bee",
  session: "s1",
  desktopSession: null,
  credential: null,
  machineCredential: null,
  oauth: null,
};

const OWNED: GateResolveResponse = {
  label: {
    kind: "server",
    serverId: "srv",
    userId: "u1",
    revoked: false,
    lastSeenAt: null,
  },
  session: { userId: "u1", needsRefresh: false },
  desktopSession: null,
  credential: null,
  machine: null,
  oauth: null,
};

interface StubCall {
  url: string;
  body: { requests?: GateResolveRequest[]; reports?: GatePresenceRequest[] };
  auth: string | null;
}

function stubFetch(
  answers: (request: GateResolveRequest) => unknown,
  status: () => number = () => 200,
) {
  const calls: StubCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as StubCall["body"];
    calls.push({
      url: String(input),
      body,
      auth: new Headers(init?.headers).get("authorization"),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const code = status();
    if (code !== 200) return new Response("no", { status: code });
    if (body.reports !== undefined) {
      return Response.json({ results: body.reports.map(() => "recorded") });
    }
    return Response.json({ answers: (body.requests ?? []).map(answers) });
  };
  return { calls, fetchImpl };
}

function asked(calls: StubCall[]): number {
  return calls.reduce(
    (sum, call) => sum + (call.body.requests?.length ?? 0),
    0,
  );
}

const REVOKED: GateResolveResponse = {
  ...OWNED,
  label: { ...OWNED.label!, revoked: true } as GateResolveResponse["label"],
  session: { userId: "u1", needsRefresh: false },
  credential: false,
};

describe("account API client", () => {
  it("rejects answers that are not exactly the contract", () => {
    expect(parseGateResolveResponse(OWNED, ASK)).toEqual(OWNED);
    expect(
      parseGateResolveResponse({ ...OWNED, oauth: undefined }, ASK),
    ).toBeNull();
    expect(
      parseGateResolveResponse({ ...OWNED, session: { userId: "u1" } }, ASK),
    ).toBeNull();
    expect(
      parseGateResolveResponse({ ...OWNED, credential: true }, ASK),
    ).toBeNull();
    expect(
      parseGateResolveResponse(
        { ...OWNED, label: { ...OWNED.label, kind: "planet" } },
        ASK,
      ),
    ).toBeNull();
    expect(
      parseGateResolveResponse(
        {
          ...OWNED,
          session: null,
          desktopSession: { userId: "u1", setCookie: 5 },
        },
        { ...ASK, desktopSession: "d" },
      ),
    ).toBeNull();
  });

  it("dedupes concurrent lookups into one batch and keeps answers fresh for at most 60 s", async () => {
    let clock = 0;
    const { calls, fetchImpl } = stubFetch(() => OWNED);
    const api = createAccountApi({
      baseUrl: "https://connect.test/",
      secret: "s3cret",
      fetch: fetchImpl,
      positiveTtlMs: 600_000,
      random: () => 0,
      now: () => clock,
    });
    await Promise.all([
      api.resolve(ASK),
      api.resolve(ASK),
      api.resolve({ ...ASK, session: "s2" }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://connect.test/api/gate/resolve/batch");
    expect(calls[0]?.auth).toBe("Bearer s3cret");
    expect(calls[0]?.body).toEqual({
      requests: [ASK, { ...ASK, session: "s2" }],
    });
    clock = 59_000;
    await api.resolve(ASK);
    expect(calls).toHaveLength(1);
    clock = 60_001;
    expect(await api.resolve(ASK)).toEqual(OWNED);
    await waitUntil(() => calls.length === 2);
    expect(await api.resolve(ASK)).toEqual(OWNED);
    expect(calls).toHaveLength(2);
    api.forget(ASK);
    await api.resolve(ASK);
    expect(calls).toHaveLength(3);
  });

  it("jitters the fresh time downwards by up to a fifth", async () => {
    let clock = 0;
    const { calls, fetchImpl } = stubFetch(() => OWNED);
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      random: () => 1,
      now: () => clock,
    });
    await api.resolve(ASK);
    clock = 47_999;
    await api.resolve(ASK);
    expect(calls).toHaveLength(1);
    clock = 48_001;
    await api.resolve(ASK);
    await waitUntil(() => calls.length === 2);
  });

  it("serves the last good answer through an outage, but not past the max staleness", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let clock = 0;
    let status = 200;
    const failures: unknown[] = [];
    const { calls, fetchImpl } = stubFetch(
      () => OWNED,
      () => status,
    );
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      random: () => 0,
      deadlineMs: 50,
      onRevalidateFailed: (error) => failures.push(error),
      now: () => clock,
    });
    await Promise.all([api.resolve(ASK), vi.runAllTimersAsync()]);
    status = 502;
    clock = 61_000;
    expect(await api.resolve(ASK)).toEqual(OWNED);
    await vi.runAllTimersAsync();
    expect(failures).toHaveLength(1);
    clock = 62_000;
    expect(await api.resolve(ASK)).toEqual(OWNED);
    expect(calls).toHaveLength(2);
    clock = 67_000;
    expect(await api.resolve(ASK)).toEqual(OWNED);
    await vi.runAllTimersAsync();
    expect(failures).toHaveLength(2);
    clock = 300_001;
    await Promise.all([
      expect(api.resolve(ASK)).rejects.toThrow("HTTP 502"),
      vi.runAllTimersAsync(),
    ]);
    status = 200;
    await Promise.all([
      expect(api.resolve(ASK)).resolves.toEqual(OWNED),
      vi.runAllTimersAsync(),
    ]);
  });

  it("forgets every answer for a label, session or credential once one answer refutes it", async () => {
    let revoked = false;
    const { calls, fetchImpl } = stubFetch((request) =>
      revoked
        ? {
            ...REVOKED,
            session: request.session === null ? null : REVOKED.session,
            credential: request.credential === null ? null : false,
          }
        : {
            ...OWNED,
            session: request.session === null ? null : OWNED.session,
            credential: request.credential === null ? null : true,
          },
    );
    let clock = 0;
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      random: () => 0,
      now: () => clock,
    });
    const login = { ...ASK, session: null, credential: "cred" };
    await Promise.all([
      api.resolve(ASK),
      api.resolve({ ...ASK, session: "s2" }),
      api.resolve(login),
    ]);
    revoked = true;
    clock = 61_000;
    await api.resolve(login);
    await waitUntil(() => asked(calls) === 4);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const answer = await api.resolve(ASK);
    expect(answer.label?.revoked).toBe(true);
    expect((await api.resolve({ ...ASK, session: "s2" })).label?.revoked).toBe(
      true,
    );
    expect(asked(calls)).toBe(6);
  });

  it("holds background refreshes back so they travel together, unless a visitor lookup goes first", async () => {
    let clock = 0;
    const { calls, fetchImpl } = stubFetch(() => OWNED);
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      random: () => 0,
      backgroundWindowMs: 200,
      now: () => clock,
    });
    const asks = Array.from({ length: 30 }, (_, index) => ({
      ...ASK,
      session: `s${index}`,
    }));
    await Promise.all(asks.map((request) => api.resolve(request)));
    const first = calls.length;
    clock = 61_000;
    for (const request of asks.slice(0, 20)) await api.resolve(request);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toHaveLength(first);
    await waitUntil(() => calls.length === first + 1);
    expect(calls.at(-1)?.body.requests).toHaveLength(20);
    clock = 122_000;
    for (const request of asks.slice(20)) await api.resolve(request);
    await api.resolve({ ...ASK, session: "new" });
    expect(calls).toHaveLength(first + 2);
    expect(calls.at(-1)?.body.requests).toHaveLength(11);
  });

  it("keeps negative answers briefly and bounds the cache", async () => {
    let clock = 0;
    const { calls, fetchImpl } = stubFetch(() => ({ ...OWNED, session: null }));
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      negativeTtlMs: 1_000,
      maxEntries: 2,
      random: () => 0,
      now: () => clock,
    });
    await api.resolve(ASK);
    await api.resolve(ASK);
    expect(asked(calls)).toBe(1);
    clock = 1_001;
    await api.resolve(ASK);
    expect(asked(calls)).toBe(2);
    await api.resolve({ ...ASK, session: "s2" });
    await api.resolve({ ...ASK, session: "s3" });
    await api.resolve(ASK);
    expect(asked(calls)).toBe(5);
  });

  it(`batches up to ${GATE_RESOLVE_BATCH_MAX} lookups per call and caps the calls in flight`, async () => {
    let inFlight = 0;
    let peak = 0;
    const calls: number[] = [];
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      maxBatchesInFlight: 2,
      fetch: async (_input, init) => {
        const { requests } = JSON.parse(String(init?.body)) as {
          requests: GateResolveRequest[];
        };
        calls.push(requests.length);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return Response.json({ answers: requests.map(() => OWNED) });
      },
    });
    await Promise.all(
      Array.from({ length: 220 }, (_, index) =>
        api.resolve({ ...ASK, session: `s${index}` }),
      ),
    );
    expect(calls).toEqual([50, 50, 50, 50, 20]);
    expect(peak).toBe(2);
  });

  it("retries transient failures with backoff inside the deadline and gives up on the rest", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    let failuresLeft = 2;
    const { calls, fetchImpl } = stubFetch(
      () => OWNED,
      () => (failuresLeft-- > 0 ? 502 : 200),
    );
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
      random: () => 0,
    });
    const recovered = expect(
      api.resolve(ASK, { deadlineMs: 5_000 }),
    ).resolves.toEqual(OWNED);
    await vi.runAllTimersAsync();
    await recovered;
    expect(calls).toHaveLength(3);
    const refused = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: async () => new Response("no", { status: 404 }),
    });
    const started = Date.now();
    const refusal = expect(refused.resolve(ASK)).rejects.toThrow("HTTP 404");
    await vi.runAllTimersAsync();
    await refusal;
    expect(Date.now() - started).toBeLessThan(1_000);
    const down = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      random: () => 0,
      fetch: async () => new Response("no", { status: 503 }),
    });
    const tried = Date.now();
    const exhausted = expect(
      down.resolve(ASK, { deadlineMs: 600 }),
    ).rejects.toThrow("HTTP 503");
    await vi.runAllTimersAsync();
    await exhausted;
    expect(Date.now() - tried).toBeLessThan(1_500);
  });

  it("treats a null batch answer as could-not-check and a malformed one as an error", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const unchecked = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      random: () => 0,
      fetch: async () => Response.json({ answers: [null] }),
    });
    const uncheckedResult = expect(
      unchecked.resolve(ASK, { deadlineMs: 300 }),
    ).rejects.toThrow("could not check");
    await Promise.all([uncheckedResult, vi.runAllTimersAsync()]);
    const malformed = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: async () => Response.json({ answers: [{ label: null }] }),
    });
    const malformedResult = expect(malformed.resolve(ASK)).rejects.toThrow(
      "malformed",
    );
    await Promise.all([malformedResult, vi.runAllTimersAsync()]);
  });

  it(`sends presence in calls of at most ${GATE_PRESENCE_BATCH_MAX} and checks the results`, async () => {
    const { calls, fetchImpl } = stubFetch(() => OWNED);
    const api = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: fetchImpl,
    });
    const reports = Array.from(
      { length: GATE_PRESENCE_BATCH_MAX + 10 },
      (_, index): GatePresenceRequest => ({
        label: `l${index}`,
        state: "connected",
        region: "sjc",
        gateMachineId: "m",
        at: 1,
      }),
    );
    const results = await api.presence(reports);
    expect(results).toHaveLength(reports.length);
    expect(calls.map((call) => call.url)).toEqual([
      "https://connect.test/api/gate/presence/batch",
      "https://connect.test/api/gate/presence/batch",
    ]);
    expect(calls.map((call) => call.body.reports?.length)).toEqual([
      GATE_PRESENCE_BATCH_MAX,
      10,
    ]);
    const malformed = createAccountApi({
      baseUrl: "https://connect.test",
      secret: "s",
      fetch: async () => Response.json({ results: ["maybe"] }),
    });
    await expect(malformed.presence(reports.slice(0, 1))).rejects.toThrow(
      "malformed",
    );
  });
});

describe("frp hooks", () => {
  it("accepts only the label and its share ports", () => {
    expect(isOwnSubdomain("bee", "bee")).toBe(true);
    expect(isOwnSubdomain("bee", "bee--3000")).toBe(true);
    expect(isOwnSubdomain("bee", "bee--65535")).toBe(true);
    expect(isOwnSubdomain("bee", "bee--65536")).toBe(false);
    expect(isOwnSubdomain("bee", "bee--0")).toBe(false);
    expect(isOwnSubdomain("bee", "bee--x")).toBe(false);
    expect(isOwnSubdomain("bee", "beehive")).toBe(false);
    expect(isOwnSubdomain("bee", "wasp")).toBe(false);
  });

  it("parses both user shapes frps sends", () => {
    expect(
      parseHookCall({
        op: "Login",
        content: { user: "bee", metas: { credential: "c" } },
      })?.user,
    ).toEqual({ label: "bee", credential: "c", runId: "" });
    expect(
      parseHookCall({
        op: "NewProxy",
        content: {
          user: { user: "bee", metas: {}, run_id: "r1" },
          proxy_name: "bee.bb",
          proxy_type: "http",
          subdomain: "bee",
        },
      }),
    ).toMatchObject({
      user: { label: "bee", credential: null, runId: "r1" },
      proxyName: "bee.bb",
      subdomain: "bee",
      customDomains: [],
    });
    expect(parseHookCall({ op: "Login", content: { user: 5 } })).toBeNull();
  });
});

describe("tunnel directory", () => {
  it("holds a label while any of its proxies is online", () => {
    const directory = createLocalDirectory();
    const events: string[] = [];
    directory.onLabelPresence((label, state) =>
      events.push(`${label}:${state}`),
    );
    directory.connected({
      label: "bee",
      subdomain: "bee--3000",
      clientId: "a",
    });
    expect(events).toEqual(["bee:connected"]);
    expect(directory.onlineLabels()).toEqual(["bee"]);
    directory.connected({ label: "bee", subdomain: "bee", clientId: "b" });
    directory.connected({ label: "bee", subdomain: "bee", clientId: "c" });
    directory.disconnected({ label: "bee", subdomain: "bee", clientId: "b" });
    expect(directory.locate("bee").kind).toBe("here");
    directory.disconnected({ label: "bee", subdomain: "bee", clientId: "c" });
    expect(events).toEqual(["bee:connected"]);
    directory.disconnected({
      label: "bee",
      subdomain: "bee--3000",
      clientId: "a",
    });
    expect(events).toEqual(["bee:connected", "bee:disconnected"]);
    expect(directory.onlineLabels()).toEqual([]);
  });

  it("stops waiting for a machine share its still-connected client removed", async () => {
    const directory = createLocalDirectory({ graceMs: 60_000 });
    const signal = new AbortController().signal;
    const share = { label: "air", subdomain: "air--3000", clientId: "a" };
    directory.connected(share);
    directory.disconnected(share);
    const waiting = directory.awaitReturn("air--3000", signal);
    directory.removed("air--3000");
    expect(await waiting).toEqual({ kind: "offline" });
    expect(await directory.awaitReturn("air--3000", signal)).toEqual({
      kind: "offline",
    });
    directory.connected(share);
    directory.connected({ ...share, subdomain: "air--4000" });
    directory.disconnected(share);
    expect(await directory.awaitReturn("air--3000", signal)).toEqual({
      kind: "offline",
    });
  });

  it("waits only within the grace after a drop", async () => {
    let clock = 0;
    const directory = createLocalDirectory({
      graceMs: 1_000,
      now: () => clock,
    });
    const signal = new AbortController().signal;
    expect(await directory.awaitReturn("bee", signal)).toEqual({
      kind: "offline",
    });
    directory.connected({ label: "bee", subdomain: "bee", clientId: "a" });
    directory.disconnected({ label: "bee", subdomain: "bee", clientId: "a" });
    const waiting = directory.awaitReturn("bee", signal);
    directory.connected({ label: "bee", subdomain: "bee", clientId: "b" });
    expect(await waiting).toEqual({ kind: "here" });
    directory.disconnected({ label: "bee", subdomain: "bee", clientId: "b" });
    clock = 1_001;
    expect(await directory.awaitReturn("bee", signal)).toEqual({
      kind: "offline",
    });
  });

  it("does not wait for a share its still-connected client closed", async () => {
    const clock = 0;
    const directory = createLocalDirectory({
      graceMs: 60_000,
      now: () => clock,
    });
    const signal = new AbortController().signal;
    const share = { label: "bee", subdomain: "bee--3000", clientId: "a" };
    directory.connected({ label: "bee", subdomain: "bee", clientId: "a" });
    directory.connected(share);
    directory.disconnected(share);
    expect(await directory.awaitReturn("bee--3000", signal)).toEqual({
      kind: "offline",
    });

    directory.connected(share);
    directory.disconnected(share);
    directory.disconnected({ label: "bee", subdomain: "bee", clientId: "a" });
    const waiting = directory.awaitReturn("bee--3000", signal);
    directory.connected({ label: "bee", subdomain: "bee", clientId: "b" });
    directory.connected({ ...share, clientId: "b" });
    expect(await waiting).toEqual({ kind: "here" });
  });
});

function presenceRecorder(failFirst = 0) {
  const calls: { at: number; reports: GatePresenceRequest[] }[] = [];
  let failures = failFirst;
  const accounts: AccountApi = {
    resolve: () => Promise.reject(new Error("unused")),
    forget: () => {},
    async presence(reports) {
      calls.push({ at: Date.now(), reports });
      if (failures > 0) {
        failures -= 1;
        throw new Error("account API answered HTTP 502");
      }
      return reports.map(() => "recorded" as const);
    },
  };
  return { calls, accounts };
}

function connectLabel(
  directory: ReturnType<typeof createLocalDirectory>,
  label: string,
): void {
  directory.connected({ label, subdomain: label, clientId: label });
}

describe("presence", () => {
  it("coalesces events per label into one batch per flush", async () => {
    const { calls, accounts } = presenceRecorder();
    const directory = createLocalDirectory();
    const presence = startPresence({
      accounts,
      directory,
      region: "sjc",
      gateMachineId: "m1",
      refreshMs: 60_000,
      flushMs: 50,
      log: silentLog,
    });
    connectLabel(directory, "a");
    connectLabel(directory, "b");
    connectLabel(directory, "c");
    directory.disconnected({ label: "c", subdomain: "c", clientId: "c" });
    await waitUntil(() => calls.length > 0);
    await presence.settle();
    expect(calls).toHaveLength(1);
    expect(
      calls[0]?.reports.map((report) => `${report.label}:${report.state}`),
    ).toEqual(["a:connected", "b:connected", "c:disconnected"]);
    expect(calls[0]?.reports[0]).toMatchObject({
      region: "sjc",
      gateMachineId: "m1",
    });
    await presence.stop(100);
  });

  it("spreads refreshes over the interval instead of sending them at once", async () => {
    const { calls, accounts } = presenceRecorder();
    const directory = createLocalDirectory();
    const refreshMs = 600;
    const presence = startPresence({
      accounts,
      directory,
      region: "sjc",
      gateMachineId: "m1",
      refreshMs,
      flushMs: 20,
      log: silentLog,
    });
    const started = Date.now();
    for (let index = 0; index < 60; index += 1) {
      connectLabel(directory, `l${index}`);
    }
    await new Promise((resolve) => setTimeout(resolve, refreshMs + 100));
    const refreshes = calls.slice(1);
    await presence.stop(100);
    const labels = new Set(
      refreshes.flatMap((call) => call.reports.map((report) => report.label)),
    );
    expect(labels.size).toBe(60);
    expect(refreshes.length).toBeGreaterThanOrEqual(5);
    expect(
      Math.max(...refreshes.map((call) => call.reports.length)),
    ).toBeLessThan(30);
    expect(refreshes[0]!.at - started).toBeGreaterThanOrEqual(
      refreshMs / 2 - 30,
    );
  });

  it("retries a failed batch with the newest state of each label", async () => {
    const { calls, accounts } = presenceRecorder(1);
    const directory = createLocalDirectory();
    const presence = startPresence({
      accounts,
      directory,
      region: "sjc",
      gateMachineId: "m1",
      refreshMs: 60_000,
      flushMs: 20,
      log: silentLog,
    });
    connectLabel(directory, "a");
    connectLabel(directory, "b");
    await waitUntil(() => calls.length === 1);
    directory.disconnected({ label: "a", subdomain: "a", clientId: "a" });
    await waitUntil(() => calls.length === 2);
    expect(
      calls[1]?.reports
        .map((report) => `${report.label}:${report.state}`)
        .sort(),
    ).toEqual(["a:disconnected", "b:connected"]);
    await presence.stop(100);
  });

  it("says goodbye for every held label in one go when it stops, then stays quiet", async () => {
    const { calls, accounts } = presenceRecorder();
    const directory = createLocalDirectory();
    const presence = startPresence({
      accounts,
      directory,
      region: "sjc",
      gateMachineId: "m1",
      refreshMs: 60_000,
      flushMs: 10_000,
      log: silentLog,
    });
    connectLabel(directory, "a");
    connectLabel(directory, "b");
    await presence.stop(1_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.reports.map((report) => report.state)).toEqual([
      "disconnected",
      "disconnected",
    ]);
    directory.disconnected({ label: "a", subdomain: "a", clientId: "a" });
    await presence.settle();
    expect(calls).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("ends an frp WebSocket on a frame boundary with a going-away close frame", () => {
    const head = Buffer.from(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n",
    );
    const small = Buffer.from([0x82, 0x03, 1, 2, 3]);
    const medium = Buffer.concat([
      Buffer.from([0x82, 0x7e, 0x01, 0x00]),
      Buffer.alloc(256, 7),
    ]);
    const stream = Buffer.concat([head, small, medium]);
    for (const cut of [1, 7, 40, head.length + 1, head.length + 6]) {
      const tracker = trackServerFrames();
      tracker.observe(stream.subarray(0, cut));
      tracker.observe(stream.subarray(cut));
      expect(tracker.closing()).toEqual(WEBSOCKET_GOING_AWAY);
    }
    const partial = trackServerFrames();
    partial.observe(stream.subarray(0, stream.length - 10));
    expect(partial.closing()).toEqual(
      Buffer.concat([Buffer.alloc(10), WEBSOCKET_GOING_AWAY]),
    );
    const midHeader = trackServerFrames();
    midHeader.observe(Buffer.concat([head, small, medium.subarray(0, 3)]));
    expect(midHeader.closing()).toEqual(Buffer.alloc(0));
    const beforeUpgrade = trackServerFrames();
    beforeUpgrade.observe(head.subarray(0, 10));
    expect(beforeUpgrade.closing()).toEqual(Buffer.alloc(0));
  });

  it("compresses large dynamic bodies with a cheaper brotli quality", async () => {
    expect(brotliQuality({ length: 200_000, stored: false })).toBe(
      LARGE_BROTLI_QUALITY,
    );
    expect(brotliQuality({ length: null, stored: false })).toBe(
      LARGE_BROTLI_QUALITY,
    );
    expect(
      brotliQuality({ length: LARGE_DYNAMIC_BYTES - 1, stored: false }),
    ).toBe(5);
    expect(brotliQuality({ length: 200_000, stored: true })).toBe(
      STORED_BROTLI_QUALITY,
    );
    const body = Buffer.from(
      JSON.stringify(
        Array.from({ length: 3_000 }, (_, index) => ({
          index,
          name: `row-${index}`,
        })),
      ),
    );
    for (const length of [body.length, null]) {
      const encoder = compressor("br", { length, stored: false });
      const chunks: Buffer[] = [];
      encoder.on("data", (chunk: Buffer) => chunks.push(chunk));
      const ended = new Promise((resolve) => encoder.on("end", resolve));
      encoder.end(body);
      await ended;
      expect(brotliDecompressSync(Buffer.concat(chunks))).toEqual(body);
    }
    expect(
      brotliCompressSync(body, {
        params: { [constants.BROTLI_PARAM_QUALITY]: LARGE_BROTLI_QUALITY },
      }).length,
    ).toBeLessThan(body.length / 4);
  });

  it("tells the LRU's owner about every entry it drops", () => {
    const dropped: string[] = [];
    const lru = new Lru<string>({
      maxEntries: 2,
      maxBytes: 100,
      sizeOf: () => 1,
      onDelete: (key) => dropped.push(key),
    });
    lru.set("a", "1", 10);
    lru.set("b", "2", 100);
    lru.set("c", "3", 100);
    expect(lru.get("b", 50)).toBe("2");
    expect(lru.get("c", 200)).toBeUndefined();
    lru.delete("b");
    expect(dropped).toEqual(["a", "c", "b"]);
    expect(lru.peek("b")).toBeUndefined();
  });

  it("bounds the LRU by entries and bytes", () => {
    const lru = new Lru<string>({
      maxEntries: 3,
      maxBytes: 10,
      sizeOf: (v) => v.length,
    });
    lru.set("a", "aaaa", 100);
    lru.set("b", "bbbb", 100);
    lru.get("a", 0);
    lru.set("c", "cccc", 100);
    expect(lru.get("b", 0)).toBeUndefined();
    expect(lru.get("a", 0)).toBe("aaaa");
    expect(lru.totalBytes).toBe(8);
    expect(lru.get("a", 100)).toBeUndefined();
    lru.set("huge", "x".repeat(11), 100);
    expect(lru.get("huge", 0)).toBeUndefined();
  });

  it("picks encodings by q-value", () => {
    expect(preferredEncoding("gzip, deflate, br, zstd")).toBe("br");
    expect(preferredEncoding("gzip, br;q=0")).toBe("gzip");
    expect(preferredEncoding("identity")).toBe("identity");
    expect(preferredEncoding(undefined)).toBe("identity");
    expect(preferredEncoding("*")).toBe("br");
  });

  it("compresses only text-like bodies the origin left alone", () => {
    const json = [["content-type", "application/json"]] as [string, string][];
    expect(shouldCompress("GET", 200, json)).toBe(true);
    expect(shouldCompress("HEAD", 200, json)).toBe(false);
    expect(shouldCompress("GET", 304, json)).toBe(false);
    expect(
      shouldCompress("GET", 200, [...json, ["content-encoding", "br"]]),
    ).toBe(false);
    expect(
      shouldCompress("GET", 200, [...json, ["content-length", "20"]]),
    ).toBe(false);
    expect(
      shouldCompress("GET", 200, [["content-type", "text/event-stream"]]),
    ).toBe(false);
    expect(shouldCompress("GET", 200, [["content-type", "image/png"]])).toBe(
      false,
    );
    expect(
      shouldCompress("GET", 200, [...json, ["cache-control", "no-transform"]]),
    ).toBe(false);
  });

  it("filters platform cookies both ways", () => {
    expect(
      tenantCookies(
        "__Secure-better-auth.session_token=a; theme=dark; bb-connect.desktop_session=b",
      ),
    ).toBe("theme=dark");
    expect(tenantCookies("better-auth.session_token=a")).toBeNull();
    expect(isTenantSetCookie("kept=1; Path=/")).toBe(true);
    expect(isTenantSetCookie("x=1; Domain=getbb.app")).toBe(false);
    expect(isTenantSetCookie("__Secure-bb-connect.x=1")).toBe(false);
    expect(isTenantSetCookie("a=1, b=2")).toBe(false);
  });

  it("recognises the local MCP path in disguise", () => {
    expect(isMcpLocalPath("/api/v1/plugins/bb--mcp/http/mcp")).toBe(true);
    expect(isMcpLocalPath("/x/../API/v1/plugins/bb--mcp/http/%256dcp")).toBe(
      true,
    );
    expect(isMcpLocalPath("/api/v1/plugins/bb--mcp/http/mcpx")).toBe(false);
  });

  it("reads its configuration from the environment", () => {
    const key = JSON.stringify({
      kid: "k1",
      kty: "OKP",
      crv: "Ed25519",
      x: "x",
      d: "d",
    });
    const config = configFromEnv({
      ACCOUNT_API_URL: "https://connect.getbb.app",
      GATE_SECRET: "s",
      GATE_SIGNING_KEY: key,
    });
    expect(config).toMatchObject({
      baseDomain: "next.getbb.app",
      scheme: "https",
      accountAppUrl: "https://getbb.app",
      ports: { web: 8080, frpTcp: null },
    });
    expect(() =>
      configFromEnv({
        ACCOUNT_API_URL: "https://x.test/path",
        GATE_SECRET: "s",
        GATE_SIGNING_KEY: key,
      }),
    ).toThrow("ACCOUNT_API_URL");
    expect(() =>
      configFromEnv({
        ACCOUNT_API_URL: "https://x.test",
        GATE_SECRET: "s",
        GATE_SIGNING_KEY: "{}",
      }),
    ).toThrow("GATE_SIGNING_KEY");
  });
});

describe("machine label proxy", () => {
  it("posts the body with the machine credential and passes the answer through", async () => {
    const seen: Array<{
      url: string;
      credential: string | null;
      body: string;
    }> = [];
    const proxy = createMachineLabelProxy({
      accountApiUrl: "https://connect.getbb.app",
      fetch: async (input, init) => {
        seen.push({
          url: String(input),
          credential: new Headers(init?.headers).get("x-bb-connect-machine"),
          body: new TextDecoder().decode(init?.body as Uint8Array),
        });
        return Response.json({ label: "laptop" }, { status: 200 });
      },
    });
    const answer = await proxy.assign(
      "cred-machine",
      Buffer.from('{"desiredName":"Laptop"}'),
    );
    expect(seen).toEqual([
      {
        url: "https://connect.getbb.app/api/connect/machine-label",
        credential: "cred-machine",
        body: '{"desiredName":"Laptop"}',
      },
    ]);
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(answer.body.toString())).toEqual({ label: "laptop" });
  });
});
