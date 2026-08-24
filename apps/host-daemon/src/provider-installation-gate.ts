import { bridgeLaunchProcessKey } from "@bb/agent-runtime";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type {
  ProviderInstallationRequirement,
  ProviderInstallationStatus,
} from "@bb/provider-bridge-protocol";

/**
 * How long a "supported" probe answer gates thread start and rewind before
 * the daemon asks the bridge again. A bounded staleness window only matters
 * for an out-of-band downgrade: upgrades stay supported, and installs the
 * daemon runs itself or a shell-environment change clear the memo outright.
 */
export const PROVIDER_INSTALLATION_GATE_TTL_MS = 5 * 60_000;

export interface ProviderInstallationGateKeyArgs {
  providerId: string;
  bridgeLaunch: HostDaemonBridgeLaunch;
  requirement?: ProviderInstallationRequirement;
}

/**
 * Memo for the provider-CLI version gate in front of thread start and rewind.
 * Concurrent starts for one key share the in-flight probe, and a supported
 * answer is served from memory until it expires. An unsupported answer and a
 * rejected probe are never stored, so a CLI that is too old is re-probed on
 * every attempt until it passes.
 */
export interface ProviderInstallationGate {
  clear(): void;
  run(
    key: string,
    probe: () => Promise<ProviderInstallationStatus>,
  ): Promise<ProviderInstallationStatus>;
}

interface CreateProviderInstallationGateOptions {
  ttlMs: number;
  now?: () => number;
}

interface SettledEntry {
  expiresAt: number;
  status: ProviderInstallationStatus;
}

/**
 * Keys from the wire launch rather than the resolved one so a hit skips the
 * artifact fetch and hash verification as well as the probe. The bridge
 * process-key part mirrors the runtime's own process identity (artifact
 * digest plus declaration facts), which is exactly what decides which binary
 * answers the probe; the requirement is part of the key because a bridge can
 * demand a newer CLI for rewind than for start.
 */
export function providerInstallationGateKey(
  args: ProviderInstallationGateKeyArgs,
): string {
  return `${args.providerId}#bridge:${bridgeLaunchProcessKey(args.bridgeLaunch)}#${args.requirement ?? "thread_start"}`;
}

export function createProviderInstallationGate({
  ttlMs,
  now = Date.now,
}: CreateProviderInstallationGateOptions): ProviderInstallationGate {
  const settledByKey = new Map<string, SettledEntry>();
  const pendingByKey = new Map<string, Promise<ProviderInstallationStatus>>();
  // A probe that was already running when the memo was cleared answered for
  // the state before the clear, so its result must not be stored after it.
  let generation = 0;

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of settledByKey) {
      if (entry.expiresAt <= currentTime) {
        settledByKey.delete(key);
      }
    }
  }

  return {
    clear() {
      generation += 1;
      settledByKey.clear();
      pendingByKey.clear();
    },
    run(key, probe) {
      const currentTime = now();
      const settled = settledByKey.get(key);
      if (settled !== undefined) {
        if (settled.expiresAt > currentTime) {
          return Promise.resolve(settled.status);
        }
        settledByKey.delete(key);
      }
      const pending = pendingByKey.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const startedGeneration = generation;
      const started = probe()
        .then((status) => {
          const settledAt = now();
          // Expired neighbours are swept here rather than on a timer so the
          // map stays bounded without keeping the process alive.
          pruneExpired(settledAt);
          if (!status.versionUnsupported && startedGeneration === generation) {
            settledByKey.set(key, { status, expiresAt: settledAt + ttlMs });
          }
          return status;
        })
        .finally(() => {
          if (pendingByKey.get(key) === started) {
            pendingByKey.delete(key);
          }
        });
      pendingByKey.set(key, started);
      return started;
    },
  };
}
