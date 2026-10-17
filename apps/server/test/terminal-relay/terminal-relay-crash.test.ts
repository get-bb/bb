import { once } from "node:events";
import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  terminalServerMessageSchema,
  type TerminalServerMessage,
} from "@bb/server-contract";
import {
  startTerminalTestFixture,
  type TerminalTestFixture,
} from "../helpers/relay-test-server.js";

let fixture: TerminalTestFixture | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await fixture?.close();
  fixture = null;
});

async function openBrowser(sinceSeq: number) {
  if (!fixture) throw new Error("Missing test fixture");
  const url = new URL(
    `/ws/terminals/${fixture.terminal.id}?sinceSeq=${sinceSeq}&outputAcks=1`,
    fixture.server.baseUrl,
  );
  url.protocol = "ws:";
  const socket = new WebSocket(url, { origin: fixture.server.config.appUrl });
  sockets.push(socket);
  const messages: TerminalServerMessage[] = [];
  socket.on("message", (raw) =>
    messages.push(terminalServerMessageSchema.parse(JSON.parse(String(raw)))),
  );
  await once(socket, "open");
  await vi.waitFor(() =>
    expect(messages.some((message) => message.type === "attached")).toBe(true),
  );
  return { socket, messages };
}

describe("forked terminal relay crash recovery", () => {
  it("closes browsers, resumes replay and output, and backs off after three crashes", async () => {
    fixture = await startTerminalTestFixture(true);
    const { daemon, relay, terminal } = fixture;
    if (!relay) throw new Error("Relay missing");
    const browser = await openBrowser(0);
    expect(relay.handoffs.map(({ kind }) => kind)).toEqual([
      "daemon-data",
      "browser",
    ]);
    expect(
      relay.handoffs.every(
        ({ paused, dataListeners }) => paused && dataListeners === 0,
      ),
    ).toBe(true);
    browser.socket.send(
      JSON.stringify({
        type: "input",
        dataBase64: Buffer.from("a").toString("base64"),
      }),
    );
    await vi.waitFor(() =>
      expect(
        browser.messages.some((message) => message.type === "output"),
      ).toBe(true),
    );
    const firstOutput = browser.messages.find(
      (message) => message.type === "output",
    );
    if (firstOutput?.type !== "output") throw new Error("Missing first output");
    const lastSeq = firstOutput.chunk.seq;
    const sent = vi.spyOn(relay.supervisor, "send");
    const delays: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const previousReady = relay.readyAt.length;
      const killedAt = Date.now();
      process.kill(relay.relayPid, "SIGKILL");
      if (attempt === 0) await once(browser.socket, "close");
      await vi.waitFor(
        () => expect(relay.readyAt.length).toBe(previousReady + 1),
        { timeout: 8_000 },
      );
      expect(relay.supervisor.isReady()).toBe(true);
      delays.push(relay.readyAt[previousReady]! - killedAt);
      await daemon.reconnect();
      await vi.waitFor(() =>
        expect(
          daemon.received.some((message) => message.type === "terminal.attach"),
        ).toBe(true),
      );
      if (attempt === 0) {
        expect(sent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "terminal-state",
            terminalId: terminal.id,
          }),
        );
        const reconnected = await openBrowser(lastSeq + 1);
        const attached = reconnected.messages.find(
          (message) => message.type === "attached",
        );
        if (attached?.type !== "attached")
          throw new Error("Missing replay attach");
        expect(attached.replayStartSeq).toBeLessThanOrEqual(lastSeq + 1);
        reconnected.socket.send(
          JSON.stringify({
            type: "input",
            dataBase64: Buffer.from("b").toString("base64"),
          }),
        );
        await vi.waitFor(() =>
          expect(
            reconnected.messages.some(
              (message) =>
                message.type === "output" && message.chunk.seq > lastSeq,
            ),
          ).toBe(true),
        );
      }
    }
    expect(delays[0]).toBeGreaterThanOrEqual(200);
    expect(delays[1]).toBeGreaterThanOrEqual(400);
    expect(delays[2]).toBeGreaterThanOrEqual(800);
    expect(delays[0]).toBeLessThan(2_000);
    expect(delays[1]).toBeLessThan(2_500);
    expect(delays[2]).toBeLessThan(3_000);
  }, 60_000);
});
