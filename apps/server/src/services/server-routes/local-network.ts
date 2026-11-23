import { createSocket } from "node:dgram";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { isLoopbackHostname } from "@bb/config/loopback";
import type { ServerBindHost } from "@bb/config/server";
import type { ServerLogger } from "../../types.js";

export const LOCAL_NETWORK_RESCAN_INTERVAL_MS = 30_000;

export interface LocalNetworkState {
  bindHost: ServerBindHost;
  addresses: string[];
  urls: string[];
  listenerError: string | null;
}

type ReadInterfaces = () => NodeJS.Dict<NetworkInterfaceInfo[]>;

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  return octets.every(
    (octet, index) =>
      Number.isInteger(octet) &&
      octet >= 0 &&
      octet <= 255 &&
      String(octet) === parts[index],
  )
    ? octets
    : null;
}

export function isPrivateLanIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

export function detectLocalNetworkAddresses(
  readInterfaces: ReadInterfaces = networkInterfaces,
): string[] {
  const addresses = new Set<string>();
  for (const entries of Object.values(readInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isPrivateLanIpv4(entry.address)) addresses.add(entry.address);
    }
  }
  return [...addresses].sort();
}

const PRIMARY_ROUTE_PROBE_ADDRESS = "1.1.1.1";

export function findPrimaryIpv4Address(): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    const finish = (address: string | null) => {
      socket.close();
      resolve(address);
    };
    socket.once("error", () => finish(null));
    socket.connect(53, PRIMARY_ROUTE_PROBE_ADDRESS, () => {
      try {
        finish(socket.address().address);
      } catch {
        finish(null);
      }
    });
  });
}

function reachableAddresses(
  detected: readonly string[],
  primary: string | null,
): string[] {
  return primary !== null && detected.includes(primary)
    ? [primary]
    : [...detected];
}

export interface LocalNetworkAccessOptions {
  bindHost: ServerBindHost;
  port: number;
  logger: Pick<ServerLogger, "info" | "warn">;
  isEnabled(): boolean;
  readInterfaces?: ReadInterfaces;
  findPrimaryAddress?: () => Promise<string | null>;
}

interface LocalNetworkListener {
  server: Server;
  sockets: Set<Socket>;
}

function closeListener(listener: LocalNetworkListener): void {
  listener.server.close();
  for (const socket of listener.sockets) socket.destroy();
  listener.sockets.clear();
}

export class LocalNetworkAccess {
  private readonly listeners = new Map<string, LocalNetworkListener>();
  private readonly failures = new Map<string, string>();
  private target: Server | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private primary: string | null = null;

  constructor(private readonly options: LocalNetworkAccessOptions) {}

  private detect(): string[] {
    return reachableAddresses(
      detectLocalNetworkAddresses(this.options.readInterfaces),
      this.primary,
    );
  }

  private refreshPrimary(): void {
    const find = this.options.findPrimaryAddress ?? findPrimaryIpv4Address;
    void find().then((primary) => {
      if (primary === this.primary) return;
      this.primary = primary;
      this.reconcile();
    });
  }

  state(): LocalNetworkState {
    const enabled = this.options.isEnabled();
    const detected = this.detect();
    const addresses = !enabled
      ? []
      : !isLoopbackHostname(this.options.bindHost)
        ? detected
        : this.target === null
          ? []
          : detected.filter((address) => !this.failures.has(address));
    const errors = [...this.failures.values()];
    return {
      bindHost: this.options.bindHost,
      addresses,
      urls: addresses.map(
        (address) => `http://${address}:${String(this.options.port)}`,
      ),
      listenerError: enabled && errors.length > 0 ? errors.join("; ") : null,
    };
  }

  attach(target: Server): void {
    this.target = target;
    this.reconcile();
    this.refreshPrimary();
    this.timer = setInterval(() => {
      this.reconcile();
      this.refreshPrimary();
    }, LOCAL_NETWORK_RESCAN_INTERVAL_MS);
    this.timer.unref();
  }

  reconcile(): void {
    const target = this.target;
    if (target === null) return;
    const wanted = new Set(
      this.options.isEnabled() && isLoopbackHostname(this.options.bindHost)
        ? this.detect()
        : [],
    );
    for (const [address, listener] of this.listeners) {
      if (wanted.has(address)) continue;
      this.listeners.delete(address);
      closeListener(listener);
      this.options.logger.info({ address }, "Stopped local network listener");
    }
    for (const address of this.failures.keys()) {
      if (!wanted.has(address)) this.failures.delete(address);
    }
    for (const address of wanted) {
      if (this.listeners.has(address)) continue;
      this.listen(target, address);
    }
  }

  private listen(target: Server, address: string): void {
    const server = createServer();
    const listener: LocalNetworkListener = { server, sockets: new Set() };
    server.on("connection", (socket) => {
      listener.sockets.add(socket);
      socket.once("close", () => listener.sockets.delete(socket));
    });
    server.on("request", (request, response) => {
      target.emit("request", request, response);
    });
    server.on("upgrade", (request, socket, head) => {
      target.emit("upgrade", request, socket, head);
    });
    this.listeners.set(address, listener);
    server.once("error", (error) => {
      if (this.listeners.get(address) === listener) {
        this.listeners.delete(address);
      }
      const message = `${address}: ${error.message}`;
      this.failures.set(address, message);
      this.options.logger.warn(
        { address, error: error.message },
        "Could not listen on the local network address",
      );
    });
    server.listen(this.options.port, address, () => {
      this.failures.delete(address);
      this.options.logger.info(
        { address, port: this.options.port },
        "Listening on the local network address",
      );
    });
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.target = null;
    for (const listener of this.listeners.values()) closeListener(listener);
    this.listeners.clear();
    this.failures.clear();
  }
}

let current: LocalNetworkAccess | null = null;

export function setLocalNetworkAccess(value: LocalNetworkAccess | null): void {
  current = value;
}

export function localNetworkState(): LocalNetworkState {
  return (
    current?.state() ?? {
      bindHost: "127.0.0.1",
      addresses: [],
      urls: [],
      listenerError: null,
    }
  );
}

export function reconcileLocalNetworkAccess(): void {
  current?.reconcile();
}
