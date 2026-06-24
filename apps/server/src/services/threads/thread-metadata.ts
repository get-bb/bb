import { getEnvironment } from "@bb/db";
import type { Environment, Thread, ThreadEventRow } from "@bb/domain";
import type {
  ThreadEventMetadataCategory,
  ThreadMetadataPullRequest,
  ThreadMetadataResponse,
  ThreadMetadataSpawn,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";
import { assembleThreadPullRequest } from "../environments/pull-request.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";
import { listThreadEventRows } from "./thread-data.js";

interface MutableEventMetadataCategory {
  eventCount: number;
  eventSeqs: Set<number>;
  eventType: string;
  keys: Set<string>;
  metadataObjectCount: number;
  source: string;
}

type ClientTurnRequestedEventRow = Extract<
  ThreadEventRow,
  { type: "client/turn/requested" }
>;

function isClientTurnRequestedEvent(
  event: ThreadEventRow,
): event is ClientTurnRequestedEventRow {
  return event.type === "client/turn/requested";
}

function emptySpawnMetadata(): ThreadMetadataSpawn {
  return {
    eventSeq: null,
    requestedAt: null,
    source: null,
    initiator: null,
    senderThreadId: null,
    target: null,
    requestMethod: null,
    execution: null,
  };
}

function addMetadataCategoryObject(
  categories: Map<string, MutableEventMetadataCategory>,
  args: {
    eventSeq: number;
    eventType: string;
    metadata: Record<string, unknown>;
    source: string;
  },
): void {
  let category = categories.get(args.source);
  if (!category) {
    category = {
      eventCount: 0,
      eventSeqs: new Set(),
      eventType: args.eventType,
      keys: new Set(),
      metadataObjectCount: 0,
      source: args.source,
    };
    categories.set(args.source, category);
  }

  if (!category.eventSeqs.has(args.eventSeq)) {
    category.eventSeqs.add(args.eventSeq);
    category.eventCount += 1;
  }
  category.metadataObjectCount += 1;
  for (const key of Object.keys(args.metadata)) {
    category.keys.add(key);
  }
}

function buildEventMetadataCategory(
  category: MutableEventMetadataCategory,
): ThreadEventMetadataCategory {
  return {
    source: category.source,
    eventType: category.eventType,
    eventCount: category.eventCount,
    metadataObjectCount: category.metadataObjectCount,
    keys: [...category.keys].sort(),
  };
}

function apiErrorMessage(error: ApiError): string {
  return error.body.message;
}

function notApplicablePullRequest(args: {
  message: string;
  source: ThreadMetadataPullRequest["source"];
}): ThreadMetadataPullRequest {
  return {
    status: "not_applicable",
    source: args.source,
    pullRequest: null,
    message: args.message,
  };
}

async function resolveThreadPullRequest(
  deps: AppDeps,
  environment: Environment | null,
): Promise<ThreadMetadataPullRequest> {
  if (!environment) {
    return notApplicablePullRequest({
      source: null,
      message: "Thread has no environment",
    });
  }

  const source: ThreadMetadataPullRequest["source"] = "environment-branch";

  if (environment.status !== "ready") {
    return notApplicablePullRequest({
      source,
      message: "Thread environment is not ready",
    });
  }

  if (!environment.isGitRepo) {
    return notApplicablePullRequest({
      source,
      message: "Thread environment is not a Git repository",
    });
  }

  if (!environment.path) {
    return notApplicablePullRequest({
      source,
      message: "Thread environment has no workspace path",
    });
  }

  const target = requireWorkspaceCommandTarget(environment);
  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.pull_request",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
      },
    });
    const pullRequest = assembleThreadPullRequest(result.pullRequest);
    return {
      status: pullRequest ? "available" : "not_found",
      source,
      pullRequest,
      message: null,
    };
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    return {
      status: "unavailable",
      source,
      pullRequest: null,
      message: apiErrorMessage(error),
    };
  }
}

export async function buildThreadMetadataResponse(
  deps: AppDeps,
  thread: Thread,
): Promise<ThreadMetadataResponse> {
  const environment = thread.environmentId
    ? getEnvironment(deps.db, thread.environmentId)
    : null;
  const events = listThreadEventRows(deps.db, { threadId: thread.id });
  const turnRequestEvents = events.filter(isClientTurnRequestedEvent);
  const spawnEvent =
    turnRequestEvents.find(
      (event) =>
        event.data.source === "spawn" &&
        event.data.target.kind === "thread-start",
    ) ??
    turnRequestEvents.find((event) => event.data.source === "spawn");

  const metadataCategories = new Map<string, MutableEventMetadataCategory>();
  const eventsWithMetadata = new Set<number>();
  let metadataObjectCount = 0;

  for (const event of events) {
    if (event.type === "system/operation" && event.data.metadata) {
      addMetadataCategoryObject(metadataCategories, {
        eventSeq: event.seq,
        eventType: event.type,
        metadata: event.data.metadata,
        source: "system/operation.data.metadata",
      });
      eventsWithMetadata.add(event.seq);
      metadataObjectCount += 1;
    }

    if (event.type === "system/thread-provisioning") {
      for (const entry of event.data.entries) {
        if (!entry.metadata) {
          continue;
        }
        addMetadataCategoryObject(metadataCategories, {
          eventSeq: event.seq,
          eventType: event.type,
          metadata: entry.metadata,
          source: "system/thread-provisioning.data.entries[].metadata",
        });
        eventsWithMetadata.add(event.seq);
        metadataObjectCount += 1;
      }
    }
  }

  return {
    thread: toThreadResponseFromThread(deps, { thread }),
    environment,
    spawn: spawnEvent
      ? {
          eventSeq: spawnEvent.seq,
          requestedAt: spawnEvent.createdAt,
          source: spawnEvent.data.source,
          initiator: spawnEvent.data.initiator,
          senderThreadId: spawnEvent.data.senderThreadId,
          target: spawnEvent.data.target,
          requestMethod: spawnEvent.data.request.method,
          execution: spawnEvent.data.execution,
        }
      : emptySpawnMetadata(),
    timestamps: {
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      archivedAt: thread.archivedAt,
      pinnedAt: thread.pinnedAt,
      firstEventAt: events[0]?.createdAt ?? null,
      lastEventAt: events.at(-1)?.createdAt ?? null,
    },
    eventMetadata: {
      totalEventCount: events.length,
      eventsWithMetadataCount: eventsWithMetadata.size,
      metadataObjectCount,
      categories: [...metadataCategories.values()]
        .map((category) => buildEventMetadataCategory(category))
        .sort((a, b) => a.source.localeCompare(b.source)),
    },
    pullRequest: await resolveThreadPullRequest(deps, environment),
  };
}
