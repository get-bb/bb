import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import {
  SealedChannelClient,
  base64UrlDecode,
  bytesEqual,
  generateSigningKeyPair,
  localDeviceIdentity,
  createDelegation,
  type DeviceIdentity,
  type SealedSocket,
} from "@bb/sealed-channel";
import plugin from "../server.js";
import { createKvDeviceRegistry } from "./devices.js";
import { plaintextStreamVerdict } from "./sealed-access.js";
import {
  SEALED_HTTP_PREFIX,
  SEALED_REALTIME_CHANNEL,
  type SealedDeviceCode,
  type SealedStatus,
} from "./types.js";

const SECRET_BODY = "sealed-secret-body-77a1";

type ExperimentalFakeWebSocketSession = Awaited<
  ReturnType<FakePluginHost["harness"]["experimental_openWebSocket"]>
>;

interface Loopback {
  origin: string;
  requests: Array<{
    path: string;
    headers: Record<string, string | string[] | undefined>;
  }>;
  close(): Promise<void>;
}

async function startLoopback(): Promise<Loopback> {
  const requests: Loopback["requests"] = [];
  const server: Server = createServer((request, response) => {
    requests.push({ path: request.url ?? "", headers: request.headers });
    if (request.url === "/api/v1/system/config") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ secret: SECRET_BODY }));
      return;
    }
    response.writeHead(404);
    response.end("nope");
  });
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket) => {
    socket.on("message", (data) => socket.send(`echo:${data.toString()}`));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

function createHost(loopback: string): FakePluginHost {
  return createFakePluginHost({
    pluginId: "connect",
    loopbackBaseUrl: loopback,
    sdk: {
      system: {
        config: async () =>
          ({
            primaryHostId: "host-server",
            experiments: { mobileApp: true },
          }) as never,
      },
      hosts: {
        get: async () => ({ id: "host-server", name: "Server" }) as never,
        list: async () => [{ id: "host-server", name: "Server" }] as never,
      },
    },
  });
}

function socketOverFakeSession(
  session: ExperimentalFakeWebSocketSession,
  wire: Uint8Array[],
): SealedSocket {
  let delivered = 0;
  let closed = false;
  const flush = () => {
    while (delivered < session.sent.length) {
      const entry = session.sent[delivered++]!;
      if (typeof entry === "string") continue;
      wire.push(entry);
      socket.onMessage?.(entry);
    }
    if (!closed && session.readyState >= 2) {
      closed = true;
      clearInterval(polling);
      const call = session.closeCalls[0];
      socket.onClose?.(call?.code ?? 1000, call?.reason ?? "");
    }
  };
  const polling = setInterval(flush, 5);
  const socket: SealedSocket = {
    send(data) {
      const copy = data.slice();
      wire.push(copy);
      void session.receive(copy).then(flush, flush);
    },
    close(code, reason) {
      if (closed) return;
      closed = true;
      clearInterval(polling);
      void session
        .close(code, reason)
        .then(() => socket.onClose?.(code ?? 1000, reason ?? ""));
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  queueMicrotask(() => socket.onOpen?.());
  return socket;
}

async function connectDevice(
  host: FakePluginHost,
  device: DeviceIdentity,
  options: {
    deviceCode?: string;
    delegation?: Parameters<
      typeof SealedChannelClient.connect
    >[0]["delegation"];
    name?: string;
    expectedKey?: Uint8Array;
    wire?: Uint8Array[];
  } = {},
) {
  const session = await host.harness.experimental_openWebSocket("/sealed", {
    headers: { origin: "https://sawyer.getbb.app" },
  });
  const wire = options.wire ?? [];
  return SealedChannelClient.connect({
    socket: socketOverFakeSession(session, wire),
    device,
    deviceName: options.name ?? "Test browser",
    surface: "browser",
    ...(options.deviceCode !== undefined
      ? { deviceCode: options.deviceCode }
      : {}),
    ...(options.delegation !== undefined
      ? { delegation: options.delegation }
      : {}),
    verifyServerKey: (key) =>
      options.expectedKey === undefined || bytesEqual(key, options.expectedKey)
        ? "accept"
        : "reject",
    supportsStreaming: true,
  });
}

async function manage<T>(
  host: FakePluginHost,
  path: string,
  body: unknown = null,
): Promise<T> {
  const response = await host.harness.fetchHttp("POST", `/sealed${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  const payload = (await response.json()) as
    | { ok: true; result: T }
    | { ok: false; error: string };
  if (!payload.ok) throw new Error(payload.error);
  return payload.result;
}

function wireIncludes(wire: Uint8Array[], text: string): boolean {
  const needle = Buffer.from(text);
  return wire.some((chunk) => Buffer.from(chunk).includes(needle));
}

describe("plaintextStreamVerdict", () => {
  const http = (path: string, method = "GET") => ({
    kind: "http" as const,
    method,
    path,
    headers: [],
    target: undefined,
  });

  it("allows everything while encryption is not required", () => {
    expect(plaintextStreamVerdict(http("/api/v1/threads"), false)).toEqual({
      allow: true,
    });
    expect(
      plaintextStreamVerdict({ ...http("/ws"), kind: "ws" }, false),
    ).toEqual({ allow: true });
  });

  it("keeps the app shell, sealed endpoint, installers, daemons, and shares readable when required", () => {
    for (const path of [
      "/",
      "/index.html",
      "/assets/index-abc.js",
      "/thread/thr_123?view=full",
      "/manifest.webmanifest",
      `${SEALED_HTTP_PREFIX}/sealed`,
      `${SEALED_HTTP_PREFIX}/sealed/info`,
      "/install.sh",
      "/install/bb-app.tgz",
      "/internal/hosts/enroll",
      "/internal/ws",
      "/health",
      "/api/v1/plugins/connect/assets/app.js",
      "/api/v1/plugin-app-assets/0123456789abcdef/app.js",
    ]) {
      expect(plaintextStreamVerdict(http(path), true), path).toEqual({
        allow: true,
      });
    }
    expect(
      plaintextStreamVerdict(
        { ...http("/api/v1/threads"), target: "8000" },
        true,
      ),
    ).toEqual({
      allow: true,
    });
    expect(
      plaintextStreamVerdict(
        { ...http(`${SEALED_HTTP_PREFIX}/sealed`), kind: "ws" },
        true,
      ),
    ).toEqual({
      allow: true,
    });
    expect(
      plaintextStreamVerdict(
        {
          ...http("/internal/session/events", "POST"),
          headers: [["authorization", "Bearer daemon-token"]],
        },
        true,
      ),
    ).toEqual({ allow: true });
  });

  it("refuses readable API, realtime, and mutation traffic when required", () => {
    for (const stream of [
      http("/api/v1/threads"),
      http("/api/v1/system/config"),
      http("/api/v1/plugins/connect/rpc/status", "POST"),
      http("/", "POST"),
      { ...http("/ws"), kind: "ws" as const },
      { ...http("/ws?x=1"), kind: "ws" as const },
      { ...http("/api/v1/threads/thr_1/terminal"), kind: "ws" as const },
      http("/internal/hosts/enroll-key", "POST"),
      {
        ...http("/internal/hosts/enroll-key", "POST"),
        headers: [["authorization", "Bearer forged"]] as Array<
          [string, string]
        >,
      },
      {
        ...http("/internal/server-move/pending"),
        headers: [["Authorization", "Bearer forged"]] as Array<
          [string, string]
        >,
      },
      {
        ...http("/internal/server-move/mv_1/archive"),
        headers: [["authorization", "Bearer forged"]] as Array<
          [string, string]
        >,
      },
      http("/internal/hosts/session", "POST"),
      http(`${SEALED_HTTP_PREFIX}/sealed/require`, "POST"),
      http(`${SEALED_HTTP_PREFIX}/sealed/devices/approve`, "POST"),
      http(`${SEALED_HTTP_PREFIX}/sealed/device-codes`, "POST"),
    ]) {
      const verdict = plaintextStreamVerdict(stream, true);
      expect(verdict.allow, stream.path).toBe(false);
      if (!verdict.allow) {
        expect(verdict.status).toBe(403);
        expect(verdict.code).toBe("sealed_required");
      }
    }
  });
});

describe("sealed connect channel", () => {
  let host: FakePluginHost | undefined;
  let loopback: Loopback | undefined;

  async function load() {
    loopback = await startLoopback();
    host = createHost(loopback.origin);
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    return { host, loopback };
  }

  afterEach(async () => {
    if (host) {
      await host.harness.dispose();
      host = undefined;
    }
    await loopback?.close();
    loopback = undefined;
    vi.restoreAllMocks();
  });

  it("publishes the server key and policy on the info route", async () => {
    const { host } = await load();
    const response = await host.harness.fetchHttp("GET", "/sealed/info");
    expect(response.status).toBe(200);
    const info = (await response.json()) as {
      fingerprint: string;
      publicKey: string;
      required: boolean;
    };
    expect(info.fingerprint).toMatch(/^([0-9A-F]{4}-){5}[0-9A-F]{4}$/u);
    expect(info.required).toBe(false);
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.fingerprint).toBe(info.fingerprint);
    expect(status.publicKey).toBe(info.publicKey);
    expect(status.devices).toEqual([]);
  });

  it("approves account-gated devices automatically while encryption is not required", async () => {
    const { host } = await load();
    const first = await connectDevice(
      host,
      localDeviceIdentity(generateSigningKeyPair()),
    );
    expect(first.outcome.status).toBe("ok");
    first.client?.close();
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices[0]).toMatchObject({ status: "approved" });
  });

  it("demotes automatically approved devices when the policy flips on through the local route and survives reload", async () => {
    const { host } = await load();
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const first = await connectDevice(host, identity);
    expect(first.outcome.status).toBe("ok");
    const closed = new Promise<string>((resolve) =>
      first.client!.onClose((_code, reason) => resolve(reason)),
    );
    await manage(host, "/require", { required: true });
    expect(await closed).toBe("device revoked");
    const info = (await (
      await host.harness.fetchHttp("GET", "/sealed/info")
    ).json()) as { required: boolean };
    expect(info.required).toBe(true);
    const again = await connectDevice(host, identity);
    expect(again.outcome.status).toBe("pending");
  });

  it("refuses device management from relayed or sealed callers and marks sealed requests for the origin", async () => {
    const { host, loopback } = await load();
    for (const header of [
      ["x-bb-gate-auth", "session"],
      ["x-bb-sealed-device", "dev_x"],
    ]) {
      const response = await host.harness.fetchHttp("POST", "/sealed/require", {
        body: JSON.stringify({ required: true }),
        headers: {
          "content-type": "application/json",
          [header[0]!]: header[1]!,
        },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "local_only" });
    }
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const connection = await connectDevice(host, identity);
    const client = connection.client!;
    await client.request({
      method: "GET",
      path: "/api/v1/system/config",
      headers: [
        ["x-bb-sealed-device", "forged"],
        ["x-bb-gate-auth", "session"],
      ],
      body: null,
    });
    const seen = loopback.requests[0]?.headers;
    expect(seen?.["x-bb-sealed-device"]).toBe(
      connection.outcome.status === "ok" ? connection.outcome.deviceId : "",
    );
    expect(seen?.["x-bb-gate-auth"]).toBeUndefined();
    client.close();
  });

  it("holds an unknown device pending until it is approved, then relays sealed requests", async () => {
    const { host, loopback } = await load();
    await host.harness.runCli(["require-encryption", "on"]);
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    const serverKey = base64UrlDecode(status.publicKey);

    const first = await connectDevice(host, identity, {
      expectedKey: serverKey,
    });
    expect(first.outcome.status).toBe("pending");
    expect(first.client).toBeNull();
    const pending = (await host.harness.callRpc(
      "sealedStatus",
    )) as SealedStatus;
    expect(pending.devices).toHaveLength(1);
    expect(pending.devices[0]).toMatchObject({
      status: "pending",
      name: "Test browser",
      surface: "browser",
    });
    expect(
      host.harness.realtimeSignals.some(
        (signal) => signal.channel === SEALED_REALTIME_CHANNEL,
      ),
    ).toBe(true);

    const cli = await host.harness.runCli([
      "approve-device",
      pending.devices[0]!.id,
    ]);
    expect(cli.exitCode).toBe(0);
    expect(cli.stdout).toContain("Approved");

    const wire: Uint8Array[] = [];
    const second = await connectDevice(host, identity, {
      expectedKey: serverKey,
      wire,
    });
    expect(second.outcome.status).toBe("ok");
    const client = second.client!;
    const response = await client.request({
      method: "GET",
      path: "/api/v1/system/config",
      headers: [
        ["origin", "https://sawyer.getbb.app"],
        ["x-probe", "1"],
      ],
      body: null,
    });
    expect(response.status).toBe(200);
    const body = await new Response(
      response.body as ReadableStream<Uint8Array>,
    ).text();
    expect(JSON.parse(body)).toEqual({ secret: SECRET_BODY });
    expect(loopback.requests[0]?.headers["x-probe"]).toBe("1");
    expect(wireIncludes(wire, SECRET_BODY)).toBe(false);
    expect(wireIncludes(wire, "/api/v1/system/config")).toBe(false);

    const connected = (await host.harness.callRpc(
      "sealedStatus",
    )) as SealedStatus;
    expect(connected.activeChannels).toBe(1);
    expect(connected.devices[0]).toMatchObject({
      status: "approved",
      connected: true,
    });

    const stream = client.openWebSocket({ path: "/ws" });
    const messages: string[] = [];
    await new Promise<void>((resolve) => {
      stream.onOpen = () => stream.send("hello");
      stream.onMessage = (data) => {
        messages.push(String(data));
        resolve();
      };
    });
    expect(messages).toEqual(["echo:hello"]);
    expect(wireIncludes(wire, "echo:hello")).toBe(false);
    const withRealtime = (await host.harness.callRpc("status")) as {
      remoteClients: number;
    };
    expect(withRealtime.remoteClients).toBe(1);
    client.close();
  });

  it("approves a device immediately with a one-time device code", async () => {
    const { host } = await load();
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const okay = await connectDevice(host, identity, {
      deviceCode: code.code.toLowerCase(),
      expectedKey: base64UrlDecode(code.serverKey),
    });
    expect(okay.outcome.status).toBe("ok");
    okay.client?.close();
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices[0]).toMatchObject({ status: "approved" });

    await expect(
      connectDevice(host, localDeviceIdentity(generateSigningKeyPair()), {
        deviceCode: code.code,
      }),
    ).rejects.toThrow("without proving the device code");
  });

  it("accepts a delegation bound to this server from an approved parent, revalidates it, and cascades revocation", async () => {
    const { host } = await load();
    await host.harness.runCli(["require-encryption", "on"]);
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const serverKey = base64UrlDecode(code.serverKey);
    const parentPair = generateSigningKeyPair();
    const parent = localDeviceIdentity(parentPair);
    const enrolled = await connectDevice(host, parent, {
      deviceCode: code.code,
      name: "Phone",
    });
    expect(enrolled.outcome.status).toBe("ok");
    enrolled.client?.close();

    const childPair = generateSigningKeyPair();
    const child = localDeviceIdentity(childPair);
    const delegate = (key: Uint8Array) =>
      createDelegation(parent, childPair.publicKey, Date.now() + 60_000, key);
    const viaParent = await connectDevice(host, child, {
      delegation: delegate,
      name: "Phone page",
    });
    expect(viaParent.outcome.status).toBe("ok");
    const childClosed = new Promise<string>((resolve) =>
      viaParent.client!.onClose((_code, reason) => resolve(reason)),
    );
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices.map((device) => device.name)).toEqual([
      "Phone",
      "Phone page (via Phone)",
    ]);
    expect(status.devices[1]?.parentId).toBe(status.devices[0]?.id);

    const forOtherServer = await connectDevice(host, child, {
      delegation: () =>
        createDelegation(
          parent,
          childPair.publicKey,
          Date.now() + 60_000,
          generateSigningKeyPair().publicKey,
        ),
      name: "Phone page",
    });
    expect(forOtherServer.outcome).toMatchObject({
      status: "rejected",
      reason: "invalid-delegation",
    });
    const withoutProof = await connectDevice(host, child, {
      name: "Phone page",
    });
    expect(withoutProof.outcome).toMatchObject({
      status: "rejected",
      reason: "invalid-delegation",
    });

    const stranger = localDeviceIdentity(generateSigningKeyPair());
    const orphanPair = generateSigningKeyPair();
    const rejected = await connectDevice(
      host,
      localDeviceIdentity(orphanPair),
      {
        delegation: (key) =>
          createDelegation(
            stranger,
            orphanPair.publicKey,
            Date.now() + 60_000,
            key,
          ),
      },
    );
    expect(rejected.outcome).toMatchObject({
      status: "rejected",
      reason: "invalid-delegation",
    });

    await host.harness.runCli(["revoke-device", status.devices[0]!.id]);
    expect(await childClosed).toBe("device revoked");
    const afterRevoke = await connectDevice(host, child, {
      delegation: delegate,
      name: "Phone page",
    });
    expect(afterRevoke.outcome).toMatchObject({
      status: "rejected",
      reason: "invalid-delegation",
    });
    const revoked = (await host.harness.callRpc(
      "sealedStatus",
    )) as SealedStatus;
    expect(
      revoked.devices.map((device) => [device.name, device.status]),
    ).toEqual([["Phone", "revoked"]]);
    expect(serverKey.length).toBe(32);
  });

  it("proves a device code to an already approved device so it can verify the key", async () => {
    const { host } = await load();
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const first = await connectDevice(host, identity);
    expect(first.outcome.status).toBe("ok");
    first.client?.close();
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const again = await connectDevice(host, identity, {
      deviceCode: code.code,
    });
    expect(again.outcome.status).toBe("ok");
    again.client?.close();
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices).toHaveLength(1);
    expect(status.devices[0]).toMatchObject({ status: "approved" });
  });

  it("demotes every device approved while encryption was optional, including code-paired ones", async () => {
    const { host } = await load();
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const paired = localDeviceIdentity(generateSigningKeyPair());
    const enrolled = await connectDevice(host, paired, {
      deviceCode: code.code,
    });
    expect(enrolled.outcome.status).toBe("ok");
    const closed = new Promise<string>((resolve) =>
      enrolled.client!.onClose((_code, reason) => resolve(reason)),
    );
    const on = await host.harness.runCli(["require-encryption", "on"]);
    expect(on.stdout).toContain("need approval again");
    expect(await closed).toBe("device revoked");
    const again = await connectDevice(host, paired);
    expect(again.outcome.status).toBe("pending");
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices.map((device) => device.status)).toEqual(["pending"]);
    await host.harness.runCli(["approve-device", status.devices[0]!.id]);
    const approved = await connectDevice(host, paired);
    expect(approved.outcome.status).toBe("ok");
    approved.client?.close();
  });

  it("keeps optional-era approvals invalid after a restart that interrupted the flip", async () => {
    loopback = await startLoopback();
    host = createHost(loopback.origin);
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const first = await connectDevice(host, identity);
    expect(first.outcome.status).toBe("ok");
    first.client?.close();
    await host.bb.storage.kv.set("sealed-policy", {
      requireEncryption: true,
      generation: 1,
    });
    host = await host.harness.reload((bb) =>
      plugin(bb as unknown as Parameters<typeof plugin>[0]),
    );
    const childPair = generateSigningKeyPair();
    const viaStaleParent = await connectDevice(
      host,
      localDeviceIdentity(childPair),
      {
        delegation: (key) =>
          createDelegation(
            identity,
            childPair.publicKey,
            Date.now() + 60_000,
            key,
          ),
        name: "Phone page",
      },
    );
    expect(viaStaleParent.outcome).toMatchObject({
      status: "rejected",
      reason: "invalid-delegation",
    });
    const again = await connectDevice(host, identity);
    expect(again.outcome.status).toBe("pending");
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices.map((device) => device.status)).toEqual(["pending"]);
  });

  it("treats an unreadable policy record as required", async () => {
    loopback = await startLoopback();
    host = createHost(loopback.origin);
    await host.bb.storage.kv.set("sealed-policy", { requireEncryption: "yes" });
    await plugin(host.bb as unknown as Parameters<typeof plugin>[0]);
    const info = (await (
      await host.harness.fetchHttp("GET", "/sealed/info")
    ).json()) as { required: boolean };
    expect(info.required).toBe(true);
    expect(
      host.harness.logEntries.some((entry) =>
        /policy record is unreadable/u.test(entry.message),
      ),
    ).toBe(true);
  });

  it("keeps a revocation that races with the device's own activity", async () => {
    const kv = new Map<string, unknown>();
    const registry = createKvDeviceRegistry({
      get: async <T>(key: string) => kv.get(key) as T | undefined,
      set: async (key: string, value: unknown) => {
        kv.set(key, value);
      },
      delete: async (key: string) => {
        kv.delete(key);
      },
      list: async (prefix: string) =>
        [...kv.keys()].filter((key) => key.startsWith(prefix)),
    });
    const pair = generateSigningKeyPair();
    const device = await registry.register(
      { publicKey: pair.publicKey, name: "Laptop", surface: "browser" },
      "approved",
      "manual",
    );
    await Promise.all([
      registry.touch(device.id),
      registry.revoke(device.id),
      registry.touch(device.id),
      registry.register(
        { publicKey: pair.publicKey, name: "Laptop", surface: "browser" },
        "approved",
        "manual",
      ),
    ]);
    expect((await registry.get(device.id))?.status).toBe("revoked");
    expect(await registry.approve(device.id)).toBeNull();
  });

  it("revokes a device, closing its live channel and refusing new ones", async () => {
    const { host } = await load();
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const identity = localDeviceIdentity(generateSigningKeyPair());
    const live = await connectDevice(host, identity, {
      deviceCode: code.code,
    });
    expect(live.outcome.status).toBe("ok");
    const closed = new Promise<string>((resolve) =>
      live.client!.onClose((_code, reason) => resolve(reason)),
    );
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    const cli = await host.harness.runCli([
      "revoke-device",
      status.devices[0]!.id,
      "--json",
    ]);
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({ status: "revoked" });
    expect(await closed).toBe("device revoked");

    const again = await connectDevice(host, identity);
    expect(again.outcome).toMatchObject({
      status: "rejected",
      reason: "revoked",
    });

    const removed = await host.harness.runCli([
      "remove-device",
      status.devices[0]!.id,
    ]);
    expect(removed.stdout).toContain("Removed");
    expect(
      ((await host.harness.callRpc("sealedStatus")) as SealedStatus).devices,
    ).toEqual([]);
  });

  it("aborts before authenticating when the server key is not the pinned one", async () => {
    const { host } = await load();
    const identity = localDeviceIdentity(generateSigningKeyPair());
    await expect(
      connectDevice(host, identity, {
        expectedKey: generateSigningKeyPair().publicKey,
      }),
    ).rejects.toThrow("does not match the pinned key");
    const status = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    expect(status.devices).toEqual([]);
  });

  it("flips the require policy from the CLI and reports it on the info route", async () => {
    const { host } = await load();
    const on = await host.harness.runCli([
      "require-encryption",
      "on",
      "--json",
    ]);
    expect(on.exitCode).toBe(0);
    expect((JSON.parse(on.stdout) as SealedStatus).required).toBe(true);
    const info = (await (
      await host.harness.fetchHttp("GET", "/sealed/info")
    ).json()) as { required: boolean };
    expect(info.required).toBe(true);
    const text = await host.harness.runCli(["encryption"]);
    expect(text.stdout).toContain("required for remote access");
    const bad = await host.harness.runCli(["require-encryption", "maybe"]);
    expect(bad.exitCode).not.toBe(0);
  });

  it("rotates the server identity and disconnects sealed devices", async () => {
    const { host } = await load();
    const before = (await host.harness.callRpc("sealedStatus")) as SealedStatus;
    const code = await manage<SealedDeviceCode>(host, "/device-codes");
    const live = await connectDevice(
      host,
      localDeviceIdentity(generateSigningKeyPair()),
      {
        deviceCode: code.code,
      },
    );
    const closed = new Promise<string>((resolve) =>
      live.client!.onClose((_code, reason) => resolve(reason)),
    );
    const refused = await host.harness.runCli(["rotate-key"]);
    expect(refused.exitCode).not.toBe(0);
    const rotated = await host.harness.runCli([
      "rotate-key",
      "--yes",
      "--json",
    ]);
    const after = JSON.parse(rotated.stdout) as SealedStatus;
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(await closed).toBe("server identity rotated");
    const printed = await host.harness.runCli(["device-code"]);
    expect(printed.stdout).toContain(after.fingerprint);
  });
});
