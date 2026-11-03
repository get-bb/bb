import { getEnvironment, getThread } from "@bb/db";
import { threadProviderModelCatalogStateSchema } from "@bb/domain";
import type { HostDaemonEventEnvelope } from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { getLastProviderThreadId } from "../threads/thread-events.js";

export async function rememberSessionModelCatalog(
  deps: LoggedPendingInteractionWorkSessionDeps,
  entry: HostDaemonEventEnvelope,
): Promise<void> {
  const thread = getThread(deps.db, entry.threadId);
  if (
    thread === null ||
    thread.environmentId === null ||
    entry.event.scope.kind !== "thread" ||
    entry.event.type !== "thread/extensionState/updated" ||
    getLastProviderThreadId(deps, thread.id) !== entry.event.providerThreadId
  ) {
    return;
  }
  const environment = getEnvironment(deps.db, thread.environmentId);
  const provider = deps.providerRegistry.get(thread.providerId);
  const catalog = threadProviderModelCatalogStateSchema.safeParse(
    entry.event.payload,
  );
  if (environment === null || provider === null || !catalog.success) {
    return;
  }
  await deps.lifecycleDedupers.providerModelCatalogs.remember(deps, {
    hostId: environment.hostId,
    provider: provider.info,
    cwd: environment.path,
    ...catalog.data,
  });
}
