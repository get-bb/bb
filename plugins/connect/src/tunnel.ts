import { WebSocket as NodeWebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  TUNNEL_PROTOCOL_QUERY_PARAM,
} from "@bb/tunnel-contract";
import {
  humanizeTransportError,
  ReconnectBackoff,
  TunnelSession,
  type StreamOriginResult,
} from "@bb/tunnel-client";
import type { PluginLogger } from "@get-bb/plugin-sdk";
import { deriveConnectBaseUrl } from "@bb/connect-client";
import { AccountUnavailableError, type Account } from "./account-client.js";
import { NotSignedInError, type TunnelTicket } from "./hosted.js";
import {
  ShareRegistry,
  shareLoopbackHost,
  shareLoopbackOrigin,
  sharePublicUrl,
  type ShareRemoval,
} from "./shares.js";
import type { ShareHost } from "./hosts.js";
import type { ConnectStateName, ConnectStatus, ShareListing } from "./types.js";

const TUNNEL_HANDSHAKE_TIMEOUT_MS = 15_000;

export interface ConnectIdentity {
  serverId: string;
  serverUrl: string;
  handle: string;
  baseUrl: string;
}

interface ConnectTunnelOptions {
  shares: ShareRegistry;
  mintTicket: () => Promise<TunnelTicket>;
  defaultBaseUrl: string;
  enabled: boolean;
  getLoopbackBaseUrl: () => string;
  log: PluginLogger;
  onStatusChange?: (status: ConnectStatus) => void;
}

function identityOf(account: Account | null): ConnectIdentity | null {
  if (account === null) return null;
  return {
    serverId: account.serverId,
    serverUrl: account.serverUrl.replace(/\/$/u, ""),
    handle: account.serverLabel,
    baseUrl: account.baseUrl,
  };
}

function sameIdentity(
  left: ConnectIdentity | null,
  right: ConnectIdentity | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.serverId === right.serverId &&
    left.serverUrl === right.serverUrl &&
    left.handle === right.handle &&
    left.baseUrl === right.baseUrl
  );
}

export class ConnectTunnel {
  private identity: ConnectIdentity | null = null;
  private enabled: boolean;
  private tunnel: NodeWebSocket | undefined;
  private session: TunnelSession | undefined;
  private connected = false;
  private pairing = false;
  private lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly backoff = new ReconnectBackoff();
  private stopped = true;
  private dialEpoch = 0;
  private lastState: ConnectStateName = "disconnected";
  private stateSince = Date.now();
  private lastRemoteActivityAt: number | null = null;
  private remoteClients = 0;
  private nextRetryAt: number | null = null;
  private shareRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private shareActivationEpoch = 0;

  constructor(private readonly options: ConnectTunnelOptions) {
    this.enabled = options.enabled;
  }

  getIdentity(): ConnectIdentity | null {
    return this.identity;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.openTunnel();
    this.startShareActivation();
    this.publish();
  }

  setAccount(account: Account | null): void {
    const next = identityOf(account);
    if (sameIdentity(this.identity, next)) return;
    const running = !this.stopped;
    this.teardown();
    this.options.shares.clearMachineDeclarations();
    this.identity = next;
    this.lastError = null;
    if (running) {
      this.stopped = false;
      this.openTunnel();
      this.startShareActivation();
    }
    this.publish();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    const running = !this.stopped;
    this.teardown();
    if (!enabled) this.options.shares.clearMachineDeclarations();
    this.lastError = null;
    if (running) {
      this.stopped = false;
      this.openTunnel();
      this.startShareActivation();
    }
    this.publish();
  }

  async signIn(work: () => Promise<Account | null>): Promise<ConnectStatus> {
    this.pairing = true;
    this.publish();
    try {
      this.setAccount(await work());
    } finally {
      this.pairing = false;
      this.publish();
    }
    return this.status();
  }

  async expose(port: number, host: ShareHost): Promise<ShareListing> {
    const listing = await this.options.shares.add(port, host);
    this.publish();
    return listing;
  }

  async unexpose(
    port: number,
    hostSelector: string,
  ): Promise<ShareRemoval & { port: number }> {
    const result = await this.options.shares.remove(port, hostSelector);
    this.publish();
    return { ...result, port };
  }

  async listShares(hostId?: string): Promise<ShareListing[]> {
    return this.options.shares.list(hostId);
  }

  status(): ConnectStatus {
    return this.statusWithShares(this.options.shares.snapshot());
  }

  async refreshStatus(): Promise<ConnectStatus> {
    return this.statusWithShares(await this.listShares());
  }

  stop(): void {
    this.teardown();
    this.publish();
  }

  private statusWithShares(shares: ConnectStatus["shares"]): ConnectStatus {
    const state = this.computeState();
    return {
      state,
      paired: this.identity !== null,
      enabled: this.enabled,
      handle: this.identity?.handle ?? null,
      url: this.identity?.serverUrl ?? null,
      dashboardUrl: this.dashboardUrl(),
      lastError: this.lastError,
      nextRetryAt: state === "reconnecting" ? this.nextRetryAt : null,
      since: this.stateSince,
      remoteClients: this.remoteClients,
      lastRemoteActivityAt: this.lastRemoteActivityAt,
      shares,
    };
  }

  private dashboardUrl(): string {
    const base = this.identity?.baseUrl ?? this.options.defaultBaseUrl;
    return `${base.replace(/\/$/u, "")}/dashboard`;
  }

  private computeState(): ConnectStateName {
    if (this.pairing) return "pairing";
    if (this.identity === null || !this.enabled) return "disconnected";
    return this.connected ? "connected" : "reconnecting";
  }

  private publish(): void {
    const state = this.computeState();
    if (state !== this.lastState) {
      this.lastState = state;
      this.stateSince = Date.now();
    }
    this.options.onStatusChange?.(this.status());
  }

  private teardown(): void {
    this.shareActivationEpoch += 1;
    this.dialEpoch += 1;
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.shareRetryTimer) {
      clearTimeout(this.shareRetryTimer);
      this.shareRetryTimer = undefined;
    }
    this.session?.dispose();
    this.session = undefined;
    this.remoteClients = 0;
    this.tunnel?.terminate();
    this.tunnel = undefined;
    this.connected = false;
    this.backoff.reset();
    this.nextRetryAt = null;
  }

  private startShareActivation(): void {
    const epoch = ++this.shareActivationEpoch;
    void this.activateShares(epoch);
  }

  private isShareActivationCurrent(epoch: number): boolean {
    return !this.stopped && epoch === this.shareActivationEpoch;
  }

  private async activateShares(epoch: number): Promise<void> {
    try {
      await this.options.shares.load();
      if (!this.isShareActivationCurrent(epoch)) return;
      if (this.enabled) {
        await this.options.shares.declareMachineShares(() =>
          this.isShareActivationCurrent(epoch),
        );
        if (!this.isShareActivationCurrent(epoch)) return;
      }
      if (this.identity !== null) {
        await this.options.shares.list();
        if (!this.isShareActivationCurrent(epoch)) return;
      }
      this.publish();
    } catch (error) {
      this.options.log.warn(
        `shared-port activation failed; retrying: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (
        this.identity !== null &&
        this.isShareActivationCurrent(epoch) &&
        this.shareRetryTimer === undefined
      ) {
        this.shareRetryTimer = setTimeout(() => {
          this.shareRetryTimer = undefined;
          this.startShareActivation();
        }, 5_000);
      }
    }
  }

  private resolveStreamOrigin(target: string | undefined): StreamOriginResult {
    if (target === undefined) {
      return {
        kind: "ok",
        resolved: {
          origin: this.options.getLoopbackBaseUrl().replace(/\/$/, ""),
          publicOrigin: this.identity
            ? new URL(this.identity.serverUrl).origin
            : this.options.getLoopbackBaseUrl(),
        },
      };
    }
    const port = Number(target);
    if (!Number.isInteger(port) || !this.options.shares.hasServerPort(port)) {
      return { kind: "unregistered" };
    }
    const identity = this.identity;
    if (identity === null) {
      return { kind: "unregistered" };
    }
    return {
      kind: "ok",
      resolved: {
        origin: shareLoopbackOrigin(port),
        publicOrigin: new URL(sharePublicUrl(identity, port)).origin,
        host: shareLoopbackHost(port),
      },
    };
  }

  private isCurrentDial(epoch: number): boolean {
    return !this.stopped && epoch === this.dialEpoch;
  }

  private scheduleRetry(epoch: number, detail: string, stableMs: number): void {
    if (!this.isCurrentDial(epoch) || this.reconnectTimer !== undefined) return;
    this.connected = false;
    this.session?.dispose();
    this.session = undefined;
    this.remoteClients = 0;
    const delay = this.backoff.nextDelayAfterClose(stableMs);
    this.nextRetryAt = Date.now() + delay;
    this.options.log.warn(`${detail}; reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.isCurrentDial(epoch)) return;
      this.nextRetryAt = null;
      this.publish();
      this.openTunnel();
    }, delay);
    this.publish();
  }

  private openTunnel(): void {
    const identity = this.identity;
    if (identity === null || this.stopped || !this.enabled) return;
    const epoch = ++this.dialEpoch;
    void this.mintAndDial(identity, epoch);
  }

  private async mintAndDial(
    identity: ConnectIdentity,
    epoch: number,
  ): Promise<void> {
    let ticket: TunnelTicket;
    try {
      ticket = await this.options.mintTicket();
    } catch (error) {
      if (!this.isCurrentDial(epoch)) return;
      if (error instanceof NotSignedInError) {
        this.lastError =
          "this bb isn't signed in to a bb account — sign in to turn remote access back on";
        this.options.log.warn(this.lastError);
        this.publish();
        return;
      }
      this.lastError =
        error instanceof AccountUnavailableError
          ? `can't get a tunnel ticket — ${error.message}`
          : `can't get a tunnel ticket from ${connectApexHost(identity)} — ${
              error instanceof Error ? error.message : String(error)
            }`;
      this.scheduleRetry(epoch, this.lastError, 0);
      return;
    }
    if (!this.isCurrentDial(epoch)) return;
    this.dial(identity, ticket, epoch);
  }

  private dial(
    identity: ConnectIdentity,
    ticket: TunnelTicket,
    epoch: number,
  ): void {
    const tunnelUrl = tunnelDialUrl(ticket.tunnelUrl);
    this.options.log.info(
      `tunnel connecting to ${tunnelUrl} (origin ${this.options.getLoopbackBaseUrl()})`,
    );
    let tunnel: NodeWebSocket;
    try {
      tunnel = new NodeWebSocket(tunnelUrl, {
        headers: { authorization: `Bearer ${ticket.ticket}` },
        handshakeTimeout: TUNNEL_HANDSHAKE_TIMEOUT_MS,
      });
    } catch (error) {
      this.lastError = `cannot dial ${tunnelUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.scheduleRetry(epoch, this.lastError, 0);
      return;
    }
    this.tunnel = tunnel;
    let connectedAt = 0;
    let retryScheduled = false;
    let handshakeDeadline: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () =>
      !retryScheduled && this.isCurrentDial(epoch) && this.tunnel === tunnel;

    const retry = (detail: string): void => {
      if (!isCurrent()) return;
      retryScheduled = true;
      clearTimeout(handshakeDeadline);
      if (this.lastError === null) {
        this.lastError = `can't reach ${connectApexHost(identity)} — connection closed`;
      }
      this.scheduleRetry(
        epoch,
        detail,
        connectedAt ? Date.now() - connectedAt : 0,
      );
    };

    handshakeDeadline = setTimeout(() => {
      if (!isCurrent()) return;
      this.lastError = `can't reach ${connectApexHost(identity)} — handshake timed out`;
      retry(this.lastError);
      tunnel.terminate();
    }, TUNNEL_HANDSHAKE_TIMEOUT_MS);
    handshakeDeadline.unref?.();

    tunnel.on("open", () => {
      if (!isCurrent()) return;
      clearTimeout(handshakeDeadline);
      connectedAt = Date.now();
      this.connected = true;
      this.lastError = null;
      this.nextRetryAt = null;
      this.options.log.info("tunnel connected");
      this.session = new TunnelSession({
        tunnel,
        log: this.options.log,
        resolveOrigin: (target) => this.resolveStreamOrigin(target),
        onRemoteClientsChange: (count) => {
          this.remoteClients = count;
          this.publish();
        },
        onActivity: (at) => {
          this.lastRemoteActivityAt = at;
        },
      });
      this.session.start();
      this.publish();
    });
    tunnel.on("unexpected-response", (_req, res) => {
      if (!isCurrent()) return;
      res.resume();
      const statusCode = res.statusCode ?? 0;
      this.lastError =
        statusCode === 401 || statusCode === 403
          ? `the gate refused this bb's tunnel ticket (HTTP ${statusCode})`
          : `tunnel rejected: HTTP ${statusCode}`;
      retry(this.lastError);
      tunnel.terminate();
    });
    tunnel.on("error", (e: Error) => {
      if (!isCurrent()) return;
      this.lastError = humanizeTransportError(e, connectApexHost(identity));
    });
    tunnel.on("close", (code: number, reason: Buffer) => {
      retry(
        `tunnel closed (code ${code}${reason.length > 0 ? `, ${reason.toString()}` : ""})`,
      );
    });
  }
}

function connectApexHost(identity: ConnectIdentity): string {
  try {
    return new URL(identity.baseUrl).host;
  } catch {
    try {
      return new URL(deriveConnectBaseUrl(identity.serverUrl)).host;
    } catch {
      return "getbb.app";
    }
  }
}

function tunnelDialUrl(tunnelUrl: string): string {
  const url = new URL(tunnelUrl);
  url.searchParams.set(TUNNEL_PROTOCOL_QUERY_PARAM, String(PROTOCOL_VERSION));
  return url.toString();
}
