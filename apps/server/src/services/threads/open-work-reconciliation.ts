import {
  getPendingInteractionByProviderRequest,
  listActiveProviderPendingInteractionsForHost,
} from "@bb/db";
import type {
  HostDaemonInteractiveRequestKey,
  HostDaemonOpenThreadWork,
} from "@bb/host-daemon-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { settleBackgroundTasksTheDaemonNoLongerRuns } from "./background-task-reconciliation.js";

const PROVIDER_NO_LONGER_WAITING_REASON =
  "The provider stopped waiting for this answer while the host was disconnected";

interface ReconcileDaemonReportedOpenWorkArgs {
  hostId: string;
  openThreadWork: readonly HostDaemonOpenThreadWork[];
  undeliveredEventThreadIds: readonly string[];
}

function providerRequestKey(request: {
  providerId: string | null;
  providerRequestId: string | null;
  providerThreadId: string | null;
}): string {
  return [
    request.providerId,
    request.providerThreadId,
    request.providerRequestId,
  ].join("\0");
}

export function reconcileDaemonReportedOpenWork(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ReconcileDaemonReportedOpenWorkArgs,
): HostDaemonInteractiveRequestKey[] {
  const unsettledThreadIds = new Set(args.undeliveredEventThreadIds);
  settleBackgroundTasksTheDaemonNoLongerRuns(deps, {
    hostId: args.hostId,
    openItemIds: new Set(
      args.openThreadWork.flatMap((work) => work.backgroundItemIds),
    ),
    unsettledThreadIds,
  });
  const reportedRequests = args.openThreadWork.flatMap(
    (work) => work.interactiveRequests,
  );
  interruptQuestionsTheProviderNoLongerAsks(deps, {
    hostId: args.hostId,
    reportedKeys: new Set(reportedRequests.map(providerRequestKey)),
    unsettledThreadIds,
  });
  return reportedRequests.filter((request) => {
    const interaction = getPendingInteractionByProviderRequest(
      deps.db,
      request,
    );
    return (
      interaction !== null &&
      interaction.status !== "pending" &&
      interaction.status !== "resolving"
    );
  });
}

function interruptQuestionsTheProviderNoLongerAsks(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    hostId: string;
    reportedKeys: ReadonlySet<string>;
    unsettledThreadIds: ReadonlySet<string>;
  },
): void {
  const abandoned = listActiveProviderPendingInteractionsForHost(deps.db, {
    hostId: args.hostId,
  }).filter(
    (interaction) =>
      interaction.status === "pending" &&
      !args.unsettledThreadIds.has(interaction.threadId) &&
      !args.reportedKeys.has(providerRequestKey(interaction)),
  );
  if (abandoned.length === 0) return;
  const notifications = new NotificationBuffer();
  deps.db.transaction(
    (tx) => {
      for (const interaction of abandoned) {
        deps.pendingInteractions.interruptPendingInteractionInTransaction(
          { db: tx, hub: notifications },
          {
            interactionId: interaction.id,
            reason: PROVIDER_NO_LONGER_WAITING_REASON,
          },
        );
      }
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  deps.logger.info(
    {
      hostId: args.hostId,
      interactionIds: abandoned.map((interaction) => interaction.id),
    },
    "Interrupted questions the provider no longer waits on",
  );
}
