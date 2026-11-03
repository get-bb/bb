import { createHmac } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { expect, it, vi } from "vitest";
import { createDesktopBrowserBrokerClient } from "../src/desktop-browser-broker-client.js";
import type { DesktopBrowserBroker } from "../src/desktop-browser-broker.js";

it.each([
  {
    name: "same broker at an unrelated address",
    key: "a".repeat(64),
    accepted: true,
    timeout: false,
  },
  {
    name: "another server's broker",
    key: "b".repeat(64),
    accepted: false,
    timeout: false,
  },
  {
    name: "replayed proof for another challenge",
    key: null,
    accepted: false,
    timeout: false,
  },
  {
    name: "timed out broker",
    key: "a".repeat(64),
    accepted: false,
    timeout: true,
  },
])(
  "validates $name before registering",
  async ({ key, accepted, timeout }) => {
    const homeDir = await mkdtemp(join(tmpdir(), "bb-broker-alias-"));
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(server, "listening");
    const address = server.address();
    if (typeof address === "string" || address === null)
      throw new Error("No port");
    const directory = join(homeDir, ".bb-machines", "trusted.example");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "desktop-browser-broker.json"),
      JSON.stringify({
        version: 1,
        hostId: "host_m5",
        serverUrl: "https://trusted.example",
        url: `ws://127.0.0.1:${address.port}/desktop-browser`,
        token: "a".repeat(64),
      }),
      { mode: 0o600 },
    );
    const stalledDirectory = join(homeDir, ".bb-machines", "stalled.example");
    await mkdir(stalledDirectory, { recursive: true });
    await writeFile(
      join(stalledDirectory, "desktop-browser-broker.json"),
      JSON.stringify({
        version: 1,
        hostId: "host_stalled",
        serverUrl: "https://stalled.example",
        url: `ws://127.0.0.1:${address.port}/desktop-browser`,
        token: "b".repeat(64),
      }),
      { mode: 0o600 },
    );
    const stalledSignals: AbortSignal[] = [];
    let markStalled = () => {};
    const stalledStarted = new Promise<void>((resolve) => {
      markStalled = resolve;
    });
    async function stall(init?: RequestInit): Promise<Response> {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing cancellation signal");
      stalledSignals.push(signal);
      markStalled();
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
      });
    }
    const messages: unknown[] = [];
    server.on("connection", (socket) =>
      socket.on("message", (data) =>
        messages.push(JSON.parse(data.toString())),
      ),
    );
    const broker = {
      setHostId: vi.fn(),
      setServerOrigin: vi.fn(),
      listInstances: () => [],
      subscribeInstances: () => () => undefined,
      subscribe: () => () => undefined,
    } as unknown as DesktopBrowserBroker;
    const challenges: string[] = [];
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.hostId === "host_stalled") return stall(init);
        await stalledStarted;
        if (timeout) return stall(init);
        challenges.push(body.challenge);
        return Response.json({
          proof: createHmac("sha256", key ?? "a".repeat(64))
            .update(
              `bb-desktop-broker:${key === null ? "0".repeat(64) : body.challenge}`,
            )
            .digest("hex"),
        });
      },
    );
    const client = createDesktopBrowserBrokerClient({
      broker,
      homeDir,
      dataDir: join(homeDir, ".bb"),
      getServerUrl: () => "https://unrelated-address.example",
      fetchImpl,
    });
    try {
      if (!accepted) {
        await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
        if (timeout) {
          await vi.waitFor(
            () => {
              expect(stalledSignals.length).toBeGreaterThan(0);
              expect(stalledSignals.every((signal) => signal.aborted)).toBe(
                true,
              );
            },
            { timeout: 7000 },
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(messages).toEqual([]);
        expect(broker.setHostId).not.toHaveBeenCalledWith("host_m5");
        fetchImpl.mockImplementation(async (_input, init) => {
          const body = JSON.parse(String(init?.body));
          if (body.hostId === "host_stalled") return stall(init);
          await stalledStarted;
          challenges.push(body.challenge);
          return Response.json({
            proof: createHmac("sha256", "a".repeat(64))
              .update(`bb-desktop-broker:${body.challenge}`)
              .digest("hex"),
          });
        });
        client.suspend();
        expect(stalledSignals.every((signal) => signal.aborted)).toBe(true);
        client.reconnect();
      }
      await vi.waitFor(() =>
        expect(messages).toEqual([
          {
            type: "register",
            hostId: "host_m5",
            serverUrl: "https://trusted.example",
            instances: [],
          },
        ]),
      );
      expect(broker.setHostId).toHaveBeenCalledWith("host_m5");
      expect(new Set(challenges).size).toBe(challenges.length);
      expect(stalledSignals.length).toBeGreaterThan(0);
      expect(stalledSignals.every((signal) => signal.aborted)).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://unrelated-address.example/api/v1/desktop-browsers/broker-proof",
        expect.objectContaining({ redirect: "error", credentials: "include" }),
      );
    } finally {
      client.stop();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(homeDir, { recursive: true, force: true });
    }
  },
  10000,
);

async function writeDescriptor(
  homeDir: string,
  serverHost: string,
  port: number,
) {
  const directory = join(homeDir, ".bb-machines", serverHost);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "desktop-browser-broker.json"),
    JSON.stringify({
      version: 1,
      hostId: "host_m5",
      serverUrl: `https://${serverHost}`,
      url: `ws://127.0.0.1:${port}/desktop-browser`,
      token: "a".repeat(64),
    }),
    { mode: 0o600 },
  );
}

function stubBroker() {
  return {
    setHostId: vi.fn(),
    setServerOrigin: vi.fn(),
    listInstances: () => [],
    subscribeInstances: () => () => undefined,
    subscribe: () => () => undefined,
  } as unknown as DesktopBrowserBroker;
}

it("registers a broker enrolled at the selected address without a server proof", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "bb-broker-same-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || address === null)
    throw new Error("No port");
  await writeDescriptor(homeDir, "trusted.example", address.port);
  const messages: unknown[] = [];
  server.on("connection", (socket) =>
    socket.on("message", (data) => messages.push(JSON.parse(data.toString()))),
  );
  const fetchImpl = vi.fn(async () => new Response(null, { status: 409 }));
  const client = createDesktopBrowserBrokerClient({
    broker: stubBroker(),
    homeDir,
    dataDir: join(homeDir, ".bb"),
    getServerUrl: () => "https://trusted.example",
    fetchImpl,
  });
  try {
    await vi.waitFor(() =>
      expect(messages).toEqual([
        expect.objectContaining({ type: "register", hostId: "host_m5" }),
      ]),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    client.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(homeDir, { recursive: true, force: true });
  }
});

it("backs off proof requests while no broker can be verified", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "bb-broker-backoff-"));
  await writeDescriptor(homeDir, "trusted.example", 9);
  const fetchImpl = vi.fn(async () => new Response(null, { status: 409 }));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const client = createDesktopBrowserBrokerClient({
    broker: stubBroker(),
    homeDir,
    dataDir: join(homeDir, ".bb"),
    getServerUrl: () => "https://unrelated-address.example",
    fetchImpl,
  });
  try {
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    for (const [delay, calls] of [
      [2000, 2],
      [4000, 3],
      [8000, 4],
    ] as const) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetchImpl).toHaveBeenCalledTimes(calls - 1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(calls));
    }
  } finally {
    client.stop();
    vi.useRealTimers();
    await rm(homeDir, { recursive: true, force: true });
  }
});
