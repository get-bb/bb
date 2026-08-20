import type { ProviderCliKey } from "@bb/host-daemon-contract/local";
import { useCallback, useSyncExternalStore } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  allSystemExecutionOptionsQueryKeyPrefix,
  hostProviderCliStatusQueryKey,
} from "@/lib/query/query-keys";
import type { ProfileClient } from "@/lib/sdk/client-registry";
import { toast } from "@/ui/Toast";
import {
  createProviderCliInstallAccumulator,
  type ProviderCliActionableIssue,
} from "./provider-cli-install";
import {
  createProviderCliInstallStore,
  providerCliInstallJobKey,
  type ProviderCliInstallRecord,
  type ProviderCliInstallSnapshot,
} from "./provider-cli-install-store";

/**
 * The app-wide install runner: one module-level store so an install outlives
 * the screen that started it, bound to each profile's SDK (the job names
 * the profile; the client is registered when the job is started). Success /
 * failure toasts and the status invalidation happen here, not in screens.
 */

const clientsByProfileId = new Map<string, ProfileClient>();

const store = createProviderCliInstallStore({
  run: async (job) => {
    const client = clientsByProfileId.get(job.profileId);
    if (!client) {
      throw new Error("The server this install was started for is gone.");
    }
    const accumulator = createProviderCliInstallAccumulator({
      provider: job.issue.provider,
      command: job.issue.action.command,
    });
    try {
      const events = await client.sdk.hosts.installProviderCli({
        hostId: job.hostId,
        provider: job.issue.provider,
        actionKind: job.issue.action.kind,
      });
      for (const event of events) accumulator.push(event);
    } catch (error) {
      accumulator.fail(error instanceof Error ? error.message : String(error));
    }
    return accumulator.outcome();
  },
  onFinished: (record, job) => {
    const client = clientsByProfileId.get(job.profileId);
    if (client) {
      void client.queryClient.invalidateQueries({
        queryKey: hostProviderCliStatusQueryKey(job.hostId),
      });
      void client.queryClient.invalidateQueries({
        queryKey: allSystemExecutionOptionsQueryKeyPrefix(),
      });
    }
    const verb = record.actionKind === "update" ? "update" : "install";
    if (record.status === "succeeded") {
      toast.success(`${record.displayName} ${verb} finished`, {
        action: {
          label: "View log",
          onClick: () => store.openLog(record.jobKey),
        },
      });
    } else {
      toast.error(`${record.displayName} ${verb} failed`, {
        description: record.message ?? undefined,
        action: {
          label: "View log",
          onClick: () => store.openLog(record.jobKey),
        },
      });
    }
  },
});

export interface StartProviderCliInstallArgs {
  hostId: string;
  issue: ProviderCliActionableIssue;
}

export interface ProviderCliInstallRunner {
  snapshot: ProviderCliInstallSnapshot;
  /** The last run for this server's (host, provider) slot, if any. */
  recordFor: (
    hostId: string,
    provider: ProviderCliKey,
  ) => ProviderCliInstallRecord | null;
  isRunning: (hostId: string, provider: ProviderCliKey) => boolean;
  isQueued: (hostId: string, provider: ProviderCliKey) => boolean;
  startInstall: (args: StartProviderCliInstallArgs) => void;
  openLog: (jobKey: string) => void;
  /** The latest "View log" request for this server, with its record. */
  logRequest: {
    seq: number;
    record: ProviderCliInstallRecord;
  } | null;
}

/** Mirror the install store into React for the active server profile. */
export function useProviderCliInstallRunner(): ProviderCliInstallRunner {
  const client = useProfileClient();
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const profileId = client.profileId;
  const recordFor = useCallback(
    (hostId: string, provider: ProviderCliKey) =>
      store.recordFor(profileId, hostId, provider),
    [profileId],
  );
  const startInstall = useCallback(
    ({ hostId, issue }: StartProviderCliInstallArgs) => {
      clientsByProfileId.set(client.profileId, client);
      store.start({ profileId: client.profileId, hostId, issue });
    },
    [client],
  );
  const requestedRecord =
    snapshot.logRequest === null
      ? null
      : (snapshot.records.get(snapshot.logRequest.jobKey) ?? null);
  const logRequest =
    snapshot.logRequest !== null &&
    requestedRecord !== null &&
    requestedRecord.profileId === profileId
      ? { seq: snapshot.logRequest.seq, record: requestedRecord }
      : null;
  return {
    snapshot,
    recordFor,
    isRunning: (hostId, provider) =>
      snapshot.runningJobKey ===
      providerCliInstallJobKey(profileId, hostId, provider),
    isQueued: (hostId, provider) =>
      store.recordFor(profileId, hostId, provider)?.status === "queued",
    startInstall,
    openLog: store.openLog,
    logRequest,
  };
}
