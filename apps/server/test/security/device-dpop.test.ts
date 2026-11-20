import {
  createDpopProof,
  createNodeDpopSigner,
  generateDpopPrivateJwk,
  type DpopSigner,
} from "@bb/sdk/node";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";

let server: RunningTestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

const LAN = { "x-forwarded-for": "192.168.1.20" };

async function mintCode(running: RunningTestServer): Promise<string> {
  const response = await fetch(`${running.baseUrl}/api/v1/access/pairings`, {
    method: "POST",
    headers: { authorization: running.localAuthorization },
  });
  const body: { code: string } = await response.json();
  return body.code;
}

async function pairDevice(
  running: RunningTestServer,
  signer: DpopSigner,
): Promise<{ accessToken: string; credentialId: string }> {
  const url = `${running.baseUrl}/api/v1/access/pairings/redeem`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...LAN,
      "content-type": "application/json",
      dpop: await createDpopProof({ signer, method: "POST", url }),
    },
    body: JSON.stringify({
      kind: "device",
      code: await mintCode(running),
      label: "test phone",
    }),
  });
  expect(response.status).toBe(200);
  const body: { accessToken: string; credential: { id: string } } =
    await response.json();
  return { accessToken: body.accessToken, credentialId: body.credential.id };
}

async function deviceGet(
  running: RunningTestServer,
  path: string,
  args: { token: string; signer: DpopSigner | null; proof?: string },
): Promise<Response> {
  const url = `${running.baseUrl}${path}`;
  const proof =
    args.proof ??
    (args.signer === null
      ? undefined
      : await createDpopProof({
          signer: args.signer,
          method: "GET",
          url,
          accessToken: args.token,
        }));
  return fetch(url, {
    headers: {
      ...LAN,
      authorization: `DPoP ${args.token}`,
      ...(proof === undefined ? {} : { dpop: proof }),
    },
  });
}

describe("device-bound tokens", () => {
  it("refuses a device sign-in without a proof and binds the token to the proving key", async () => {
    server = await startTestServer();
    const url = `${server.baseUrl}/api/v1/access/pairings/redeem`;
    const unproven = await fetch(url, {
      method: "POST",
      headers: { ...LAN, "content-type": "application/json" },
      body: JSON.stringify({
        kind: "device",
        code: await mintCode(server),
        label: "no key",
      }),
    });
    expect(unproven.status).toBe(401);
    expect(await unproven.json()).toMatchObject({ code: "invalid_dpop_proof" });

    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken } = await pairDevice(server, signer);
    expect(
      (
        await deviceGet(server, "/api/v1/projects", {
          token: accessToken,
          signer,
        })
      ).status,
    ).toBe(200);
  });

  it("makes a captured token useless without the device's key", async () => {
    server = await startTestServer();
    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const attacker = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken } = await pairDevice(server, signer);

    const asBearer = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: { ...LAN, authorization: `Bearer ${accessToken}` },
    });
    expect(asBearer.status).toBe(401);
    expect(await asBearer.json()).toMatchObject({ code: "invalid_dpop_proof" });

    for (const attempt of [
      { token: accessToken, signer: null },
      { token: accessToken, signer: attacker },
    ]) {
      const response = await deviceGet(server, "/api/v1/projects", attempt);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "invalid_dpop_proof",
      });
    }
  });

  it("refuses a replayed proof", async () => {
    server = await startTestServer();
    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken } = await pairDevice(server, signer);
    const proof = await createDpopProof({
      signer,
      method: "GET",
      url: `${server.baseUrl}/api/v1/projects`,
      accessToken,
    });
    const first = await deviceGet(server, "/api/v1/projects", {
      token: accessToken,
      signer,
      proof,
    });
    expect(first.status).toBe(200);
    const replay = await deviceGet(server, "/api/v1/projects", {
      token: accessToken,
      signer,
      proof,
    });
    expect(replay.status).toBe(401);
  });

  it("renews only with a proof from the same key", async () => {
    server = await startTestServer();
    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const attacker = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken } = await pairDevice(server, signer);
    const url = `${server.baseUrl}/api/v1/access/token`;
    const renewWith = async (proofSigner: DpopSigner) =>
      fetch(url, {
        method: "POST",
        headers: {
          ...LAN,
          authorization: `DPoP ${accessToken}`,
          dpop: await createDpopProof({
            signer: proofSigner,
            method: "POST",
            url,
          }),
        },
      });
    expect((await renewWith(attacker)).status).toBe(401);
    const renewed = await renewWith(signer);
    expect(renewed.status).toBe(200);
    const body: { accessToken: string; sessionExpiresAt: number } =
      await renewed.json();
    expect(body.accessToken).not.toBe(accessToken);
    expect(
      (
        await deviceGet(server, "/api/v1/projects", {
          token: body.accessToken,
          signer,
        })
      ).status,
    ).toBe(200);
  });

  it("opens /ws with a short ticket and a fresh proof, never with the ticket alone", async () => {
    server = await startTestServer();
    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken } = await pairDevice(server, signer);
    const ticketUrl = `${server.baseUrl}/api/v1/access/websocket-tickets`;
    const ticketResponse = await fetch(ticketUrl, {
      method: "POST",
      headers: {
        ...LAN,
        authorization: `DPoP ${accessToken}`,
        dpop: await createDpopProof({
          signer,
          method: "POST",
          url: ticketUrl,
          accessToken,
        }),
      },
    });
    const { ticket }: { ticket: string } = await ticketResponse.json();
    const wsUrl = `${server.baseUrl.replace(/^http/u, "ws")}/ws`;

    const statusOf = (query: string) =>
      new Promise<number>((resolve) => {
        const socket = new WebSocket(`${wsUrl}?${query}`, { headers: LAN });
        socket.once("open", () => {
          socket.close();
          resolve(101);
        });
        socket.once("unexpected-response", (_request, response) =>
          resolve(response.statusCode ?? 0),
        );
      });
    expect(await statusOf(`wsTicket=${encodeURIComponent(ticket)}`)).toBe(401);
    const proof = await createDpopProof({
      signer,
      method: "GET",
      url: wsUrl,
      accessToken: ticket,
    });
    expect(
      await statusOf(
        `wsTicket=${encodeURIComponent(ticket)}&dpop=${encodeURIComponent(proof)}`,
      ),
    ).toBe(101);
  });

  it("gives the device's WebView a short cookie that dies with the device", async () => {
    server = await startTestServer();
    const signer = createNodeDpopSigner(generateDpopPrivateJwk());
    const { accessToken, credentialId } = await pairDevice(server, signer);
    const url = `${server.baseUrl}/api/v1/access/device-browser-sessions`;
    const minted = await fetch(url, {
      method: "POST",
      headers: {
        ...LAN,
        authorization: `DPoP ${accessToken}`,
        dpop: await createDpopProof({
          signer,
          method: "POST",
          url,
          accessToken,
        }),
      },
    });
    expect(minted.status).toBe(200);
    const child: { token: string; cookieName: string; expiresAt: number } =
      await minted.json();
    expect(child.expiresAt - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    const cookie = `${child.cookieName}=${child.token}`;
    expect(
      (
        await fetch(`${server.baseUrl}/api/v1/projects`, {
          headers: { ...LAN, cookie },
        })
      ).status,
    ).toBe(200);

    const listed = await fetch(`${server.baseUrl}/api/v1/access/credentials`, {
      headers: { ...LAN, cookie },
    });
    const { credentials }: { credentials: { id: string; current: boolean }[] } =
      await listed.json();
    expect(credentials).toEqual([
      expect.objectContaining({ id: credentialId, current: true }),
    ]);

    await fetch(`${server.baseUrl}/api/v1/access/credentials/${credentialId}`, {
      method: "DELETE",
      headers: { authorization: server.localAuthorization },
    });
    expect(
      (
        await fetch(`${server.baseUrl}/api/v1/projects`, {
          headers: { ...LAN, cookie },
        })
      ).status,
    ).toBe(401);
  });
});
