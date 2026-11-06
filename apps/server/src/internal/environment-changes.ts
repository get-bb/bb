import type {
  HostDaemonEnvironmentChangePayload,
  HostDaemonEnvironmentMetadataChangePayload,
} from "@bb/host-daemon-contract";
import { getEnvironment, getThread, type DbNotifier } from "@bb/db";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import type { AppDeps } from "../types.js";

interface EnvironmentChangeNotificationDeps {
  hub: Pick<DbNotifier, "notifyEnvironment">;
}

interface NotifyDaemonEnvironmentChangeArgs extends HostDaemonEnvironmentChangePayload {
  hostId: string;
}

interface NotifyDaemonThreadStorageChangeArgs {
  hostId: string;
  threadId: string;
}

interface RecordDaemonEnvironmentMetadataChangeArgs extends HostDaemonEnvironmentMetadataChangePayload {
  hostId: string;
}

interface NotifyWorkspaceMutationResultArgs {
  environmentId: string;
  ok: boolean;
}

export function notifyWorkspaceMutationResult(
  deps: EnvironmentChangeNotificationDeps,
  args: NotifyWorkspaceMutationResultArgs,
): void {
  if (!args.ok) {
    return;
  }
  deps.hub.notifyEnvironment(args.environmentId, ["work-status-changed"]);
}

export function notifyDaemonEnvironmentChange(
  deps: Pick<AppDeps, "db" | "hub">,
  args: NotifyDaemonEnvironmentChangeArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    !environment ||
    environment.hostId !== args.hostId ||
    environment.status === "destroyed"
  ) {
    return;
  }

  deps.hub.notifyEnvironment(environment.id, [args.change]);
}

export function notifyDaemonThreadStorageChange(
  deps: Pick<AppDeps, "db" | "hub">,
  args: NotifyDaemonThreadStorageChangeArgs,
): void {
  const thread = getThread(deps.db, args.threadId);
  const environment = thread?.environmentId
    ? getEnvironment(deps.db, thread.environmentId)
    : null;
  if (
    !environment ||
    environment.hostId !== args.hostId ||
    environment.status === "destroyed"
  ) {
    return;
  }

  deps.hub.notifyThread(args.threadId, ["storage-changed"]);
}

export function recordDaemonEnvironmentMetadataChange(
  deps: Pick<AppDeps, "db" | "hub">,
  args: RecordDaemonEnvironmentMetadataChangeArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    !environment ||
    environment.hostId !== args.hostId ||
    environment.status === "destroyed" ||
    environment.path !== args.workspace.path
  ) {
    return;
  }

  recordProvisionedEnvironmentWorkspace(
    deps.db,
    deps.hub,
    environment.id,
    args.workspace,
  );
}
