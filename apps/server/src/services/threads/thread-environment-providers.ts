import { cancelProviderEnvironmentCreation } from "../environments/environment-engine.js";
import { listEnvironmentProviders } from "../plugins/plugin-environment-provider-registry.js";
import {
  clearThreadProvisionSchedule,
  getThreadProvisionContext,
  listThreadProvisionSchedules,
  setThreadProvisionSchedule,
} from "./thread-startup-store.js";
import { advanceThreadProvisioning } from "./thread-provisioning.js";
import type { ThreadProvisioningDeps } from "./thread-provisioning-environment.js";
import { removeCreatingMachine } from "../machines/provider-orchestration.js";

export function scheduleEnvironmentProvisioning(
  deps: ThreadProvisioningDeps,
  threadId: string,
  at: number,
): void {
  const context = getThreadProvisionContext(deps.db, threadId);
  if (context === null || context.request.environmentIntent.type !== "provider")
    return;
  const timer = setTimeout(
    () => {
      clearThreadProvisionSchedule(threadId);
      if (Date.now() < at)
        return scheduleEnvironmentProvisioning(deps, threadId, at);
      void advanceThreadProvisioning(deps, { threadId }).catch((error) =>
        deps.logger.warn({ threadId, error }, "Environment advancement failed"),
      );
    },
    Math.min(Math.max(0, at - Date.now()), 2_147_483_647),
  );
  timer.unref?.();
  setThreadProvisionSchedule(threadId, {
    provisioningId: context.state.provisioningId,
    environmentProviderId:
      context.request.environmentIntent.environmentProviderId,
    timer,
  });
}

export function recheckEnvironmentProviderCreations(
  deps: ThreadProvisioningDeps,
  pluginId: string,
): void {
  const owned = new Set(
    listEnvironmentProviders()
      .filter((record) => record.pluginId === pluginId)
      .map((record) => record.provider.id),
  );
  for (const entry of listThreadProvisionSchedules())
    if (owned.has(entry.environmentProviderId))
      scheduleEnvironmentProvisioning(deps, entry.threadId, Date.now());
}

export function recheckEnvironmentProvisioning(
  deps: ThreadProvisioningDeps,
  threadId: string,
): void {
  scheduleEnvironmentProvisioning(deps, threadId, Date.now());
}

export function scheduledEnvironmentProviderAskCount(): number {
  return listThreadProvisionSchedules().length;
}

export function cancelAbandonedProviderCreations(
  deps: ThreadProvisioningDeps,
  threadId: string,
): void {
  clearThreadProvisionSchedule(threadId);
  void cancelProviderEnvironmentCreation(deps, threadId).catch((error) =>
    deps.logger.warn({ threadId, error }, "Environment cancellation failed"),
  );
  void removeCreatingMachine(deps, threadId).catch((error) =>
    deps.logger.warn({ threadId, error }, "Machine cancellation failed"),
  );
}

export function cancelEnvironmentProviderCreation(
  deps: ThreadProvisioningDeps,
  args: { threadId: string },
): void {
  cancelAbandonedProviderCreations(deps, args.threadId);
}
