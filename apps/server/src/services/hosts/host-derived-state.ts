import { getHost } from "@bb/db";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { isServerMoveFrozen } from "../server-move/freeze-state.js";
import { resolvePluginProviderEnv } from "../plugins/plugin-agent-contributions.js";
import {
  forgetHostDerivedState,
  getProviderInstallations,
} from "../system/provider-installations.js";

interface HostDerivedStateRefresher {
  pending: Set<string>;
  running: Set<string>;
  contributedEnvByHostId: Map<string, string>;
}

const refreshers = new WeakMap<object, HostDerivedStateRefresher>();

function refresherFor(deps: LoggedWorkSessionDeps): HostDerivedStateRefresher {
  let refresher = refreshers.get(deps.hub);
  if (refresher === undefined) {
    refresher = {
      pending: new Set(),
      running: new Set(),
      contributedEnvByHostId: new Map(),
    };
    refreshers.set(deps.hub, refresher);
  }
  return refresher;
}

function canProbeHost(deps: LoggedWorkSessionDeps, hostId: string): boolean {
  const host = getHost(deps.db, hostId);
  return (
    !isServerMoveFrozen(deps.db) &&
    deps.hub.getDaemonSessionIdForHost(hostId) !== null &&
    host !== null &&
    host.destroyedAt === null &&
    host.type !== "ephemeral" &&
    host.phase === "active"
  );
}

async function refreshHost(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<void> {
  forgetHostDerivedState(deps, hostId);
  if (!canProbeHost(deps, hostId)) return;
  await deps.providerRegistry.whenRegistrationsSettled();
  await getProviderInstallations(deps, { hostId, mode: "refresh" });
}

async function drainHost(
  deps: LoggedWorkSessionDeps,
  refresher: HostDerivedStateRefresher,
  hostId: string,
): Promise<void> {
  refresher.running.add(hostId);
  try {
    while (refresher.pending.delete(hostId)) {
      try {
        await refreshHost(deps, hostId);
      } catch (error) {
        deps.logger.warn(
          { hostId, ...runtimeErrorLogFields(deps.config, error) },
          "Host-derived state refresh failed",
        );
      }
    }
  } finally {
    refresher.running.delete(hostId);
  }
}

export function requestHostDerivedStateRefresh(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): void {
  const refresher = refresherFor(deps);
  refresher.pending.add(hostId);
  if (!refresher.running.has(hostId)) {
    void drainHost(deps, refresher, hostId);
  }
}

async function contributedEnvFingerprint(
  deps: LoggedWorkSessionDeps,
  hostId: string,
): Promise<string> {
  const providerIds = deps.providerRegistry
    .list()
    .map((registration) => registration.info.id)
    .sort();
  const entries = await Promise.all(
    providerIds.map(async (providerId) => [
      providerId,
      (
        await resolvePluginProviderEnv({
          providerId,
          context: { threadId: null, projectId: null, hostId },
        })
      ).map((entry) => [entry.name, entry.value]),
    ]),
  );
  return JSON.stringify(entries);
}

function recordContributedEnv(
  deps: LoggedWorkSessionDeps,
  hostId: string,
  refreshIfChanged: boolean,
): void {
  const refresher = refresherFor(deps);
  void contributedEnvFingerprint(deps, hostId).then(
    (fingerprint) => {
      const previous = refresher.contributedEnvByHostId.get(hostId);
      refresher.contributedEnvByHostId.set(hostId, fingerprint);
      if (
        refreshIfChanged &&
        previous !== undefined &&
        previous !== fingerprint
      ) {
        requestHostDerivedStateRefresh(deps, hostId);
      }
    },
    (error: unknown) => {
      deps.logger.warn(
        { hostId, ...runtimeErrorLogFields(deps.config, error) },
        "Could not resolve plugin-contributed provider env",
      );
    },
  );
}

export function requestHostDerivedStateRefreshForPluginChange(
  deps: LoggedWorkSessionDeps,
): void {
  for (const hostId of deps.hub.listConnectedHostIds()) {
    recordContributedEnv(deps, hostId, true);
  }
}

export function installHostDerivedStateBaseline(deps: LoggedWorkSessionDeps): {
  stop(): void;
} {
  const unsubscribe = deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "host" &&
      message.changes.includes("host-connected")
    ) {
      recordContributedEnv(deps, message.id, false);
    }
  });
  for (const hostId of deps.hub.listConnectedHostIds()) {
    recordContributedEnv(deps, hostId, false);
  }
  return { stop: unsubscribe };
}
