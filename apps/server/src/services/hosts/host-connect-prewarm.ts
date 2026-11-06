import { getHost } from "@bb/db";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { isServerMoveFrozen } from "../server-move/freeze-state.js";

export interface HostConnectPrewarmPass {
  hostId: string;
  isCurrent(): boolean;
}

export function installHostConnectPrewarm(
  deps: LoggedWorkSessionDeps,
  args: {
    failureMessage: string;
    runPass(pass: HostConnectPrewarmPass): Promise<void>;
  },
): { stop(): void } {
  const pendingHosts = new Set<string>();
  const runningHosts = new Set<string>();
  let stopped = false;

  function request(hostId: string): void {
    if (stopped) {
      return;
    }
    pendingHosts.add(hostId);
    if (!runningHosts.has(hostId)) {
      void runPasses(hostId);
    }
  }

  async function runPasses(hostId: string): Promise<void> {
    runningHosts.add(hostId);
    try {
      while (!stopped && pendingHosts.delete(hostId)) {
        try {
          await runPass(hostId);
        } catch (error) {
          deps.logger.error(
            { hostId, ...runtimeErrorLogFields(deps.config, error) },
            args.failureMessage,
          );
        }
      }
    } finally {
      runningHosts.delete(hostId);
    }
  }

  async function runPass(hostId: string): Promise<void> {
    await deps.providerRegistry.whenRegistrationsSettled();
    const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
    const host = getHost(deps.db, hostId);
    if (
      stopped ||
      isServerMoveFrozen(deps.db) ||
      sessionId === null ||
      host === null ||
      host.destroyedAt !== null ||
      host.type === "ephemeral" ||
      host.phase !== "active"
    ) {
      return;
    }
    await args.runPass({
      hostId,
      isCurrent: () =>
        !stopped &&
        !isServerMoveFrozen(deps.db) &&
        deps.hub.getDaemonSessionIdForHost(hostId) === sessionId,
    });
  }

  const unsubscribe = deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "host" &&
      message.changes.includes("host-connected")
    ) {
      request(message.id);
    } else if (
      message.entity === "system" &&
      message.changes.includes("provider-registrations-changed")
    ) {
      for (const hostId of deps.hub.listConnectedHostIds()) {
        request(hostId);
      }
    }
  });
  for (const hostId of deps.hub.listConnectedHostIds()) {
    request(hostId);
  }

  return {
    stop() {
      stopped = true;
      unsubscribe();
      pendingHosts.clear();
    },
  };
}
