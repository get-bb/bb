import { bridgeLaunchProcessKey } from "@bb/agent-runtime";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type {
  ProviderInstallationRequirement,
  ProviderInstallationStatus,
} from "@bb/provider-bridge-protocol";

export const PROVIDER_INSTALLATION_GATE_TTL_MS = 5 * 60_000;

export interface ProviderInstallationGateKeyArgs {
  providerId: string;
  bridgeLaunch: HostDaemonBridgeLaunch;
  requirement?: ProviderInstallationRequirement;
}

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
  let generation = 0;

  function probeInstallation(
    key: string,
    probe: () => Promise<ProviderInstallationStatus>,
  ): Promise<ProviderInstallationStatus> {
    const pending = pendingByKey.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const startedGeneration = generation;
    const started = probe()
      .then(
        (status) => {
          if (startedGeneration !== generation) {
            return probeInstallation(key, probe);
          }
          if (
            (status.installed || status.minimumSupportedVersion === null) &&
            !status.versionUnsupported
          ) {
            settledByKey.set(key, { status, expiresAt: now() + ttlMs });
          } else {
            settledByKey.delete(key);
          }
          return status;
        },
        (error: unknown) => {
          if (startedGeneration !== generation) {
            return probeInstallation(key, probe);
          }
          settledByKey.delete(key);
          throw error;
        },
      )
      .finally(() => {
        if (pendingByKey.get(key) === started) {
          pendingByKey.delete(key);
        }
      });
    pendingByKey.set(key, started);
    return started;
  }

  const run: ProviderInstallationGate["run"] = (key, probe) => {
    const settled = settledByKey.get(key);
    if (settled === undefined) {
      return probeInstallation(key, probe);
    }
    if (settled.expiresAt <= now()) {
      probeInstallation(key, probe).catch(() => {});
    }
    return Promise.resolve(settled.status);
  };

  return {
    clear() {
      generation += 1;
      settledByKey.clear();
      pendingByKey.clear();
    },
    run,
  };
}
