import { connect } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  type RunningTestServer,
} from "../helpers/test-app.js";
import type { TerminalUpgradeGrant } from "../../src/ws/upgrade-dispatcher.js";

let server: RunningTestServer | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await server?.close();
  server = null;
});

function url(path: string): string {
  if (!server) throw new Error("Missing test server");
  return new URL(path, server.baseUrl).href.replace(/^http:/, "ws:");
}

function rejectedStatus(path: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url(path), { origin });
    sockets.push(socket);
    socket.once("open", () =>
      reject(new Error("Unexpected WebSocket upgrade")),
    );
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      if (response.statusCode) resolve(response.statusCode);
      else reject(new Error("Missing rejection status"));
    });
    socket.once("error", () => {});
  });
}

describe("terminal upgrade dispatch", () => {
  it("keeps node-ws on other paths and preserves browser origin and query rejection", async () => {
    server = await startTestServer(
      {},
      { dispatcher: true, onTerminalUpgrade: () => false },
    );
    const socket = new WebSocket(url("/ws"));
    sockets.push(socket);
    await once(socket, "open");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(
      await rejectedStatus("/ws/terminals/terminal-1", "https://evil.example"),
    ).toBe(403);
    expect(await rejectedStatus("/ws/terminals/terminal-1?sinceSeq=-1")).toBe(
      400,
    );
    expect(
      await rejectedStatus("/ws/terminals/terminal-1?sinceSeq=3&outputAcks=1"),
    ).toBe(503);
  });

  it("passes an authenticated grant and a copied non-empty upgrade head", async () => {
    let grant: TerminalUpgradeGrant | null = null;
    let head: Buffer | null = null;
    server = await startTestServer(
      {},
      {
        dispatcher: true,
        onTerminalUpgrade: (args) => {
          grant = args.grant;
          head = args.head;
          return false;
        },
      },
    );
    const port = Number(new URL(server.baseUrl).port);
    const socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    let resolveReply: (value: string) => void = () => {};
    const reply = new Promise<string>((resolve) => {
      resolveReply = resolve;
    });
    let data = "";
    socket.on("data", (chunk) => {
      data += chunk.toString();
      if (data.includes("\r\n\r\n")) resolveReply(data);
    });
    const key = Buffer.from("terminal-relay-key").toString("base64");
    socket.write(
      `GET /ws/terminals/terminal-1?sinceSeq=2&outputAcks=1 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\nextra-head`,
    );
    expect(await reply).toContain("503 Service Unavailable");
    expect(grant).toEqual({
      kind: "browser",
      terminalId: "terminal-1",
      sinceSeq: 2,
      outputAcks: true,
    });
    expect(head).toEqual(Buffer.from("extra-head"));
    socket.destroy();
  });
});
