import { getNonDestroyedHost, type DbConnection } from "@bb/db";
import {
  hostDaemonConnectSharesTunnelSchema,
  type HostDaemonConnectShares,
  type HostDaemonConnectSharesTunnel,
} from "@bb/host-daemon-contract";
import type { NotificationHub } from "./hub.js";

interface HostSharedPortCoordinatorDeps {
  db: DbConnection;
  hub: Pick<NotificationHub, "sendDaemonMessage">;
}

interface SharedPortDeclaration {
  ports: number[];
  tunnel: HostDaemonConnectSharesTunnel | null;
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
  return JSON.stringify({ ports: shares.ports, tunnel: shares.tunnel });
}

/**
 * Server-owned desired shared-port state. Plugins declare host policy here;
 * daemons only receive the resulting host-local primitive configuration.
 *
 * Phase 2 stores machine labels at the gate, not in the bb host row. Until a
 * later durable host-label contract exists, the declaring plugin supplies the
 * gate-returned label and base domain. This coordinator keeps that identity in
 * memory with the declaration and owns generation assignment and delivery.
 */
export class HostSharedPortCoordinator {
  private readonly declarationsByHost = new Map<
    string,
    Map<string, SharedPortDeclaration>
  >();
  private readonly generationByHost = new Map<string, number>();
  private readonly fingerprintByHost = new Map<string, string>();

  constructor(private readonly deps: HostSharedPortCoordinatorDeps) {}

  declareSharedPorts(args: {
    ownerId: string;
    hostId: string;
    ports: readonly number[];
    tunnel: HostDaemonConnectSharesTunnel | null;
  }): HostDaemonConnectShares {
    if (args.ownerId.trim().length === 0) {
      throw new Error("shared-port declaration ownerId must be non-empty");
    }
    if (args.hostId.trim().length === 0) {
      throw new Error("shared-port declaration hostId must be non-empty");
    }
    if (!getNonDestroyedHost(this.deps.db, args.hostId)) {
      throw new Error(
        `cannot declare shared ports for unknown host ${args.hostId}`,
      );
    }

    const nextDeclaration: SharedPortDeclaration = {
      ports: normalizePorts(args.ports),
      tunnel:
        args.tunnel === null
          ? null
          : hostDaemonConnectSharesTunnelSchema.parse(args.tunnel),
    };
    const current = this.declarationsByHost.get(args.hostId);
    const candidate = new Map(current ?? []);
    candidate.set(args.ownerId, nextDeclaration);
    // Resolve before committing so a conflicting host identity cannot mutate
    // the desired state and then fail halfway through the declaration.
    this.resolveDeclarations(args.hostId, candidate, 0);
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

  reconcileSharedPortsForHost(hostId: string): HostDaemonConnectShares {
    return this.resolveDeclarations(
      hostId,
      this.declarationsByHost.get(hostId) ?? new Map(),
      this.generationByHost.get(hostId) ?? 0,
    );
  }

  private publishIfChanged(hostId: string): HostDaemonConnectShares {
    const currentGeneration = this.generationByHost.get(hostId) ?? 0;
    const nextGeneration = currentGeneration + 1;
    const shares = this.resolveDeclarations(
      hostId,
      this.declarationsByHost.get(hostId) ?? new Map(),
      nextGeneration,
    );
    const nextFingerprint = fingerprint(shares);
    const previousFingerprint =
      this.fingerprintByHost.get(hostId) ??
      fingerprint({ generation: currentGeneration, ports: [], tunnel: null });
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
    hostId: string,
    declarations: ReadonlyMap<string, SharedPortDeclaration>,
    generation: number,
  ): HostDaemonConnectShares {
    const ports = new Set<number>();
    let tunnel: HostDaemonConnectSharesTunnel | null = null;
    let tunnelOwner: string | null = null;

    for (const [ownerId, declaration] of declarations) {
      for (const port of declaration.ports) {
        ports.add(port);
      }
      if (declaration.tunnel === null) {
        continue;
      }
      if (
        tunnel !== null &&
        (tunnel.label !== declaration.tunnel.label ||
          tunnel.baseDomain !== declaration.tunnel.baseDomain)
      ) {
        throw new Error(
          `conflicting tunnel identities declared for host ${hostId} by ${tunnelOwner} and ${ownerId}`,
        );
      }
      tunnel = declaration.tunnel;
      tunnelOwner = ownerId;
    }

    return {
      generation,
      ports: [...ports].sort((a, b) => a - b),
      tunnel,
    };
  }
}
