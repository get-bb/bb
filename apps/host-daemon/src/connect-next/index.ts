import path from "node:path";
import {
  FrpcSupervisor,
  type FrpProxy,
  type FrpcPrepared,
  type FrpcSupervisorOptions,
  type FrpcSupervisorStatus,
  type FrpcTiming,
} from "@bb/frp-client";
import { connectPublicProtocol } from "@bb/connect-client";
import type {
  HostDaemonConnectNext,
  HostDaemonConnectNextConfig,
  HostDaemonConnectNextState,
  HostDaemonConnectNextStatus,
  HostDaemonConnectTunnelIdentity,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";

export const MACHINE_SHARE_PROXY_PREFIX = "share-";
const LAST_SHARE_LINGER_MS = 1_000;
export const SESSION_LOSS_GRACE_MS = 30_000;

export type MachineNextSupervisor = Pick<
  FrpcSupervisor,
  "start" | "stop" | "status" | "proxiesChanged" | "childPid"
>;

export interface MachineNextTunnelOptions {
  frpDir: string;
  trustedBaseDomain: () => string | null;
  machineCredential: string | undefined;
  ensureIdentity(): Promise<HostDaemonConnectTunnelIdentity>;
  resolveBinary(): Promise<string>;
  trustedCertificates(): Promise<string[]>;
  logger: HostDaemonLogger;
  onStatusChange?(status: HostDaemonConnectNextStatus): void;
  timing?: Partial<Omit<FrpcTiming, "reloadTimeoutMs">>;
  lastShareLingerMs?: number;
  sessionLossGraceMs?: number;
  createSupervisor?: (options: FrpcSupervisorOptions) => MachineNextSupervisor;
}

interface Session {
  config: HostDaemonConnectNextConfig;
  supervisor: MachineNextSupervisor;
}

const STATE_FOR: Record<
  FrpcSupervisorStatus["state"],
  HostDaemonConnectNextState
> = {
  idle: "connecting",
  connecting: "connecting",
  connected: "connected",
  refused: "refused",
  offline: "offline",
  error: "error",
  halted: "error",
};

function hostnameOf(domain: string): string {
  return new URL(`https://${domain}`).hostname;
}

export function machineShareProxies(
  label: string,
  ports: readonly number[],
): FrpProxy[] {
  return ports.map((port) => ({
    name: `${MACHINE_SHARE_PROXY_PREFIX}${port}`,
    subdomain: `${label}--${port}`,
    localIP: "127.0.0.1",
    localPort: port,
    hostHeaderRewrite: `127.0.0.1:${port}`,
  }));
}

export function checkNextConfig(
  trustedBaseDomain: string | null,
  config: HostDaemonConnectNextConfig,
): string | null {
  if (trustedBaseDomain === null) {
    return "this machine has no trusted bb connect enrollment, so it cannot use connect next";
  }
  let trustedHost: string;
  let domainHost: string;
  try {
    trustedHost = hostnameOf(trustedBaseDomain);
    domainHost = hostnameOf(config.domain);
  } catch {
    return `the connect next domain ${config.domain} is not a host name`;
  }
  if (domainHost !== trustedHost && domainHost !== `next.${trustedHost}`) {
    return `the connect next domain ${config.domain} is not next.${trustedHost}, the domain this machine enrolled with`;
  }
  if (config.server.host !== `tunnel.${domainHost}`) {
    return `the connect next tunnel server ${config.server.host} is not tunnel.${domainHost}`;
  }
  if (
    config.server.protocol !== "wss" &&
    connectPublicProtocol(trustedBaseDomain) === "https:"
  ) {
    return "connect next must dial its tunnel server over wss";
  }
  return null;
}

export class MachineNextTunnel {
  private generation = -1;
  private config: HostDaemonConnectNextConfig | null = null;
  private ports: number[] = [];
  private label: string | null = null;
  private session: Session | null = null;
  private stopped = false;
  private work: Promise<void> = Promise.resolve();
  private idleSince = Date.now();
  private lastPublished = "";
  private sessionLossTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly machineCredential: string | undefined;

  constructor(private readonly options: MachineNextTunnelOptions) {
    this.machineCredential =
      options.machineCredential?.trim().length === 0
        ? undefined
        : options.machineCredential;
  }

  replace(next: HostDaemonConnectNext): boolean {
    if (next.generation <= this.generation) return false;
    this.apply(next);
    return true;
  }

  replaceAuthoritative(next: HostDaemonConnectNext): void {
    this.apply(next);
  }

  sessionLost(): void {
    if (this.sessionLossTimer !== undefined || this.config === null) return;
    this.sessionLossTimer = setTimeout(() => {
      this.sessionLossTimer = undefined;
      this.options.logger.info(
        {},
        "Machine next tunnel stopping: no server session to confirm it",
      );
      this.config = null;
      void this.reconcile();
    }, this.options.sessionLossGraceMs ?? SESSION_LOSS_GRACE_MS);
    this.sessionLossTimer.unref?.();
  }

  sessionRestored(): void {
    clearTimeout(this.sessionLossTimer);
    this.sessionLossTimer = undefined;
  }

  setPorts(ports: readonly number[]): Promise<void> {
    const next = [...new Set(ports)].sort((a, b) => a - b);
    if (
      next.length === this.ports.length &&
      next.every((port, index) => port === this.ports[index])
    ) {
      return this.work;
    }
    const wasEmpty = this.ports.length === 0;
    this.ports = next;
    const session = this.session;
    if (session !== null && !wasEmpty && next.length > 0) {
      const reloaded = session.supervisor.proxiesChanged();
      this.publish();
      return reloaded;
    }
    return this.reconcile();
  }

  status(): HostDaemonConnectNextStatus {
    const supervised = this.session?.supervisor.status() ?? null;
    return {
      state: supervised === null ? "idle" : STATE_FOR[supervised.state],
      label: this.label,
      lastError: this.idleReason() ?? supervised?.lastError ?? null,
      nextRetryAt: supervised?.nextRetryAt ?? null,
      since: supervised?.since ?? this.idleSince,
      shares:
        supervised?.proxies.map((proxy) => ({
          port: proxy.localPort,
          state: proxy.state,
          error: proxy.error,
        })) ?? [],
    };
  }

  childPid(): number | null {
    return this.session?.supervisor.childPid() ?? null;
  }

  idle(): Promise<void> {
    return this.work;
  }

  shutdown(): Promise<void> {
    this.sessionRestored();
    this.stopped = true;
    return this.reconcile();
  }

  private idleReason(): string | null {
    if (this.session !== null || this.config === null) return null;
    if (this.machineCredential === undefined) {
      return "this machine has no bb connect machine credential";
    }
    return null;
  }

  private apply(next: HostDaemonConnectNext): void {
    this.generation = next.generation;
    const changed = JSON.stringify(next.config) !== JSON.stringify(this.config);
    this.config = next.config;
    if (changed) void this.reconcile();
  }

  private wanted(): HostDaemonConnectNextConfig | null {
    if (
      this.stopped ||
      this.config === null ||
      this.ports.length === 0 ||
      this.machineCredential === undefined
    ) {
      return null;
    }
    return this.config;
  }

  private reconcile(): Promise<void> {
    this.work = this.work.then(async () => {
      const wanted = this.wanted();
      const current = this.session;
      if (
        current !== null &&
        wanted !== null &&
        JSON.stringify(current.config) === JSON.stringify(wanted)
      ) {
        await current.supervisor.proxiesChanged();
        this.publish();
        return;
      }
      if (current !== null) {
        if (
          wanted === null &&
          !this.stopped &&
          this.ports.length === 0 &&
          JSON.stringify(current.config) === JSON.stringify(this.config)
        ) {
          await this.closeLastShare(current);
        }
        this.session = null;
        this.idleSince = Date.now();
        await current.supervisor.stop();
        this.options.logger.info(
          { label: this.label },
          "Machine next tunnel stopped",
        );
      }
      if (wanted !== null) this.startSession(wanted);
      this.publish();
    });
    return this.work;
  }

  private async closeLastShare(session: Session): Promise<void> {
    await session.supervisor.proxiesChanged();
    const lingerMs = this.options.lastShareLingerMs ?? LAST_SHARE_LINGER_MS;
    if (lingerMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, lingerMs));
    }
  }

  private startSession(config: HostDaemonConnectNextConfig): void {
    const supervisorOptions: FrpcSupervisorOptions = {
      frpDir: this.options.frpDir,
      primaryProxy: null,
      resolveBinary: () => this.options.resolveBinary(),
      trustedCertificates: () => this.options.trustedCertificates(),
      prepare: () => this.prepare(config),
      proxies: () =>
        this.label === null ? [] : machineShareProxies(this.label, this.ports),
      log: {
        info: (message) => this.options.logger.debug({}, message),
        warn: (message) =>
          this.options.logger.warn({}, `connect next: ${message}`),
      },
      onStatusChange: () => {
        if (this.session === session) this.publish();
      },
      ...(this.options.timing === undefined
        ? {}
        : { timing: this.options.timing }),
    };
    const supervisor =
      this.options.createSupervisor?.(supervisorOptions) ??
      new FrpcSupervisor(supervisorOptions);
    const session: Session = { config, supervisor };
    this.session = session;
    this.options.logger.info(
      { domain: config.domain, ports: this.ports },
      "Machine next tunnel starting",
    );
    supervisor.start();
  }

  private async prepare(
    config: HostDaemonConnectNextConfig,
  ): Promise<FrpcPrepared> {
    const credential = this.machineCredential;
    if (credential === undefined) {
      return {
        kind: "halt",
        reason: "this machine has no bb connect machine credential",
      };
    }
    const problem = checkNextConfig(this.options.trustedBaseDomain(), config);
    if (problem !== null) return { kind: "halt", reason: problem };
    const identity = await this.options.ensureIdentity();
    if (this.label !== identity.label) {
      this.label = identity.label;
      this.publish();
    }
    return {
      kind: "launch",
      server: config.server,
      user: identity.label,
      credential,
    };
  }

  private publish(): void {
    const status = this.status();
    const key = JSON.stringify({ ...status, since: 0 });
    if (key === this.lastPublished) return;
    this.lastPublished = key;
    this.options.onStatusChange?.(status);
  }
}

export function machineNextFrpDir(dataDir: string): string {
  return path.join(dataDir, "connect-next", "frp");
}
