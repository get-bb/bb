import { describe, expect, it } from "vitest";
import { generateSigningKeyPair, keyFingerprint } from "../src/crypto.js";
import {
  ClientHandshake,
  SealedProtocolError,
  ServerHandshake,
  createDelegation,
  deviceCodeAck,
  verifyDelegation,
  verifyDeviceCodeProof,
  type DeviceIdentity,
} from "../src/protocol.js";
import { localDeviceIdentity } from "../src/index.js";

function device(): {
  identity: DeviceIdentity;
  pair: ReturnType<typeof generateSigningKeyPair>;
} {
  const pair = generateSigningKeyPair();
  return { identity: localDeviceIdentity(pair), pair };
}

async function runHandshake(args: {
  server: ReturnType<typeof generateSigningKeyPair>;
  client: DeviceIdentity;
  tamperServerHello?: (bytes: Uint8Array) => Uint8Array;
}) {
  const serverHandshake = new ServerHandshake(args.server);
  const clientHandshake = new ClientHandshake({
    device: args.client,
    deviceName: "Test browser",
    surface: "browser",
  });
  const clientHello = clientHandshake.start();
  let serverHello = serverHandshake.onClientHello(clientHello);
  if (args.tamperServerHello) serverHello = args.tamperServerHello(serverHello);
  const identity = clientHandshake.onServerHello(serverHello);
  const clientAuth = await clientHandshake.createClientAuth();
  const request = serverHandshake.onClientAuth(clientAuth);
  return { serverHandshake, clientHandshake, identity, request };
}

describe("sealed handshake", () => {
  it("authenticates the server identity and the device, then agrees on traffic keys", async () => {
    const server = generateSigningKeyPair();
    const client = device();
    const { serverHandshake, clientHandshake, identity, request } =
      await runHandshake({
        server,
        client: client.identity,
      });
    expect(identity.publicKey).toEqual(server.publicKey);
    expect(request.device.publicKey).toEqual(client.pair.publicKey);
    expect(request.device.surface).toBe("browser");
    expect(request.proof).toBeNull();

    const serverResult = serverHandshake.createServerResult({
      status: "ok",
      deviceId: request.deviceId,
    });
    const clientResult = clientHandshake.onServerResult(serverResult.message);
    expect(clientResult.outcome).toEqual({
      status: "ok",
      deviceId: request.deviceId,
    });

    const plaintext = new TextEncoder().encode("secret thread title");
    const sealed = clientResult.session!.seal(plaintext);
    expect(serverResult.session!.open(sealed)).toEqual(plaintext);
    const reply = serverResult.session!.seal(new TextEncoder().encode("reply"));
    expect(new TextDecoder().decode(clientResult.session!.open(reply))).toBe(
      "reply",
    );
  });

  it("returns no session when the device is pending or rejected", async () => {
    const server = generateSigningKeyPair();
    const { serverHandshake, clientHandshake, request } = await runHandshake({
      server,
      client: device().identity,
    });
    const pending = serverHandshake.createServerResult({
      status: "pending",
      deviceId: request.deviceId,
    });
    expect(pending.session).toBeNull();
    const parsed = clientHandshake.onServerResult(pending.message);
    expect(parsed.outcome.status).toBe("pending");
    expect(parsed.session).toBeNull();
  });

  it("refuses a server result that names a device other than its own", async () => {
    const server = generateSigningKeyPair();
    const { serverHandshake, clientHandshake } = await runHandshake({
      server,
      client: device().identity,
    });
    const foreign = serverHandshake.createServerResult({
      status: "pending",
      deviceId: "dev_relay",
    });
    expect(() => clientHandshake.onServerResult(foreign.message)).toThrow(
      "names a different device",
    );
  });

  it("detects a relay that substitutes the server identity", async () => {
    const realServer = generateSigningKeyPair();
    const client = device();
    const relay = generateSigningKeyPair();
    const clientHandshake = new ClientHandshake({
      device: client.identity,
      deviceName: "Phone",
      surface: "mobile",
    });
    const clientHello = clientHandshake.start();
    const relayHandshake = new ServerHandshake(relay);
    const relayHello = relayHandshake.onClientHello(clientHello);
    const identity = clientHandshake.onServerHello(relayHello);
    expect(identity.publicKey).not.toEqual(realServer.publicKey);
    expect(keyFingerprint(identity.publicKey)).not.toBe(
      keyFingerprint(realServer.publicKey),
    );
  });

  it("rejects a server hello whose ciphertext was altered in flight", async () => {
    const server = generateSigningKeyPair();
    await expect(
      runHandshake({
        server,
        client: device().identity,
        tamperServerHello: (bytes) => {
          const copy = bytes.slice();
          copy[copy.length - 1] ^= 0x01;
          return copy;
        },
      }),
    ).rejects.toThrow(SealedProtocolError);
  });

  it("rejects a device whose signature was produced by a different key", async () => {
    const server = generateSigningKeyPair();
    const honest = device();
    const impostor = generateSigningKeyPair();
    const forged: DeviceIdentity = {
      publicKey: honest.pair.publicKey,
      signClientAuth: async (transcript) =>
        localDeviceIdentity(impostor).signClientAuth(transcript),
    };
    await expect(runHandshake({ server, client: forged })).rejects.toThrow(
      "device signature invalid",
    );
  });

  it("refuses data messages that are replayed or reordered", async () => {
    const server = generateSigningKeyPair();
    const { serverHandshake, clientHandshake, request } = await runHandshake({
      server,
      client: device().identity,
    });
    const serverResult = serverHandshake.createServerResult({
      status: "ok",
      deviceId: request.deviceId,
    });
    const { session } = clientHandshake.onServerResult(serverResult.message);
    const first = session!.seal(new Uint8Array([1]));
    const second = session!.seal(new Uint8Array([2]));
    expect(serverResult.session!.open(first)).toEqual(new Uint8Array([1]));
    expect(() => serverResult.session!.open(first)).toThrow("out of order");
    expect(serverResult.session!.open(second)).toEqual(new Uint8Array([2]));
  });

  it("verifies delegations signed by an enrolled parent device for one server only", async () => {
    const parent = device();
    const child = device();
    const server = generateSigningKeyPair();
    const otherServer = generateSigningKeyPair();
    const expiresAt = Date.now() + 60_000;
    const delegation = await createDelegation(
      parent.identity,
      child.pair.publicKey,
      expiresAt,
      server.publicKey,
    );
    const now = Date.now();
    expect(
      verifyDelegation(delegation, child.pair.publicKey, server.publicKey, now),
    ).toBe(true);
    expect(
      verifyDelegation(
        delegation,
        child.pair.publicKey,
        otherServer.publicKey,
        now,
      ),
    ).toBe(false);
    expect(
      verifyDelegation(
        delegation,
        parent.pair.publicKey,
        server.publicKey,
        now,
      ),
    ).toBe(false);
    expect(
      verifyDelegation(
        delegation,
        child.pair.publicKey,
        server.publicKey,
        expiresAt + 1,
      ),
    ).toBe(false);
    expect(
      verifyDelegation(
        { ...delegation, expiresAt: expiresAt + 1 },
        child.pair.publicKey,
        server.publicKey,
        now,
      ),
    ).toBe(false);
  });

  it("proves a device code both ways without sending it, and refuses a server that lacks it", async () => {
    const server = generateSigningKeyPair();
    const client = device();
    const code = "ABCD-EFGH-JKLM";
    const run = async (serverKnowsCode: boolean) => {
      const serverHandshake = new ServerHandshake(server);
      const clientHandshake = new ClientHandshake({
        device: client.identity,
        deviceName: "Laptop",
        surface: "browser",
        deviceCode: "abcd efgh jklm",
      });
      const serverHello = serverHandshake.onClientHello(
        clientHandshake.start(),
      );
      clientHandshake.onServerHello(serverHello);
      const request = serverHandshake.onClientAuth(
        await clientHandshake.createClientAuth(),
      );
      if (request.proof?.kind !== "device-code")
        throw new Error("expected code proof");
      expect(
        verifyDeviceCodeProof(code, request.proof, request.transcript),
      ).toBe(true);
      expect(
        verifyDeviceCodeProof(
          "ZZZZ-ZZZZ-ZZZZ",
          request.proof,
          request.transcript,
        ),
      ).toBe(false);
      const result = serverHandshake.createServerResult({
        status: "ok",
        deviceId: request.deviceId,
        ...(serverKnowsCode
          ? { codeAck: deviceCodeAck(code, request.transcript) }
          : {}),
      });
      return clientHandshake.onServerResult(result.message);
    };
    expect((await run(true)).outcome.status).toBe("ok");
    await expect(run(false)).rejects.toThrow(
      "did not prove knowledge of the device code",
    );
  });
});
