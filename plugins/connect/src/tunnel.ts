// The connect tunnel, hosted by the plugin's "tunnel" background service.
// When paired, it dials the per-handle gate over an outbound WebSocket and
// proxies relayed HTTP/WS streams to the server's own loopback base URL
// (which serves the SPA + /api + /ws), or to a registered share port when
// the relay stamps `target` on the open frame.
//
// Transport-generic session machinery lives in @bb/tunnel-client; this file
// owns pairing, credentials, shares, and status.
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
import type { PluginLogger } from "@bb/plugin-sdk";
import type { ConnectCredential, CredentialStore } from "./credential.js";
import { fetchMachineCode, MachineCodeError } from "./machine-code.js";
import {
  ConnectListError,
  fetchAccountServers,
  withAccountServerUrls,
  type ListAccountServersResult,
} from "./list-servers.js";
import {
  asConnectPairError,
  DEFAULT_CONNECT_BASE_URL,
  deriveConnectBaseUrl,
  redeemConnectCode,
  serverUrlForHandle,
} from "./redeem.js";
import { fetchDesktopSession, type DesktopSession } from "./desktop-session.js";
import { revokeMachine } from "./revoke-machine.js";
import {
  ShareRegistry,
  shareLoopbackHost,
  shareLoopbackOrigin,
  sharePublicUrl,
} from "./shares.js";
import type { ShareHost } from "./hosts.js";
import type { ConnectStateName, ConnectStatus } from "./types.js";

export interface ConnectTunnelOptions {
  store: CredentialStore;
  shares: ShareRegistry;
  /**
   * The server's own loopback base URL, read lazily (bb.server is
   * bind-gated; the tunnel only needs it once a socket opens).
   */
  getLoopbackBaseUrl: () => string;
  log: PluginLogger;
  /** Fired on every state/handle/error/shares/presence transition. */
  onStatusChange?: (status: ConnectStatus) => void;
}

/**
 * Holds the connect tunnel for this bb. Pairing writes the durable credential
 * to plugin kv and (re)connects; the tunnel reconnects with capped backoff on
 * drops and is re-established from the stored credential when the background
 * service starts. Disabling the plugin aborts the service, which stops the
 * tunnel — the plugin is the single owner of remote access.
 */
export class ConnectTunnel {
  private credential: ConnectCredential | null = null;
  private tunnel: NodeWebSocket | undefined;
  private session: TunnelSession | undefined;
  private connected = false;
  private pairing = false;
  private lastError: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly backoff = new ReconnectBackoff();
  private stopped = false;
  private lastState: ConnectStateName = "disconnected";
  private stateSince = Date.now();
  private lastRemoteActivityAt: number | null = null;
  private remoteClients = 0;
  private nextRetryAt: number | null = null;
  private shareRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private shareActivationEpoch = 0;

  constructor(private readonly options: ConnectTunnelOptions) {}

  get shares(): ShareRegistry {
    return this.options.shares;
  }

  /** Current pairing credential, or null when unpaired. */
  getCredential(): ConnectCredential | null {
    return this.credential;
  }

  /** Service start: reconnect from a previously-stored credential, if any. */
  async start(): Promise<void> {
    const stored = await this.options.store.read();
    if (stored) {
      this.credential = stored;
      this.stopped = false;
      this.openTunnel();
    }
    this.startShareActivation();
    this.publish();
  }

  async pair(args: {
    code: string;
    serverUrl?: string;
    baseUrl?: string;
  }): Promise<ConnectStatus> {
    const baseUrl =
      args.baseUrl ??
      (args.serverUrl !== undefined
        ? deriveConnectBaseUrl(args.serverUrl)
        : DEFAULT_CONNECT_BASE_URL);
    this.pairing = true;
    this.publish();
    try {
      let redeemed;
      try {
        redeemed = await redeemConnectCode({ code: args.code, baseUrl });
      } catch (error) {
        // Raw wire/transport detail goes to the log only; the caller gets a
        // typed ConnectPairError whose code the panel maps to human copy.
        const pairError = asConnectPairError(error);
        this.options.log.warn(
          `pair failed (${pairError.code}): ${pairError.message}`,
        );
        throw pairError;
      }
      const serverUrl = (
        args.serverUrl ?? serverUrlForHandle(baseUrl, redeemed.handle)
      ).replace(/\/$/, "");
      const credential: ConnectCredential = {
        serverUrl,
        handle: redeemed.handle,
        credential: redeemed.credential,
      };
      await this.options.store.write(credential);
      this.credential = credential;
      this.lastError = null;
      this.reconnect();
      this.startShareActivation();
    } finally {
      this.pairing = false;
      this.publish();
    }
    return this.status();
  }

  async disconnect(): Promise<ConnectStatus> {
    this.shareActivationEpoch += 1;
    await this.options.store.clear();
    this.options.shares.clearMachineDeclarations();
    this.credential = null;
    this.teardown();
    this.lastError = null;
    this.publish();
    return this.status();
  }

  async expose(
    port: number,
    host: ShareHost,
  ): Promise<{
    hostId: string;
    hostName: string;
    port: number;
    url: string;
  }> {
    const listing = await this.options.shares.add(port, host);
    // shares.onChange already publishes; ensure status is fresh if it didn't.
    this.publish();
    return {
      hostId: listing.hostId,
      hostName: listing.hostName,
      port: listing.port,
      url: listing.url,
    };
  }

  async unexpose(
    port: number,
    hostSelector: string,
  ): Promise<{
    removed: boolean;
    hostId: string;
    hostName: string;
    port: number;
  }> {
    const result = await this.options.shares.remove(port, hostSelector);
    this.publish();
    return { ...result, port };
  }

  async listShares(hostId?: string): Promise<
    Array<{
      hostId: string;
      hostName: string;
      port: number;
      url: string;
      unavailableReason?: string;
    }>
  > {
    return (await this.options.shares.list(hostId)).map(
      ({ hostId: id, hostName, port, url, unavailableReason }) => ({
        hostId: id,
        hostName,
        port,
        url,
        ...(unavailableReason === undefined ? {} : { unavailableReason }),
      }),
    );
  }

  /**
   * List every bb server on the paired account (via the connect gate).
   * Returns this server's handle so callers can dedupe self. Each row includes
   * the public connect URL (`https://<handle>.…`) derived from the credential.
   */
  async listAccountServers(): Promise<ListAccountServersResult> {
    const credential = this.credential;
    if (credential === null) {
      throw new ConnectListError(
        "not_paired",
        "this bb is not connected to getbb.app — run `bb connect` for how to pair",
      );
    }
    const servers = withAccountServerUrls(
      await fetchAccountServers(credential),
      credential,
    );
    return { servers, selfHandle: credential.handle };
  }

  async createDesktopSession(): Promise<DesktopSession> {
    if (this.credential === null) {
      throw new ConnectListError("not_paired", "this bb is not connected");
    }
    return fetchDesktopSession(this.credential);
  }

  async createMachineCode() {
    if (this.credential === null) {
      throw new MachineCodeError("not_paired");
    }
    return fetchMachineCode(this.credential);
  }

  async revokeMachine(machineId: string): Promise<void> {
    const credential = this.getCredential();
    if (credential === null) throw new Error("not_paired");
    await revokeMachine(credential, machineId);
  }

  status(): ConnectStatus {
    return this.statusWithShares(
      this.options.shares
        .snapshot()
        .map(({ hostId, hostName, port, url, unavailableReason }) => ({
          hostId,
          hostName,
          port,
          url,
          ...(unavailableReason === undefined ? {} : { unavailableReason }),
        })),
    );
  }

  async refreshStatus(): Promise<ConnectStatus> {
    return this.statusWithShares(await this.listShares());
  }

  private statusWithShares(shares: ConnectStatus["shares"]): ConnectStatus {
    const state = this.computeState();
    return {
      state,
      paired: this.credential !== null,
      handle: this.credential?.handle ?? null,
      url: this.credential?.serverUrl ?? null,
      dashboardUrl: this.dashboardUrl(),
      lastError: this.lastError,
      nextRetryAt: state === "reconnecting" ? this.nextRetryAt : null,
      since: this.stateSince,
      remoteClients: this.remoteClients,
      lastRemoteActivityAt: this.lastRemoteActivityAt,
      shares,
    };
  }

  /** getbb.app dashboard URL, derived from the paired base (or the apex). */
  private dashboardUrl(): string {
    const base =
      this.credential !== null
        ? deriveConnectBaseUrl(this.credential.serverUrl)
        : DEFAULT_CONNECT_BASE_URL;
    return `${base.replace(/\/$/, "")}/dashboard`;
  }

  /** Stop the tunnel without clearing the credential (service abort). */
  stop(): void {
    this.teardown();
    this.options.shares.clearMachineDeclarations();
    this.publish();
  }

  private computeState(): ConnectStateName {
    if (this.pairing) return "pairing";
    if (this.credential === null) return "disconnected";
    return this.connected ? "connected" : "reconnecting";
  }

  /** Recompute the state and push a status snapshot when anything changed. */
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
    // Keep the existing 'error'/'close' listeners (they no-op once `stopped` is
    // set and `this.tunnel` is cleared) rather than removeAllListeners, so a
    // late socket error after terminate() still has a handler and doesn't throw
    // as an unhandled 'error' event.
    this.tunnel?.terminate();
    this.tunnel = undefined;
    this.connected = false;
    this.backoff.reset();
    this.nextRetryAt = null;
  }

  private reconnect(): void {
    this.teardown();
    this.stopped = false;
    this.openTunnel();
  }

  /**
   * A disconnected enrolled host must not block this server's own tunnel.
   * Keep retrying persisted machine-share hydration/declaration separately.
   */
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
      await this.options.shares.declareMachineShares(() =>
        this.isShareActivationCurrent(epoch),
      );
      if (!this.isShareActivationCurrent(epoch)) return;
      this.publish();
    } catch (error) {
      this.options.log.warn(
        `shared-port activation failed; retrying: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (
        this.credential !== null &&
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

  /**
   * The gate refused our bearer credential: reconnecting cannot help, so
   * forget it and land in "not paired" with an explanation — unlike network
   * failures, which keep the credential and stay in "reconnecting".
   */
  private credentialRejected(statusCode: number): void {
    this.lastError =
      `the gate rejected this bb's credential (HTTP ${statusCode}) — ` +
      "pairing was revoked; get a new code from the getbb.app dashboard and re-pair";
    this.options.log.warn(this.lastError);
    this.credential = null;
    this.teardown();
    this.publish();
    void this.options.store.clear().catch((error: unknown) => {
      this.options.log.warn(
        `failed to clear the rejected credential: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private resolveStreamOrigin(target: string | undefined): StreamOriginResult {
    if (target === undefined) {
      return {
        kind: "ok",
        resolved: {
          origin: this.options.getLoopbackBaseUrl().replace(/\/$/, ""),
          publicOrigin: this.credential
            ? new URL(this.credential.serverUrl).origin
            : this.options.getLoopbackBaseUrl(),
        },
      };
    }
    const port = Number(target);
    if (!Number.isInteger(port) || !this.options.shares.hasServerPort(port)) {
      return { kind: "unregistered" };
    }
    const credential = this.credential;
    if (credential === null) {
      return { kind: "unregistered" };
    }
    return {
      kind: "ok",
      resolved: {
        origin: shareLoopbackOrigin(port),
        publicOrigin: new URL(sharePublicUrl(credential, port)).origin,
        host: shareLoopbackHost(port),
      },
    };
  }

  private openTunnel(): void {
    const credential = this.credential;
    if (!credential || this.stopped) return;

    const tunnelUrl = tunnelUrlForServer(credential.serverUrl);
    this.options.log.info(
      `tunnel connecting to ${tunnelUrl} (origin ${this.options.getLoopbackBaseUrl()})`,
    );
    let tunnel: NodeWebSocket;
    try {
      tunnel = new NodeWebSocket(tunnelUrl, {
        headers: { authorization: `Bearer ${credential.credential}` },
      });
    } catch (error) {
      // A malformed stored serverUrl throws synchronously. Retrying cannot
      // help; surface it and wait for a re-pair (or disconnect).
      this.lastError = `cannot dial ${tunnelUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.options.log.warn(this.lastError);
      this.publish();
      return;
    }
    this.tunnel = tunnel;
    let connectedAt = 0;

    tunnel.on("open", () => {
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
      const statusCode = res.statusCode ?? 0;
      if (statusCode === 401 || statusCode === 403) {
        this.credentialRejected(statusCode);
        return;
      }
      this.lastError = `tunnel rejected: HTTP ${statusCode}`;
      this.options.log.warn(this.lastError);
    });
    tunnel.on("error", (e: Error) => {
      // Humanize transport failures for the reconnecting card; the raw
      // message still rides the log via the close handler below.
      this.lastError = humanizeTransportError(
        e,
        connectApexHost(credential.serverUrl),
      );
    });
    tunnel.on("close", (code: number, reason: Buffer) => {
      this.connected = false;
      this.session?.dispose();
      this.session = undefined;
      this.remoteClients = 0;
      if (this.stopped || this.tunnel !== tunnel) return;
      const stable = connectedAt ? Date.now() - connectedAt : 0;
      const delay = this.backoff.nextDelayAfterClose(stable);
      // A clean close with no prior socket error still leaves the card empty;
      // give it an honest line so the reconnecting state is never blank.
      if (this.lastError === null) {
        this.lastError = `can't reach ${connectApexHost(credential.serverUrl)} — connection closed`;
      }
      this.nextRetryAt = Date.now() + delay;
      this.options.log.warn(
        `tunnel closed (code ${code}${reason.length > 0 ? `, ${reason.toString()}` : ""}); reconnecting in ${delay}ms`,
      );
      this.reconnectTimer = setTimeout(() => this.openTunnel(), delay);
      this.publish();
    });
  }
}

/** Host shown in transport errors — the connect apex, e.g. "getbb.app". */
function connectApexHost(serverUrl: string): string {
  try {
    return new URL(deriveConnectBaseUrl(serverUrl)).host;
  } catch {
    return "getbb.app";
  }
}

function tunnelUrlForServer(serverUrl: string): string {
  const base =
    serverUrl.replace(/^http/, "ws").replace(/\/$/, "") + "/__tunnel";
  const url = new URL(base);
  url.searchParams.set(TUNNEL_PROTOCOL_QUERY_PARAM, String(PROTOCOL_VERSION));
  return url.toString();
}
