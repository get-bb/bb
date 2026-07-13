import { getNonDestroyedHost, getSessionById, type DbConnection } from "@bb/db";
import {
  hostDaemonConnectTunnelIdentitySchema,
  type HostDaemonConnectShares,
  type HostDaemonConnectTunnelIdentity,
} from "@bb/host-daemon-contract";
import type { NotificationHub } from "./hub.js";

interface HostSharedPortCoordinatorDeps {
  db: DbConnection;
  hub: Pick<NotificationHub, "sendDaemonMessage">;
}

interface SharedPortDeclaration {
  ports: number[];
}

interface HostConnectCapability {
  hasMachineCredential: boolean;
  sessionId: string;
}

function normalizePorts(ports: readonly number[]): number[] {
  const normalized = new Set<number>();
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `shared port ${String(port)} must be an integer between 1 and 65535`,
      );
    }
    normalized.add(port);
  }
  return [...normalized].sort((a, b) => a - b);
}

function fingerprint(shares: HostDaemonConnectShares): string {
  return JSON.stringify(shares.ports);
}

/**
 * Server-owned desired shared-port policy. Plugins can replace only their port
 * declarations. Tunnel identity is reported by the enrolled daemon after it
 * assigns its own label at its trusted gate; it never flows toward the daemon.
 */
export class HostSharedPortCoordinator {
  private readonly declarationsByHost = new Map<
    string,
    Map<string, SharedPortDeclaration>
  >();
  private readonly generationByHost = new Map<string, number>();
  private readonly fingerprintByHost = new Map<string, string>();
  private readonly tunnelIdentityByHost = new Map<
    string,
    HostDaemonConnectTunnelIdentity
  >();
  private readonly tunnelIdentityPromiseByHost = new Map<
    string,
    Promise<HostDaemonConnectTunnelIdentity>
  >();
  private readonly connectCapabilityByHost = new Map<
    string,
    HostConnectCapability
  >();

  constructor(private readonly deps: HostSharedPortCoordinatorDeps) {}

  recordHostConnectCapability(args: {
    hostId: string;
    sessionId: string;
    hasMachineCredential: boolean;
  }): void {
    this.requireShareCapableHost(args.hostId);
    this.connectCapabilityByHost.set(args.hostId, {
      hasMachineCredential: args.hasMachineCredential,
      sessionId: args.sessionId,
    });
  }

  clearHostConnectCapability(sessionId: string): void {
    for (const [hostId, capability] of this.connectCapabilityByHost) {
      if (capability.sessionId === sessionId) {
        this.connectCapabilityByHost.delete(hostId);
      }
    }
  }

  declareSharedPorts(args: {
    ownerId: string;
    hostId: string;
    ports: readonly number[];
  }): HostDaemonConnectShares {
    if (args.ownerId.trim().length === 0) {
      throw new Error("shared-port declaration ownerId must be non-empty");
    }
    this.requireEnrolledHost(args.hostId);

    const current = this.declarationsByHost.get(args.hostId);
    const candidate = new Map(current ?? []);
    candidate.set(args.ownerId, { ports: normalizePorts(args.ports) });
    this.declarationsByHost.set(args.hostId, candidate);
    return this.publishIfChanged(args.hostId);
  }

  clearDeclarationsForOwner(ownerId: string): void {
    for (const [hostId, declarations] of this.declarationsByHost) {
      if (!declarations.delete(ownerId)) {
        continue;
      }
      if (declarations.size === 0) {
        this.declarationsByHost.delete(hostId);
      }
      this.publishIfChanged(hostId);
    }
  }

  recordTunnelIdentity(
    hostId: string,
    identity: HostDaemonConnectTunnelIdentity,
  ): HostDaemonConnectTunnelIdentity {
    this.requireEnrolledHost(hostId);
    const parsed = hostDaemonConnectTunnelIdentitySchema.parse(identity);
    this.tunnelIdentityByHost.set(hostId, parsed);
    return parsed;
  }

  getTunnelIdentity(hostId: string): HostDaemonConnectTunnelIdentity | null {
    this.requireEnrolledHost(hostId);
    return this.tunnelIdentityByHost.get(hostId) ?? null;
  }

  ensureTunnelIdentity(
    hostId: string,
    ensure: () => Promise<HostDaemonConnectTunnelIdentity>,
  ): Promise<HostDaemonConnectTunnelIdentity> {
    const current = this.getTunnelIdentity(hostId);
    if (current !== null) {
      return Promise.resolve(current);
    }
    const existing = this.tunnelIdentityPromiseByHost.get(hostId);
    if (existing) {
      return existing;
    }
    let pending: Promise<HostDaemonConnectTunnelIdentity>;
    pending = ensure()
      .then((identity) => this.recordTunnelIdentity(hostId, identity))
      .finally(() => {
        if (this.tunnelIdentityPromiseByHost.get(hostId) === pending) {
          this.tunnelIdentityPromiseByHost.delete(hostId);
        }
      });
    this.tunnelIdentityPromiseByHost.set(hostId, pending);
    return pending;
  }

  reconcileSharedPortsForHost(hostId: string): HostDaemonConnectShares {
    return this.resolveDeclarations(
      this.declarationsByHost.get(hostId) ?? new Map(),
      this.generationByHost.get(hostId) ?? 0,
    );
  }

  /** Reconcile after daemon socket registration to close the HTTP-open race. */
  pushCurrentSharedPortsForHost(hostId: string): HostDaemonConnectShares {
    const shares = this.reconcileSharedPortsForHost(hostId);
    this.deps.hub.sendDaemonMessage(hostId, {
      type: "connect-shares.replace",
      ...shares,
    });
    return shares;
  }

  private requireShareCapableHost(hostId: string) {
    if (hostId.trim().length === 0) {
      throw new Error("shared-port declaration hostId must be non-empty");
    }
    const host = getNonDestroyedHost(this.deps.db, hostId);
    if (!host) {
      throw new Error(`cannot declare shared ports for unknown host ${hostId}`);
    }
    return host;
  }

  private requireEnrolledHost(hostId: string) {
    const host = this.requireShareCapableHost(hostId);
    const capability = this.connectCapabilityByHost.get(hostId);
    const session = capability
      ? getSessionById(this.deps.db, { sessionId: capability.sessionId })
      : null;
    if (
      host.connectMachineId === null ||
      capability?.hasMachineCredential !== true ||
      session?.hostId !== host.id ||
      session.status !== "active" ||
      session.leaseExpiresAt <= Date.now()
    ) {
      throw new Error(
        `cannot share ports from host "${host.name}" (${host.id}) because it has no bb connect machine credential; remove and re-add the machine from Settings > Machines`,
      );
    }
    return host;
  }

  private publishIfChanged(hostId: string): HostDaemonConnectShares {
    const currentGeneration = this.generationByHost.get(hostId) ?? 0;
    const nextGeneration = currentGeneration + 1;
    const shares = this.resolveDeclarations(
      this.declarationsByHost.get(hostId) ?? new Map(),
      nextGeneration,
    );
    const nextFingerprint = fingerprint(shares);
    const previousFingerprint =
      this.fingerprintByHost.get(hostId) ??
      fingerprint({ generation: currentGeneration, ports: [] });
    if (nextFingerprint === previousFingerprint) {
      return { ...shares, generation: currentGeneration };
    }

    this.fingerprintByHost.set(hostId, nextFingerprint);
    this.generationByHost.set(hostId, nextGeneration);
    this.deps.hub.sendDaemonMessage(hostId, {
      type: "connect-shares.replace",
      ...shares,
    });
    return shares;
  }

  private resolveDeclarations(
    declarations: ReadonlyMap<string, SharedPortDeclaration>,
    generation: number,
  ): HostDaemonConnectShares {
    const ports = new Set<number>();
    for (const declaration of declarations.values()) {
      for (const port of declaration.ports) {
        ports.add(port);
      }
    }
    return {
      generation,
      ports: [...ports].sort((a, b) => a - b),
    };
  }
}
