import { WebSocket as NodeWebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  TUNNEL_PROTOCOL_QUERY_PARAM,
} from "@bb/tunnel-contract";
import {
  humanizeTransportError,
  ReconnectBackoff,
  TunnelSession,
  type ReconnectBackoffOptions,
  type StreamOriginResult,
} from "@bb/tunnel-client";
import type {
  HostDaemonConnectShares,
  HostDaemonConnectSharesTunnel,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";

export type ConnectTunnelState = "connected" | "reconnecting" | "offline";

export interface ConnectTunnelStatus {
  state: ConnectTunnelState;
  lastError: string | null;
  generation: number;
  ports: number[];
}

export type CreateTunnelWebSocket = (
  url: string,
  options: { headers: Record<string, string> },
) => NodeWebSocket;

export interface ConnectTunnelClientOptions {
  machineCredential?: string;
  logger: HostDaemonLogger;
  onStatusChange?: (status: ConnectTunnelStatus) => void;
  createWebSocket?: CreateTunnelWebSocket;
  reconnectBackoff?: ReconnectBackoffOptions;
}

export function buildMachineTunnelUrl(
  tunnel: HostDaemonConnectSharesTunnel,
): string {
  const url = new URL(`wss://${tunnel.label}.${tunnel.baseDomain}/__tunnel`);
  url.searchParams.set(TUNNEL_PROTOCOL_QUERY_PARAM, String(PROTOCOL_VERSION));
  return url.toString();
}

/**
 * Host-local connect primitive. The server decides the desired ports and
 * tunnel identity; this client only maintains the socket and proxies allowed
 * targets to this daemon's loopback interface.
 */
export class ConnectTunnelClient {
  private readonly createWebSocket: CreateTunnelWebSocket;
  private readonly backoff: ReconnectBackoff;
  private readonly machineCredential: string | undefined;
  private shares: HostDaemonConnectShares = {
    generation: 0,
    ports: [],
    tunnel: null,
  };
  private latestGeneration = -1;
  private ports = new Set<number>();
  private socket: NodeWebSocket | undefined;
  private session: TunnelSession | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private state: ConnectTunnelState = "offline";
  private lastError: string | null = null;
  private stopped = false;

  constructor(private readonly options: ConnectTunnelClientOptions) {
    this.createWebSocket =
      options.createWebSocket ??
      ((url, websocketOptions) =>
        new NodeWebSocket(url, { headers: websocketOptions.headers }));
    this.backoff = new ReconnectBackoff(options.reconnectBackoff);
    this.machineCredential =
      options.machineCredential?.trim().length === 0
        ? undefined
        : options.machineCredential;
  }

  status(): ConnectTunnelStatus {
    return {
      state: this.state,
      lastError: this.lastError,
      generation: this.shares.generation,
      ports: [...this.ports].sort((a, b) => a - b),
    };
  }

  /** Apply a pushed replacement only when it advances the host generation. */
  replaceShareSet(shares: HostDaemonConnectShares): boolean {
    if (shares.generation <= this.latestGeneration) {
      return false;
    }
    this.applyShareSet(shares);
    return true;
  }

  /**
   * Session-open state is authoritative across server restarts, whose in-memory
   * generations may restart below this daemon's last observed generation.
   * If plugins load after the daemon session opens, this initial set can be
   * empty; the later higher-generation websocket replacement converges it.
   */
  replaceAuthoritativeShareSet(shares: HostDaemonConnectShares): void {
    this.applyShareSet(shares);
  }

  shutdown(): void {
    this.stopped = true;
    this.goOffline();
  }

  private applyShareSet(shares: HostDaemonConnectShares): void {
    const previousTunnel = this.shares.tunnel;
    this.latestGeneration = shares.generation;
    this.shares = {
      generation: shares.generation,
      ports: [...shares.ports],
      tunnel: shares.tunnel === null ? null : { ...shares.tunnel },
    };
    this.ports = new Set(shares.ports);

    const tunnelChanged =
      previousTunnel?.label !== shares.tunnel?.label ||
      previousTunnel?.baseDomain !== shares.tunnel?.baseDomain;
    if (!this.shouldConnect()) {
      this.goOffline();
      return;
    }
    if (tunnelChanged) {
      this.stopCurrentConnection();
    }
    this.ensureConnected();
    this.publish();
  }

  private shouldConnect(): boolean {
    return (
      !this.stopped &&
      this.ports.size > 0 &&
      this.shares.tunnel !== null &&
      this.machineCredential !== undefined
    );
  }

  private ensureConnected(): void {
    if (!this.shouldConnect() || this.socket || this.reconnectTimer) {
      return;
    }
    this.openTunnel();
  }

  private openTunnel(): void {
    const tunnelIdentity = this.shares.tunnel;
    const credential = this.machineCredential;
    if (!this.shouldConnect() || tunnelIdentity === null || !credential) {
      return;
    }

    const tunnelUrl = buildMachineTunnelUrl(tunnelIdentity);
    this.state = "reconnecting";
    this.options.logger.info(
      { label: tunnelIdentity.label, ports: [...this.ports], tunnelUrl },
      "Machine tunnel connecting",
    );

    let socket: NodeWebSocket;
    try {
      socket = this.createWebSocket(tunnelUrl, {
        headers: { authorization: `Bearer ${credential}` },
      });
    } catch (error) {
      this.lastError = `cannot dial ${tunnelUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.options.logger.warn({ err: error, tunnelUrl }, this.lastError);
      this.scheduleReconnect(0);
      this.publish();
      return;
    }

    this.socket = socket;
    let connectedAt = 0;
    let socketSession: TunnelSession | undefined;
    socket.on("open", () => {
      if (this.socket !== socket || !this.shouldConnect()) {
        socket.terminate();
        return;
      }
      connectedAt = Date.now();
      this.state = "connected";
      this.lastError = null;
      socketSession = new TunnelSession({
        tunnel: socket,
        log: {
          warn: (message) =>
            this.options.logger.warn({ label: tunnelIdentity.label }, message),
        },
        resolveOrigin: (target) => this.resolveOrigin(target),
      });
      this.session = socketSession;
      socketSession.start();
      this.options.logger.info(
        { label: tunnelIdentity.label, ports: [...this.ports] },
        "Machine tunnel connected",
      );
      this.publish();
    });
    socket.on("unexpected-response", (_request, response) => {
      if (this.socket !== socket) {
        return;
      }
      this.lastError = `machine tunnel rejected: HTTP ${response.statusCode ?? 0}`;
      this.options.logger.warn(
        { label: tunnelIdentity.label, statusCode: response.statusCode ?? 0 },
        this.lastError,
      );
      this.publish();
    });
    socket.on("error", (error: Error) => {
      if (this.socket !== socket) {
        return;
      }
      this.lastError = humanizeTransportError(
        error,
        `${tunnelIdentity.label}.${tunnelIdentity.baseDomain}`,
      );
      this.publish();
    });
    socket.on("close", (code: number, reason: Buffer) => {
      socketSession?.dispose();
      if (this.session === socketSession) {
        this.session = undefined;
      }
      if (this.socket !== socket) {
        return;
      }
      this.socket = undefined;
      if (!this.shouldConnect()) {
        this.goOffline();
        return;
      }
      if (this.lastError === null) {
        this.lastError = `machine tunnel closed (code ${code}${
          reason.length > 0 ? `, ${reason.toString()}` : ""
        })`;
      }
      this.state = "reconnecting";
      this.scheduleReconnect(connectedAt === 0 ? 0 : Date.now() - connectedAt);
      this.publish();
    });
    this.publish();
  }

  private scheduleReconnect(connectedForMs: number): void {
    if (!this.shouldConnect() || this.reconnectTimer) {
      return;
    }
    const delay = this.backoff.nextDelayAfterClose(connectedForMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openTunnel();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private resolveOrigin(target: string | undefined): StreamOriginResult {
    if (target === undefined) {
      return { kind: "unregistered" };
    }
    const port = Number(target);
    const tunnel = this.shares.tunnel;
    if (!Number.isInteger(port) || !this.ports.has(port) || tunnel === null) {
      return { kind: "unregistered" };
    }
    return {
      kind: "ok",
      resolved: {
        origin: `http://127.0.0.1:${port}`,
        publicOrigin: `https://${tunnel.label}--${port}.${tunnel.baseDomain}`,
        host: `127.0.0.1:${port}`,
      },
    };
  }

  private goOffline(): void {
    this.stopCurrentConnection();
    this.state = "offline";
    this.lastError = null;
    this.backoff.reset();
    this.publish();
  }

  private stopCurrentConnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.session?.dispose();
    this.session = undefined;
    const socket = this.socket;
    this.socket = undefined;
    socket?.terminate();
  }

  private publish(): void {
    this.options.onStatusChange?.(this.status());
  }
}
