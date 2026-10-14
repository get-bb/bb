import { describe, expect, it, vi } from "vitest";
import {
  HEARTBEAT_REQUEST,
  HEARTBEAT_RESPONSE,
  decodeFrame,
  encodeFrame,
  type Frame,
} from "@bb/tunnel-contract";
import { generateSigningKeyPair } from "../src/crypto.js";
import {
  SealedChannelClient,
  SealedServerKeyMismatchError,
} from "../src/client.js";
import {
  acceptSealedChannel,
  type EstablishedSealedChannel,
} from "../src/server.js";
import { localDeviceIdentity } from "../src/index.js";
import { ServerHandshake } from "../src/protocol.js";
import { sealedFetch } from "../src/fetch.js";
import { createSocketPair, readAll, wireContains } from "./helpers.js";

const SECRET_REQUEST = "prompt-body-CONFIDENTIAL-9f3a";
const SECRET_RESPONSE = "thread-title-CONFIDENTIAL-1b2c";

interface Harness {
  client: SealedChannelClient;
  established: EstablishedSealedChannel;
  frames: Frame[];
  wire: ReturnType<typeof createSocketPair>["wire"];
  reply(frame: Frame): void;
}

async function connect(
  options: { streaming?: boolean } = {},
): Promise<Harness> {
  const pair = createSocketPair();
  const serverIdentity = generateSigningKeyPair();
  const deviceIdentity = localDeviceIdentity(generateSigningKeyPair());
  const frames: Frame[] = [];
  let established: EstablishedSealedChannel | null = null;
  const acceptor = acceptSealedChannel({
    socket: pair.server,
    identity: serverIdentity,
    authorize: async (request) => ({
      status: "ok",
      deviceId: request.deviceId,
    }),
    onEstablished(channel) {
      established = channel;
      channel.transport.on("message", (data, isBinary) => {
        if (isBinary) frames.push(decodeFrame(data));
      });
    },
  });
  pair.server.onMessage = (data) => void acceptor.onMessage(data);
  pair.server.onClose = (code, reason) => acceptor.onClose(code, reason);
  const connecting = SealedChannelClient.connect({
    socket: pair.client,
    device: deviceIdentity,
    deviceName: "Test",
    surface: "browser",
    verifyServerKey: (key) =>
      key.every((byte, index) => byte === serverIdentity.publicKey[index])
        ? "accept"
        : "reject",
    supportsStreaming: options.streaming ?? true,
  });
  pair.server.open();
  const connection = await connecting;
  if (connection.client === null || established === null)
    throw new Error("no channel");
  const channel: EstablishedSealedChannel = established;
  return {
    client: connection.client,
    established: channel,
    frames,
    wire: pair.wire,
    reply(frame) {
      channel.transport.send(encodeFrame(frame));
    },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(predicate()).toBe(true);
  });
}

describe("sealed channel end to end", () => {
  it("relays an HTTP request and streamed response as frames the wire never shows in the clear", async () => {
    const harness = await connect();
    const pending = harness.client.request({
      method: "POST",
      path: "/api/v1/threads/thr_1/messages",
      headers: [["content-type", "application/json"]],
      body: new TextEncoder().encode(SECRET_REQUEST),
    });
    await waitFor(() =>
      harness.frames.some((frame) => frame.type === "body-end"),
    );
    const open = harness.frames.find((frame) => frame.type === "open-http");
    expect(open).toMatchObject({
      method: "POST",
      path: "/api/v1/threads/thr_1/messages",
      hasBody: true,
    });
    const streamId = open!.streamId;
    const chunk = harness.frames.find((frame) => frame.type === "body-chunk");
    expect(new TextDecoder().decode((chunk as { data: Uint8Array }).data)).toBe(
      SECRET_REQUEST,
    );

    harness.reply({
      type: "resp-head",
      streamId,
      status: 200,
      headers: [
        ["content-type", "text/plain"],
        ["content-encoding", "identity"],
      ],
    });
    harness.reply({
      type: "body-chunk",
      streamId,
      data: new TextEncoder().encode(SECRET_RESPONSE.slice(0, 10)),
    });
    harness.reply({
      type: "body-chunk",
      streamId,
      data: new TextEncoder().encode(SECRET_RESPONSE.slice(10)),
    });
    harness.reply({ type: "body-end", streamId });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await readAll(response.body)).toBe(SECRET_RESPONSE);

    expect(wireContains(harness.wire, SECRET_REQUEST)).toBe(false);
    expect(wireContains(harness.wire, SECRET_RESPONSE)).toBe(false);
    expect(wireContains(harness.wire, "/api/v1/threads")).toBe(false);
    expect(wireContains(harness.wire, "content-type")).toBe(false);
  });

  it("buffers responses when streaming is unavailable", async () => {
    const harness = await connect({ streaming: false });
    const pending = harness.client.request({
      method: "GET",
      path: "/api/v1/system/config",
      headers: [],
      body: null,
    });
    await waitFor(() => harness.frames.length > 0);
    const streamId = harness.frames[0]!.streamId;
    harness.reply({ type: "resp-head", streamId, status: 200, headers: [] });
    harness.reply({
      type: "body-chunk",
      streamId,
      data: new TextEncoder().encode('{"ok":'),
    });
    harness.reply({
      type: "body-chunk",
      streamId,
      data: new TextEncoder().encode("true}"),
    });
    harness.reply({ type: "body-end", streamId });
    const response = await pending;
    expect(response.body).toBeInstanceOf(Uint8Array);
    expect(await readAll(response.body)).toBe('{"ok":true}');
  });

  it("resolves bodiless statuses without waiting for a body", async () => {
    const harness = await connect();
    const pending = harness.client.request({
      method: "GET",
      path: "/x",
      headers: [],
      body: null,
    });
    await waitFor(() => harness.frames.length > 0);
    harness.reply({
      type: "resp-head",
      streamId: harness.frames[0]!.streamId,
      status: 204,
      headers: [],
    });
    const response = await pending;
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("rejects a request the server aborts and on channel loss", async () => {
    const harness = await connect();
    const aborted = harness.client.request({
      method: "GET",
      path: "/a",
      headers: [],
      body: null,
    });
    await waitFor(() => harness.frames.length > 0);
    harness.reply({
      type: "close-stream",
      streamId: harness.frames[0]!.streamId,
      code: 1011,
      reason: "origin exploded",
    });
    await expect(aborted).rejects.toThrow("origin exploded");

    const orphan = harness.client.request({
      method: "GET",
      path: "/b",
      headers: [],
      body: null,
    });
    harness.established.close(1001, "server going away");
    await expect(orphan).rejects.toThrow("channel closed");
    expect(harness.client.isOpen).toBe(false);
  });

  it("multiplexes websocket streams with text and binary data", async () => {
    const harness = await connect();
    const stream = harness.client.openWebSocket({
      path: "/ws",
      protocols: ["bb"],
    });
    const events: string[] = [];
    stream.onOpen = () => events.push("open");
    stream.onMessage = (data) =>
      events.push(
        typeof data === "string" ? `text:${data}` : `bin:${data.length}`,
      );
    stream.onClose = (code, reason) => events.push(`close:${code}:${reason}`);
    await waitFor(() =>
      harness.frames.some((frame) => frame.type === "open-ws"),
    );
    const open = harness.frames.find((frame) => frame.type === "open-ws")!;
    expect(open).toMatchObject({ path: "/ws", protocols: ["bb"] });
    harness.reply({
      type: "ws-open-ack",
      streamId: open.streamId,
      protocol: "bb",
    });
    await waitFor(() => events.includes("open"));
    expect(stream.protocol).toBe("bb");
    stream.send(JSON.stringify({ type: "subscribe", secret: SECRET_REQUEST }));
    stream.send(new Uint8Array([1, 2, 3]));
    await waitFor(
      () =>
        harness.frames.filter((frame) => frame.type === "ws-data").length === 2,
    );
    harness.reply({
      type: "ws-data",
      streamId: open.streamId,
      isBinary: false,
      data: new TextEncoder().encode(SECRET_RESPONSE),
    });
    harness.reply({
      type: "ws-data",
      streamId: open.streamId,
      isBinary: true,
      data: new Uint8Array(5),
    });
    harness.reply({
      type: "close-stream",
      streamId: open.streamId,
      code: 4000,
      reason: "bye",
    });
    await waitFor(() => events.some((event) => event.startsWith("close:")));
    expect(events).toEqual([
      "open",
      `text:${SECRET_RESPONSE}`,
      "bin:5",
      "close:4000:bye",
    ]);
    expect(wireContains(harness.wire, SECRET_REQUEST)).toBe(false);
    expect(wireContains(harness.wire, SECRET_RESPONSE)).toBe(false);
  });

  it("answers server heartbeats inside the sealed session", async () => {
    const harness = await connect();
    const acks: string[] = [];
    harness.established.transport.on("message", (data, isBinary) => {
      if (!isBinary) acks.push(new TextDecoder().decode(data));
    });
    harness.established.transport.send(HEARTBEAT_REQUEST);
    await waitFor(() => acks.length === 1);
    expect(acks[0]).toBe(HEARTBEAT_RESPONSE);
    expect(wireContains(harness.wire, HEARTBEAT_REQUEST)).toBe(false);
  });

  it("aborts the handshake when the server key is not the pinned one", async () => {
    const pair = createSocketPair();
    const acceptor = acceptSealedChannel({
      socket: pair.server,
      identity: generateSigningKeyPair(),
      authorize: async (request) => ({
        status: "ok",
        deviceId: request.deviceId,
      }),
      onEstablished: () => {
        throw new Error("must not establish");
      },
    });
    pair.server.onMessage = (data) => void acceptor.onMessage(data);
    const connecting = SealedChannelClient.connect({
      socket: pair.client,
      device: localDeviceIdentity(generateSigningKeyPair()),
      deviceName: "Test",
      surface: "browser",
      verifyServerKey: () => "reject",
    });
    pair.server.open();
    await expect(connecting).rejects.toBeInstanceOf(
      SealedServerKeyMismatchError,
    );
    expect(pair.wire.clientToServer).toHaveLength(1);
  });

  it("rejects a second server hello while the key verifier is still deciding", async () => {
    const pair = createSocketPair();
    const identity = generateSigningKeyPair();
    const acceptor = acceptSealedChannel({
      socket: pair.server,
      identity,
      authorize: async (request) => ({
        status: "ok",
        deviceId: request.deviceId,
      }),
      onEstablished: () => {
        throw new Error("must not establish");
      },
    });
    let decide: ((value: "accept" | "reject") => void) | null = null;
    pair.server.onMessage = (data) => void acceptor.onMessage(data);
    const connecting = SealedChannelClient.connect({
      socket: pair.client,
      device: localDeviceIdentity(generateSigningKeyPair()),
      deviceName: "Test",
      surface: "browser",
      verifyServerKey: () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    });
    pair.server.open();
    await waitFor(() => decide !== null);
    const clientHello = pair.wire.clientToServer[0]!;
    const impostor = new ServerHandshake(generateSigningKeyPair());
    pair.client.onMessage?.(impostor.onClientHello(clientHello));
    await expect(connecting).rejects.toThrow("while verifying");
    decide!("accept");
    expect(pair.wire.clientToServer).toHaveLength(1);
  });

  it("does not establish a channel when the socket closes while authorization is pending", async () => {
    const pair = createSocketPair();
    let release: (() => void) | null = null;
    let establishedCount = 0;
    const acceptor = acceptSealedChannel({
      socket: pair.server,
      identity: generateSigningKeyPair(),
      authorize: (request) =>
        new Promise((resolve) => {
          release = () => resolve({ status: "ok", deviceId: request.deviceId });
        }),
      onEstablished: () => {
        establishedCount += 1;
      },
    });
    pair.server.onMessage = (data) => void acceptor.onMessage(data);
    pair.server.onClose = (code, reason) => acceptor.onClose(code, reason);
    const connecting = SealedChannelClient.connect({
      socket: pair.client,
      device: localDeviceIdentity(generateSigningKeyPair()),
      deviceName: "Test",
      surface: "browser",
      verifyServerKey: () => "accept",
    });
    pair.server.open();
    await waitFor(() => release !== null);
    pair.client.close(1000, "gave up");
    await expect(connecting).rejects.toThrow();
    release!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(establishedCount).toBe(0);
    expect(acceptor.established).toBe(false);
  });

  it("reports pending and rejected outcomes without a usable client", async () => {
    for (const outcome of ["pending", "rejected"] as const) {
      const pair = createSocketPair();
      const acceptor = acceptSealedChannel({
        socket: pair.server,
        identity: generateSigningKeyPair(),
        authorize: async (request) =>
          outcome === "pending"
            ? { status: "pending", deviceId: request.deviceId }
            : {
                status: "rejected",
                deviceId: request.deviceId,
                reason: "revoked",
              },
        onEstablished: () => {
          throw new Error("must not establish");
        },
      });
      pair.server.onMessage = (data) => void acceptor.onMessage(data);
      const connecting = SealedChannelClient.connect({
        socket: pair.client,
        device: localDeviceIdentity(generateSigningKeyPair()),
        deviceName: "Test",
        surface: "desktop",
        verifyServerKey: () => "accept",
      });
      pair.server.open();
      const connection = await connecting;
      expect(connection.outcome.status).toBe(outcome);
      expect(connection.client).toBeNull();
    }
  });
});

describe("sealedFetch", () => {
  it("resolves relative redirects against the redirected URL", async () => {
    const harness = await connect();
    const pending = sealedFetch(
      harness.client,
      "https://sawyer.getbb.app/start",
      undefined,
      { origin: "https://sawyer.getbb.app" },
    );
    const opens = () =>
      harness.frames.filter((frame) => frame.type === "open-http");
    await waitFor(() => opens().length === 1);
    harness.reply({
      type: "resp-head",
      streamId: opens()[0]!.streamId,
      status: 302,
      headers: [["location", "/dir/page"]],
    });
    harness.reply({ type: "body-end", streamId: opens()[0]!.streamId });
    await waitFor(() => opens().length === 2);
    expect(opens()[1]).toMatchObject({ path: "/dir/page" });
    harness.reply({
      type: "resp-head",
      streamId: opens()[1]!.streamId,
      status: 302,
      headers: [["location", "next"]],
    });
    harness.reply({ type: "body-end", streamId: opens()[1]!.streamId });
    await waitFor(() => opens().length === 3);
    expect(opens()[2]).toMatchObject({ path: "/dir/next" });
    harness.reply({
      type: "resp-head",
      streamId: opens()[2]!.streamId,
      status: 200,
      headers: [["content-type", "text/plain"]],
    });
    harness.reply({ type: "body-end", streamId: opens()[2]!.streamId });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.url).toBe("https://sawyer.getbb.app/dir/next");
  });

  it("builds a standard Response and refuses cross-origin targets", async () => {
    const harness = await connect();
    const pending = sealedFetch(
      harness.client,
      "https://sawyer.getbb.app/api/v1/threads?limit=1",
      {
        method: "POST",
        body: JSON.stringify({ text: SECRET_REQUEST }),
        headers: { "content-type": "application/json" },
      },
      { origin: "https://sawyer.getbb.app" },
    );
    await waitFor(() =>
      harness.frames.some((frame) => frame.type === "body-end"),
    );
    const open = harness.frames.find((frame) => frame.type === "open-http")!;
    expect(open).toMatchObject({
      path: "/api/v1/threads?limit=1",
      method: "POST",
    });
    expect((open as { headers: [string, string][] }).headers).toContainEqual([
      "accept-encoding",
      "identity",
    ]);
    harness.reply({
      type: "resp-head",
      streamId: open.streamId,
      status: 201,
      headers: [
        ["content-type", "application/json"],
        ["content-length", "999"],
      ],
    });
    harness.reply({
      type: "body-chunk",
      streamId: open.streamId,
      data: new TextEncoder().encode('{"id":"thr_2"}'),
    });
    harness.reply({ type: "body-end", streamId: open.streamId });
    const response = await pending;
    expect(response.status).toBe(201);
    expect(response.headers.get("content-length")).toBeNull();
    expect(await response.json()).toEqual({ id: "thr_2" });

    await expect(
      sealedFetch(harness.client, "https://evil.example/x", undefined, {
        origin: "https://sawyer.getbb.app",
      }),
    ).rejects.toThrow("cross-origin");
  });
});
