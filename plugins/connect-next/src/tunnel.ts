import type {
  InternalDoNotUsePluginHostNextTunnelStatus,
  InternalDoNotUsePluginNextTunnelConfig,
  PluginLogger,
} from "@get-bb/plugin-sdk";
import {
  FrpcSupervisor,
  loopbackTarget,
  tunnelServerUrl,
  type FrpProxy,
  type FrpcPrepared,
  type FrpcSupervisorStatus,
  type FrpcTiming,
  type TunnelServer,
} from "@bb/frp-client";
import { gateAudienceForServer } from "@bb/tunnel-contract/next";
import type { ServerCredential, ServerIdentity } from "./account.js";
import { nextSiteForAccount } from "./next-site.js";
import { shareProxyName, shareSubdomain } from "./shares.js";
import type { OpenTunnelIngress, TunnelIngress } from "./ingress.js";
import type {
  ConnectNextMachine,
  ConnectNextShare,
  ConnectNextState,
  ConnectNextStatus,
} from "./types.js";

export const FRP_PROXY_NAME = "bb";

export type NextTunnelTiming = Omit<FrpcTiming, "reloadTimeoutMs">;

export interface NextTunnelOptions {
  frpDir: string;
  serverOverride: TunnelServer | null;
  enabled: boolean;
  resolveBinary(): Promise<string>;
  readCredential(): Promise<ServerCredential | null>;
  openIngress: OpenTunnelIngress;
  trustedCertificates(): Promise<string[]>;
  log: PluginLogger;
  onStatusChange?(status: ConnectNextStatus): void;
  timing?: Partial<NextTunnelTiming>;
  setMachineTunnels?(
    config: InternalDoNotUsePluginNextTunnelConfig | null,
  ): void;
  machineStatuses?(): InternalDoNotUsePluginHostNextTunnelStatus[];
}

interface Session {
  generation: number;
  identity: ServerIdentity;
  ingress: TunnelIngress | null;
  supervisor: FrpcSupervisor;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameIdentity(
  left: ServerIdentity | null,
  right: ServerIdentity | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.serverId === right.serverId &&
    left.label === right.label &&
    left.baseUrl === right.baseUrl
  );
}

const STATE_FOR: Record<FrpcSupervisorStatus["state"], ConnectNextState> = {
  idle: "connecting",
  connecting: "connecting",
  connected: "connected",
  refused: "refused",
  offline: "offline",
  error: "error",
  halted: "signed-out",
};

export class NextTunnel {
  private identity: ServerIdentity | null = null;
  private enabled: boolean;
  private running = false;
  private generation = 0;
  private session: Session | null = null;
  private lastPublished = "";
  private idleSince = Date.now();
  private sharePorts: number[] = [];
  private machineConfig = "null";
  private work: Promise<void> = Promise.resolve();

  constructor(private readonly options: NextTunnelOptions) {
    this.enabled = options.enabled;
  }

  start(): Promise<void> {
    this.running = true;
    return this.reconcile();
  }

  stop(): Promise<void> {
    this.running = false;
    return this.reconcile();
  }

  setEnabled(enabled: boolean): Promise<void> {
    if (this.enabled === enabled) return this.work;
    this.enabled = enabled;
    return this.reconcile();
  }

  setIdentity(identity: ServerIdentity | null): Promise<void> {
    if (sameIdentity(this.identity, identity)) return this.work;
    this.identity = identity;
    return this.reconcile();
  }

  setSharePorts(ports: readonly number[]): Promise<void> {
    const next = [...new Set(ports)].sort((a, b) => a - b);
    if (
      next.length === this.sharePorts.length &&
      next.every((port, index) => port === this.sharePorts[index])
    ) {
      return this.work;
    }
    this.sharePorts = next;
    const session = this.session;
    if (session === null) return this.work;
    return session.supervisor.proxiesChanged();
  }

  idle(): Promise<void> {
    return this.work;
  }

  machinesChanged(): void {
    this.publish();
  }

  childPid(): number | null {
    return this.session?.supervisor.childPid() ?? null;
  }

  private serverFor(identity: ServerIdentity): TunnelServer {
    return (
      this.options.serverOverride ??
      nextSiteForAccount(identity.baseUrl).tunnelServer
    );
  }

  status(): ConnectNextStatus {
    const supervised = this.session?.supervisor.status() ?? null;
    const state: ConnectNextState = !this.enabled
      ? "off"
      : this.identity === null
        ? "signed-out"
        : supervised === null
          ? "connecting"
          : STATE_FOR[supervised.state];
    const server =
      this.identity === null
        ? this.options.serverOverride
        : this.serverFor(this.identity);
    return {
      enabled: this.enabled,
      state,
      label: this.identity?.label ?? null,
      url:
        this.identity === null
          ? null
          : nextSiteForAccount(this.identity.baseUrl).origin(
              this.identity.label,
            ),
      server: server === null ? null : tunnelServerUrl(server),
      lastError: state === "off" ? null : (supervised?.lastError ?? null),
      nextRetryAt: supervised?.nextRetryAt ?? null,
      since: supervised?.since ?? this.idleSince,
      shares: this.sharesFrom(supervised),
      machines: this.machinesFor(state),
    };
  }

  private machinesFor(state: ConnectNextState): ConnectNextMachine[] {
    const identity = this.identity;
    if (state === "off" || identity === null) return [];
    const site = nextSiteForAccount(identity.baseUrl);
    return (this.options.machineStatuses?.() ?? [])
      .filter(
        (machine) =>
          machine.state !== "idle" ||
          machine.shares.length > 0 ||
          machine.lastError !== null,
      )
      .map((machine) => ({
        hostId: machine.hostId,
        hostName: machine.hostName,
        label: machine.label,
        state: machine.state,
        lastError: machine.lastError,
        nextRetryAt: machine.nextRetryAt,
        since: machine.since,
        shares: machine.shares.map((share) => ({
          port: share.port,
          url:
            machine.label === null
              ? ""
              : site.origin(shareSubdomain(machine.label, share.port)),
          state: share.state,
          error: share.error,
        })),
      }));
  }

  private syncMachineTunnels(): void {
    const identity = this.identity;
    const config: InternalDoNotUsePluginNextTunnelConfig | null =
      this.running && this.enabled && identity !== null
        ? {
            domain: nextSiteForAccount(identity.baseUrl).domain,
            server: this.serverFor(identity),
          }
        : null;
    const key = JSON.stringify(config);
    if (key === this.machineConfig) return;
    try {
      this.options.setMachineTunnels?.(config);
      this.machineConfig = key;
    } catch (error) {
      this.options.log.warn(
        `could not ${config === null ? "stop" : "start"} machine tunnels on connect next: ${errorText(error)}`,
      );
    }
  }

  private sharesFrom(
    supervised: FrpcSupervisorStatus | null,
  ): ConnectNextShare[] {
    const identity = this.session?.identity ?? null;
    if (supervised === null || identity === null) return [];
    const site = nextSiteForAccount(identity.baseUrl);
    return supervised.proxies
      .filter((proxy) => proxy.name !== FRP_PROXY_NAME)
      .map((proxy) => ({
        port: proxy.localPort,
        url: site.origin(shareSubdomain(identity.label, proxy.localPort)),
        state: proxy.state,
        error: proxy.error,
      }));
  }

  private reconcile(): Promise<void> {
    const generation = ++this.generation;
    this.work = this.work.then(async () => {
      if (generation !== this.generation) return;
      await this.teardown();
      if (generation !== this.generation) return;
      this.syncMachineTunnels();
      const identity = this.identity;
      if (!this.running || !this.enabled || identity === null) {
        this.publish();
        return;
      }
      const session: Session = {
        generation,
        identity,
        ingress: null,
        supervisor: new FrpcSupervisor({
          frpDir: this.options.frpDir,
          primaryProxy: FRP_PROXY_NAME,
          resolveBinary: () => this.options.resolveBinary(),
          trustedCertificates: () => this.options.trustedCertificates(),
          prepare: () => this.prepare(session),
          proxies: () => this.proxiesFor(session),
          log: {
            info: (message) => this.options.log.info(message),
            warn: (message) =>
              this.options.log.warn(`connect next: ${message}`),
          },
          onStatusChange: () => {
            if (this.current(session)) this.publish();
          },
          ...(this.options.timing === undefined
            ? {}
            : { timing: this.options.timing }),
        }),
      };
      this.session = session;
      session.supervisor.start();
    });
    return this.work;
  }

  private current(session: Session): boolean {
    return this.session === session && session.generation === this.generation;
  }

  private async prepare(session: Session): Promise<FrpcPrepared> {
    const { identity } = session;
    const credential = await this.options.readCredential();
    if (credential === null || credential.serverId !== identity.serverId) {
      return {
        kind: "halt",
        reason: "bb account holds no server credential for this bb yet",
      };
    }
    if (session.ingress === null) {
      const ingress = await this.options.openIngress({
        audience: gateAudienceForServer(identity.serverId),
      });
      if (!this.current(session)) {
        await ingress.close();
        throw new Error("connect next was stopped");
      }
      session.ingress = ingress;
    }
    return {
      kind: "launch",
      server: this.serverFor(identity),
      user: identity.label,
      credential: credential.credential,
    };
  }

  private proxiesFor(session: Session): FrpProxy[] {
    if (session.ingress === null) return [];
    const { label } = session.identity;
    return [
      {
        name: FRP_PROXY_NAME,
        subdomain: label,
        ...loopbackTarget(session.ingress.baseUrl),
        hostHeaderRewrite: null,
      },
      ...this.sharePorts.map((port) => ({
        name: shareProxyName(port),
        subdomain: shareSubdomain(label, port),
        localIP: "127.0.0.1",
        localPort: port,
        hostHeaderRewrite: `127.0.0.1:${port}`,
      })),
    ];
  }

  private async teardown(): Promise<void> {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.idleSince = Date.now();
    await session.supervisor.stop();
    if (session.ingress !== null) {
      const ingress = session.ingress;
      session.ingress = null;
      try {
        await ingress.close();
      } catch (error) {
        this.options.log.warn(
          `could not close the tunnel ingress: ${errorText(error)}`,
        );
      }
    }
  }

  private publish(): void {
    const status = this.status();
    const key = JSON.stringify({ ...status, since: 0 });
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.options.onStatusChange?.(status);
  }
}
