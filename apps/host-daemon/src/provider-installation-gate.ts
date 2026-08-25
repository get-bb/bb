import { bridgeLaunchProcessKey } from "@bb/agent-runtime";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type {
  ProviderInstallationRequirement,
  ProviderInstallationStatus,
} from "@bb/provider-bridge-protocol";

/**
 * How long a remembered probe answer gates thread start and rewind before
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
 * every attempt until it passes. Clearing the gate while a probe is in flight
 * transparently re-runs that probe: callers must not launch against a stale
 * shell environment or fail because invalidation shut down its maintenance
 * runtime. A not-installed answer is stored only when the bridge reports no
 * minimum version: a bridge that enforces one (codex, pi) can turn an install
 * that arrives without a PATH change into an unsupported answer, so its "not
 * installed" is re-probed on every attempt; a bridge that enforces none
 * (Claude Code, ACP) can never reject, and its launcher resolves the executable
 * on its own, so re-probing it is pure cost.
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

  const run: ProviderInstallationGate["run"] = (key, probe) => {
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
      .then(
        (status) => {
          // This answer describes the provider state from before the shell
          // environment or installation changed. Join (or start) the probe
          // for the current generation instead of returning a stale answer.
          if (startedGeneration !== generation) {
            return run(key, probe);
          }
          const settledAt = now();
          // Expired neighbours are swept here rather than on a timer so the
          // map stays bounded without keeping the process alive.
          pruneExpired(settledAt);
          // Bridges report `versionUnsupported: false` for a CLI that is not
          // installed at all. Only a bridge that enforces a minimum version
          // (codex, pi) can turn a too-old CLI installed in the meantime,
          // without a PATH change, into an unsupported answer, so only its
          // not-installed answer is worth forgetting. A bridge that reports
          // `minimumSupportedVersion: null` (Claude Code, ACP) can never
          // reject, and its launcher finds the executable on its own, so its
          // not-installed answer is remembered like a supported one.
          if (
            (status.installed || status.minimumSupportedVersion === null) &&
            !status.versionUnsupported
          ) {
            settledByKey.set(key, { status, expiresAt: settledAt + ttlMs });
          }
          return status;
        },
        (error: unknown) => {
          // Shell-environment refresh deliberately shuts down the old
          // maintenance runtime. The generation, rather than the error text,
          // distinguishes that expected interruption from a real probe error.
          if (startedGeneration !== generation) {
            return run(key, probe);
          }
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
