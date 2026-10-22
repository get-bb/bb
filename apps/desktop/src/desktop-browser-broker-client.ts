import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { WebSocket } from "ws";
import {
  DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE,
  desktopBrowserBrokerProofSchema,
  desktopBrowserBrokerDescriptorSchema,
  desktopBrowserBrokerRequestSchema,
  desktopBrowserResultSchemas,
} from "@bb/host-daemon-contract";
import type { DesktopBrowserBroker } from "./desktop-browser-broker.js";

export function isTrustedBrokerDescriptorFile(args: {
  isFile: boolean;
  mode: number;
  ownerUid: number;
  platform: NodeJS.Platform;
  processUid: number | undefined;
  size: number;
}): boolean {
  if (!args.isFile || args.size > 16384) {
    return false;
  }
  if (args.platform === "win32") {
    return true;
  }
  return (
    (args.mode & 0o077) === 0 &&
    (args.processUid === undefined || args.ownerUid === args.processUid)
  );
}

async function readBrokerDescriptor(dataDir: string) {
  const file = await open(
    join(dataDir, DESKTOP_BROWSER_BROKER_DESCRIPTOR_FILE),
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await file.stat();
    if (
      !isTrustedBrokerDescriptorFile({
        isFile: stat.isFile(),
        mode: stat.mode,
        ownerUid: stat.uid,
        platform: process.platform,
        processUid: process.getuid?.(),
        size: stat.size,
      })
    )
      throw new Error("Invalid desktop broker descriptor permissions");
    return desktopBrowserBrokerDescriptorSchema.parse(
      JSON.parse(await file.readFile("utf8")),
    );
  } finally {
    await file.close();
  }
}

async function readServerBrokerDescriptor(args: {
  dataDir: string;
  homeDir: string;
  serverOrigin: string;
  fetchImpl: typeof fetch;
  signal: AbortSignal;
}) {
  const serverHost = new URL(args.serverOrigin).host.replace(
    /[^a-zA-Z0-9.-]/gu,
    "-",
  );
  const dataDirs = new Set([
    args.dataDir,
    join(args.homeDir, ".bb-machines", serverHost),
  ]);
  for (const dataDir of dataDirs) {
    const descriptor = await readBrokerDescriptor(dataDir).catch(() => null);
    if (
      descriptor !== null &&
      new URL(descriptor.serverUrl).origin === args.serverOrigin
    )
      return descriptor;
  }
  const machinesDir = join(args.homeDir, ".bb-machines");
  const entries = await readdir(machinesDir, { withFileTypes: true }).catch(
    () => [],
  );
  const candidates = new Set([
    ...dataDirs,
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(machinesDir, entry.name)),
  ]);
  const controller = new AbortController();
  const signal = AbortSignal.any([
    args.signal,
    controller.signal,
    AbortSignal.timeout(6000),
  ]);
  try {
    return await Promise.any(
      [...candidates].map(async (dataDir) => {
        signal.throwIfAborted();
        const descriptor = await readBrokerDescriptor(dataDir);
        signal.throwIfAborted();
        const challenge = randomBytes(32).toString("hex");
        const response = await args.fetchImpl(
          `${args.serverOrigin}/api/v1/desktop-browsers/broker-proof`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hostId: descriptor.hostId, challenge }),
            credentials: "include",
            redirect: "error",
            signal,
          },
        );
        if (!response.ok) throw new Error("Desktop broker proof unavailable");
        const { proof } = desktopBrowserBrokerProofSchema.parse(
          await response.json(),
        );
        signal.throwIfAborted();
        const expected = createHmac("sha256", descriptor.token)
          .update(`bb-desktop-broker:${challenge}`)
          .digest();
        if (!timingSafeEqual(expected, Buffer.from(proof, "hex")))
          throw new Error("Invalid desktop broker proof");
        return descriptor;
      }),
    );
  } finally {
    controller.abort();
  }
}

export function createDesktopBrowserBrokerClient(args: {
  broker: DesktopBrowserBroker;
  dataDir: string;
  homeDir: string;
  getServerUrl(): string;
  fetchImpl?: typeof fetch;
}) {
  let socket: WebSocket | null = null;
  let lookup: AbortController | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let stopped = false;
  let generation = 0;
  let serverUrl: string | null = args.getServerUrl();

  function disconnect(): void {
    if (retry !== null) clearTimeout(retry);
    retry = null;
    generation += 1;
    lookup?.abort();
    lookup = null;
    const previous = socket;
    socket = null;
    previous?.terminate();
    args.broker.setHostId(null);
  }

  function schedule(): void {
    if (stopped || serverUrl === null || retry !== null) return;
    const delay = Math.min(2000 * 2 ** failures, 60_000);
    failures += 1;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, delay);
    retry.unref();
  }

  async function connect(): Promise<void> {
    if (stopped || serverUrl === null || socket !== null || lookup !== null)
      return;
    const currentGeneration = generation;
    const controller = new AbortController();
    lookup = controller;
    try {
      const serverOrigin = new URL(serverUrl).origin;
      args.broker.setServerOrigin(serverOrigin);
      const descriptor = await readServerBrokerDescriptor({
        dataDir: args.dataDir,
        homeDir: args.homeDir,
        serverOrigin,
        fetchImpl: args.fetchImpl ?? fetch,
        signal: controller.signal,
      });
      if (stopped || generation !== currentGeneration) return;
      const connection = new WebSocket(descriptor.url, {
        headers: { authorization: `Bearer ${descriptor.token}` },
        maxPayload: 1024 * 1024,
        handshakeTimeout: 5000,
      });
      socket = connection;
      const sendRegistration = () => {
        if (connection.readyState !== WebSocket.OPEN) return;
        connection.send(
          JSON.stringify({
            type: "register",
            hostId: descriptor.hostId,
            serverUrl: descriptor.serverUrl,
            instances: args.broker.listInstances(),
          }),
        );
      };
      const offInstances = args.broker.subscribeInstances(sendRegistration);
      const offChanged = args.broker.subscribe((event) => {
        if (connection.readyState === WebSocket.OPEN)
          connection.send(JSON.stringify(event));
      });
      let requests = Promise.resolve();
      let pending = 0;
      connection.on("open", () => {
        if (stopped || generation !== currentGeneration) {
          connection.terminate();
          return;
        }
        failures = 0;
        sendRegistration();
        args.broker.setHostId(descriptor.hostId);
      });
      connection.on("message", (data, binary) => {
        let request;
        try {
          if (binary) throw new Error("Expected a JSON broker request");
          request = desktopBrowserBrokerRequestSchema.parse(
            JSON.parse(data.toString()),
          );
        } catch {
          connection.terminate();
          return;
        }
        if (++pending > 64) {
          connection.terminate();
          return;
        }
        const parsed = request;
        requests = requests.then(async () => {
          if (connection.readyState !== WebSocket.OPEN) return;
          try {
            const result = desktopBrowserResultSchemas[
              parsed.command.type
            ].parse(await args.broker.execute(parsed.command));
            if (connection.readyState === WebSocket.OPEN)
              connection.send(
                JSON.stringify({
                  type: "result",
                  requestId: parsed.requestId,
                  result,
                }),
              );
          } catch (error) {
            if (connection.readyState === WebSocket.OPEN)
              connection.send(
                JSON.stringify({
                  type: "error",
                  requestId: parsed.requestId,
                  message:
                    error instanceof Error
                      ? error.message.slice(0, 8192)
                      : "Desktop browser operation failed",
                }),
              );
          } finally {
            pending -= 1;
          }
        });
      });
      connection.on("error", () => connection.terminate());
      connection.on("close", () => {
        offInstances();
        offChanged();
        if (socket !== connection) return;
        socket = null;
        args.broker.setHostId(null);
        schedule();
      });
    } catch {
      if (generation === currentGeneration) schedule();
    } finally {
      if (lookup === controller) lookup = null;
    }
  }

  void connect();
  return {
    suspend() {
      serverUrl = null;
      disconnect();
    },
    reconnect() {
      serverUrl = args.getServerUrl();
      failures = 0;
      disconnect();
      void connect();
    },
    stop() {
      stopped = true;
      disconnect();
    },
  };
}
