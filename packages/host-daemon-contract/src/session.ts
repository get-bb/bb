import type { Hono } from "hono";
import { hc } from "hono/client";
import {
  ENVIRONMENT_CHANGE_KINDS,
  hostDaemonProducerEventIdSchema,
  hostTypeSchema,
  jsonValueSchema,
  pendingInteractionCreateSchema,
  pendingInteractionStatusSchema,
  appDataPathSchema,
  applicationIdSchema,
  terminalColsSchema,
  terminalDataBase64Schema,
  terminalRowsSchema,
  threadEventSchema,
  toolCallRequestSchema,
  toolCallResponseSchema,
} from "@bb/domain";
import { z } from "zod";
import type { Endpoint } from "./common.js";
import type {
  HostDaemonCommandResultReport,
  HostDaemonOnlineRpcCommandType,
} from "./commands.js";
import {
  hostDaemonOnlineRpcCommandSchema,
  hostDaemonOnlineRpcCommandTypeSchema,
  hostDaemonOnlineRpcResultSchemaByType,
  hostDaemonCommandEnvelopeSchema,
  workspaceContextSchema,
} from "./commands.js";

const nonNegativeIntegerStringSchema = z.string().regex(/^\d+$/);
export const HOST_DAEMON_WEBSOCKET_PROTOCOL = "bb-host-daemon.v1";

export const hostDaemonActiveThreadSchema = z.object({
  threadId: z.string().min(1),
});
export type HostDaemonActiveThread = z.infer<
  typeof hostDaemonActiveThreadSchema
>;

export const hostDaemonLoadedEnvironmentSchema = z.object({
  environmentId: z.string().min(1),
});
export type HostDaemonLoadedEnvironment = z.infer<
  typeof hostDaemonLoadedEnvironmentSchema
>;

export const hostDaemonTrackedThreadTargetSchema = z.object({
  environmentId: z.string().min(1),
  threadId: z.string().min(1),
});
export type HostDaemonTrackedThreadTarget = z.infer<
  typeof hostDaemonTrackedThreadTargetSchema
>;

export const hostDaemonTrackedApplicationDataTargetSchema = z.object({
  applicationId: applicationIdSchema,
  appDataPath: z.string().min(1),
});
export type HostDaemonTrackedApplicationDataTarget = z.infer<
  typeof hostDaemonTrackedApplicationDataTargetSchema
>;

export const hostDaemonSessionOpenRequestSchema = z.object({
  hostId: z.string().min(1),
  instanceId: z.string().min(1),
  hostName: z.string().min(1),
  hostType: hostTypeSchema,
  dataDir: z.string().min(1),
  // Accept any version at the schema boundary so the server can return an
  // actionable protocol mismatch instead of an opaque validation failure.
  protocolVersion: z.number().int().positive(),
  activeThreads: z.array(hostDaemonActiveThreadSchema),
  loadedEnvironments: z.array(hostDaemonLoadedEnvironmentSchema).default([]),
});
export type HostDaemonSessionOpenRequest = z.input<
  typeof hostDaemonSessionOpenRequestSchema
>;

export const hostDaemonEnrollRequestSchema = z
  .object({
    hostId: z.string().min(1),
    hostName: z.string().min(1),
    hostType: hostTypeSchema,
  })
  .strict();
export type HostDaemonEnrollRequest = z.infer<
  typeof hostDaemonEnrollRequestSchema
>;

export const hostDaemonEnrollResponseSchema = z
  .object({
    hostId: z.string().min(1),
    hostKey: z.string().min(1),
  })
  .strict();
export type HostDaemonEnrollResponse = z.infer<
  typeof hostDaemonEnrollResponseSchema
>;

export const hostDaemonSessionOpenResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    heartbeatIntervalMs: z.number().int().positive(),
    leaseTimeoutMs: z.number().int().positive(),
    trackedThreadTargets: z.array(hostDaemonTrackedThreadTargetSchema),
    trackedApplicationDataTargets: z.array(
      hostDaemonTrackedApplicationDataTargetSchema,
    ),
    retiredEnvironmentIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type HostDaemonSessionOpenResponse = z.infer<
  typeof hostDaemonSessionOpenResponseSchema
>;

export const hostDaemonCommandsQuerySchema = z.object({
  sessionId: z.string().min(1),
  limit: nonNegativeIntegerStringSchema,
  waitMs: nonNegativeIntegerStringSchema,
});
export type HostDaemonCommandsQuery = z.infer<
  typeof hostDaemonCommandsQuerySchema
>;

export const hostDaemonProjectAttachmentContentQuerySchema = z.object({
  sessionId: z.string().min(1),
  threadId: z.string().min(1),
  projectId: z.string().min(1),
  path: z.string().min(1),
});
export type HostDaemonProjectAttachmentContentQuery = z.infer<
  typeof hostDaemonProjectAttachmentContentQuerySchema
>;

export const hostDaemonCommandBatchSchema = z.object({
  commands: z.array(hostDaemonCommandEnvelopeSchema),
});
export type HostDaemonCommandBatch = z.infer<
  typeof hostDaemonCommandBatchSchema
>;

export const hostDaemonEventEnvelopeSchema = z
  .object({
    producerEventId: hostDaemonProducerEventIdSchema,
    threadId: z.string().min(1),
    event: threadEventSchema,
  })
  .strict();
export type HostDaemonEventEnvelope = z.infer<
  typeof hostDaemonEventEnvelopeSchema
>;

export const hostDaemonEventBatchRequestSchema = z.object({
  sessionId: z.string().min(1),
  events: z.array(hostDaemonEventEnvelopeSchema),
});
export type HostDaemonEventBatchRequest = z.infer<
  typeof hostDaemonEventBatchRequestSchema
>;

export const hostDaemonEventRejectionReasonSchema = z.enum([
  "thread_not_owned_by_host",
]);

export const hostDaemonRejectedEventSchema = z
  .object({
    producerEventId: hostDaemonProducerEventIdSchema,
    threadId: z.string().min(1),
    reason: hostDaemonEventRejectionReasonSchema,
  })
  .strict();
export type HostDaemonRejectedEvent = z.infer<
  typeof hostDaemonRejectedEventSchema
>;

export const hostDaemonEventBatchResponseSchema = z
  .object({
    acceptedEvents: z.array(
      z
        .object({
          producerEventId: hostDaemonProducerEventIdSchema,
          threadId: z.string().min(1),
          sequence: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    rejectedEvents: z.array(hostDaemonRejectedEventSchema),
  })
  .strict();
export type HostDaemonEventBatchResponse = z.infer<
  typeof hostDaemonEventBatchResponseSchema
>;

export const hostDaemonCommandResultResponseSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();
export type HostDaemonCommandResultResponse = z.infer<
  typeof hostDaemonCommandResultResponseSchema
>;

export const hostDaemonEnvironmentChangeSchema = z
  .enum(ENVIRONMENT_CHANGE_KINDS)
  .extract([
    "work-status-changed",
    "git-refs-changed",
    "thread-storage-changed",
  ]);
export type HostDaemonEnvironmentChange = z.infer<
  typeof hostDaemonEnvironmentChangeSchema
>;

export const hostDaemonEnvironmentChangePayloadSchema = z.object({
  environmentId: z.string().min(1),
  change: hostDaemonEnvironmentChangeSchema,
});
export type HostDaemonEnvironmentChangePayload = z.infer<
  typeof hostDaemonEnvironmentChangePayloadSchema
>;

const hostDaemonAppDataChangePayloadBaseSchema = z
  .object({
    applicationId: applicationIdSchema,
    path: appDataPathSchema,
    value: jsonValueSchema.nullable(),
    deleted: z.boolean(),
    version: z.string().min(1).nullable(),
  })
  .strict();
type HostDaemonAppDataChangePayloadBase = z.infer<
  typeof hostDaemonAppDataChangePayloadBaseSchema
>;

function validateHostDaemonAppDataChangePayload(
  payload: HostDaemonAppDataChangePayloadBase,
  context: z.RefinementCtx,
): void {
  if (payload.deleted && payload.version !== null) {
    context.addIssue({
      code: "custom",
      path: ["version"],
      message: "version must be null for deleted app data changes",
    });
  }
  if (!payload.deleted && payload.version === null) {
    context.addIssue({
      code: "custom",
      path: ["version"],
      message: "version is required for non-deleted app data changes",
    });
  }
}

export const hostDaemonAppDataChangePayloadSchema =
  hostDaemonAppDataChangePayloadBaseSchema.superRefine(
    validateHostDaemonAppDataChangePayload,
  );
export type HostDaemonAppDataChangePayload = z.infer<
  typeof hostDaemonAppDataChangePayloadSchema
>;

export const hostDaemonAppDataChangeRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    ...hostDaemonAppDataChangePayloadBaseSchema.shape,
  })
  .strict()
  .superRefine(validateHostDaemonAppDataChangePayload);
export type HostDaemonAppDataChangeRequest = z.infer<
  typeof hostDaemonAppDataChangeRequestSchema
>;

export const hostDaemonAppDataResyncPayloadSchema = z
  .object({
    applicationId: applicationIdSchema,
  })
  .strict();
export type HostDaemonAppDataResyncPayload = z.infer<
  typeof hostDaemonAppDataResyncPayloadSchema
>;

export const hostDaemonAppDataResyncRequestSchema =
  hostDaemonAppDataResyncPayloadSchema
    .extend({
      sessionId: z.string().min(1),
    })
    .strict();
export type HostDaemonAppDataResyncRequest = z.infer<
  typeof hostDaemonAppDataResyncRequestSchema
>;

export const hostDaemonSessionCloseReasonSchema = z.enum([
  "replaced",
  "expired",
  "daemon-disconnect",
]);
export type HostDaemonSessionCloseReason = z.infer<
  typeof hostDaemonSessionCloseReasonSchema
>;

const terminalIdSchema = z.string().min(1);
const terminalRequestIdSchema = z.string().min(1);
const terminalCloseReasonSchema = z.enum([
  "user",
  "process-exit",
  "daemon-disconnect",
  "environment-destroyed",
  "thread-archived",
  "thread-deleted",
  "open-timeout",
]);
const hostDaemonOnlineRpcRequestIdSchema = z.string().min(1);

const hostDaemonOnlineRpcRequestMessageSchema = z
  .object({
    type: z.literal("host-rpc.request"),
    requestId: hostDaemonOnlineRpcRequestIdSchema,
    command: hostDaemonOnlineRpcCommandSchema,
  })
  .strict();

const hostDaemonOnlineRpcResponseSuccessBaseSchema = z
  .object({
    type: z.literal("host-rpc.response"),
    requestId: hostDaemonOnlineRpcRequestIdSchema,
    ok: z.literal(true),
  })
  .strict();

function rpcResponseSuccessSchemaFor<TType extends HostDaemonOnlineRpcCommandType>(
  commandType: TType,
) {
  return hostDaemonOnlineRpcResponseSuccessBaseSchema.extend({
    commandType: z.literal(commandType),
    result: hostDaemonOnlineRpcResultSchemaByType[commandType],
  });
}

const hostDaemonOnlineRpcResponseSuccessSchema = z.discriminatedUnion(
  "commandType",
  [
    rpcResponseSuccessSchemaFor("development.replay"),
    rpcResponseSuccessSchemaFor("host.list_files"),
    rpcResponseSuccessSchemaFor("host.list_paths"),
    rpcResponseSuccessSchemaFor("host.file_metadata"),
    rpcResponseSuccessSchemaFor("host.list_branches"),
    rpcResponseSuccessSchemaFor("host.read_file"),
    rpcResponseSuccessSchemaFor("host.read_file_relative"),
    rpcResponseSuccessSchemaFor("provider.list"),
    rpcResponseSuccessSchemaFor("provider.list_models"),
    rpcResponseSuccessSchemaFor("workspace.status"),
    rpcResponseSuccessSchemaFor("workspace.diff"),
  ],
);

const hostDaemonOnlineRpcResponseFailureSchema = z
  .object({
    type: z.literal("host-rpc.response"),
    requestId: hostDaemonOnlineRpcRequestIdSchema,
    commandType: hostDaemonOnlineRpcCommandTypeSchema,
    ok: z.literal(false),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
  })
  .strict();

export const hostDaemonOnlineRpcResponseMessageSchema = z.union([
  hostDaemonOnlineRpcResponseSuccessSchema,
  hostDaemonOnlineRpcResponseFailureSchema,
]);
export type HostDaemonOnlineRpcResponseMessage = z.infer<
  typeof hostDaemonOnlineRpcResponseMessageSchema
>;

export type HostDaemonOnlineRpcRequestMessage = z.infer<
  typeof hostDaemonOnlineRpcRequestMessageSchema
>;

export const hostDaemonTerminalOutputChunkSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    dataBase64: terminalDataBase64Schema,
  })
  .strict();

const hostDaemonTerminalOpenMessageSchema = z
  .object({
    type: z.literal("terminal.open"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    threadId: z.string().min(1),
    environmentId: z.string().min(1),
    workspaceContext: workspaceContextSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalAttachMessageSchema = z
  .object({
    type: z.literal("terminal.attach"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    sinceSeq: z.number().int().nonnegative(),
  })
  .strict();

const hostDaemonTerminalInputMessageSchema = z
  .object({
    type: z.literal("terminal.input"),
    terminalId: terminalIdSchema,
    dataBase64: terminalDataBase64Schema,
  })
  .strict();

const hostDaemonTerminalResizeMessageSchema = z
  .object({
    type: z.literal("terminal.resize"),
    terminalId: terminalIdSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalCloseMessageSchema = z
  .object({
    type: z.literal("terminal.close"),
    terminalId: terminalIdSchema,
    reason: terminalCloseReasonSchema,
  })
  .strict();

export const hostDaemonServerWsMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("commands-available"),
    })
    .strict(),
  z
    .object({
      type: z.literal("session-close"),
      reason: hostDaemonSessionCloseReasonSchema,
    })
    .strict(),
  hostDaemonOnlineRpcRequestMessageSchema,
  hostDaemonTerminalOpenMessageSchema,
  hostDaemonTerminalAttachMessageSchema,
  hostDaemonTerminalInputMessageSchema,
  hostDaemonTerminalResizeMessageSchema,
  hostDaemonTerminalCloseMessageSchema,
]);
export type HostDaemonServerWsMessage = z.infer<
  typeof hostDaemonServerWsMessageSchema
>;

const hostDaemonHeartbeatMessageSchema = z
  .object({
    type: z.literal("heartbeat"),
  })
  .strict();

const hostDaemonEnvironmentChangeMessageSchema =
  hostDaemonEnvironmentChangePayloadSchema
    .extend({
      type: z.literal("environment-change"),
    })
    .strict();

const hostDaemonApplicationStorageChangedMessageSchema = z
  .object({
    type: z.literal("application-storage-changed"),
  })
  .strict();

/**
 * Raw host observation that an app's served `public/` files changed on disk.
 * The daemon reports the fact; the server decides how to surface it (it
 * broadcasts a per-app `content-changed` realtime message so open app
 * surfaces live-reload).
 */
const hostDaemonApplicationContentChangedMessageSchema = z
  .object({
    type: z.literal("application-content-changed"),
    applicationId: applicationIdSchema,
  })
  .strict();

const hostDaemonTerminalOpenedMessageSchema = z
  .object({
    type: z.literal("terminal.opened"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    shell: z.string().min(1),
    title: z.string().min(1),
    initialCwd: z.string().min(1),
    currentCwd: z.string().min(1).nullable(),
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
  })
  .strict();

const hostDaemonTerminalOutputMessageSchema = z
  .object({
    type: z.literal("terminal.output"),
    terminalId: terminalIdSchema,
    chunk: hostDaemonTerminalOutputChunkSchema,
  })
  .strict();

const hostDaemonTerminalReplayMessageSchema = z
  .object({
    type: z.literal("terminal.replay"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    chunks: z.array(hostDaemonTerminalOutputChunkSchema),
    nextSeq: z.number().int().nonnegative(),
  })
  .strict();

const hostDaemonTerminalExitedMessageSchema = z
  .object({
    type: z.literal("terminal.exited"),
    terminalId: terminalIdSchema,
    exitCode: z.number().int().nullable(),
    closeReason: terminalCloseReasonSchema,
  })
  .strict();

const hostDaemonTerminalErrorMessageSchema = z
  .object({
    type: z.literal("terminal.error"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const hostDaemonDaemonWsMessageSchema = z.union([
  hostDaemonHeartbeatMessageSchema,
  hostDaemonEnvironmentChangeMessageSchema,
  hostDaemonApplicationStorageChangedMessageSchema,
  hostDaemonApplicationContentChangedMessageSchema,
  hostDaemonTerminalOpenedMessageSchema,
  hostDaemonTerminalOutputMessageSchema,
  hostDaemonTerminalReplayMessageSchema,
  hostDaemonTerminalExitedMessageSchema,
  hostDaemonTerminalErrorMessageSchema,
  hostDaemonOnlineRpcResponseMessageSchema,
]);
export type HostDaemonDaemonWsMessage = z.infer<
  typeof hostDaemonDaemonWsMessageSchema
>;

export const hostDaemonToolCallRequestSchema = toolCallRequestSchema
  .pick({
    threadId: true,
    providerThreadId: true,
    turnId: true,
    callId: true,
    tool: true,
    arguments: true,
  })
  .extend({
    sessionId: z.string().min(1),
  });
export type HostDaemonToolCallRequest = z.infer<
  typeof hostDaemonToolCallRequestSchema
>;

export const hostDaemonToolCallResponseSchema = toolCallResponseSchema;
export type HostDaemonToolCallResponse = z.infer<
  typeof hostDaemonToolCallResponseSchema
>;

export const hostDaemonInteractiveRequestSchema = z.object({
  sessionId: z.string().min(1),
  interaction: pendingInteractionCreateSchema,
});
export type HostDaemonInteractiveRequest = z.infer<
  typeof hostDaemonInteractiveRequestSchema
>;

export const hostDaemonInteractiveRequestResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z.object({
      outcome: z.literal("created"),
      interactionId: z.string().min(1),
      status: pendingInteractionStatusSchema,
    }),
    z.object({
      outcome: z.literal("existing"),
      interactionId: z.string().min(1),
      status: pendingInteractionStatusSchema,
    }),
    z.object({
      outcome: z.literal("rejected"),
      reason: z.string().min(1),
    }),
  ],
);
export type HostDaemonInteractiveRequestResponse = z.infer<
  typeof hostDaemonInteractiveRequestResponseSchema
>;

export const hostDaemonInteractiveInterruptRequestSchema = z.object({
  sessionId: z.string().min(1),
  providerId: z.string().min(1),
  threadIds: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1),
});
export type HostDaemonInteractiveInterruptRequest = z.infer<
  typeof hostDaemonInteractiveInterruptRequestSchema
>;

export const hostDaemonInteractiveInterruptResponseSchema = z.object({
  ok: z.literal(true),
  interactionIds: z.array(z.string().min(1)),
});
export type HostDaemonInteractiveInterruptResponse = z.infer<
  typeof hostDaemonInteractiveInterruptResponseSchema
>;

export type HostDaemonInternalSchema = {
  "/hosts/enroll": {
    /** Used by the daemon to exchange bootstrap material for its long-lived host credential. */
    $post: Endpoint<
      { json: HostDaemonEnrollRequest },
      HostDaemonEnrollResponse,
      201
    >;
  };
  "/session/open": {
    /** Used by the daemon to establish a session with the server. Replaces any prior session for the same host. */
    $post: Endpoint<
      { json: HostDaemonSessionOpenRequest },
      HostDaemonSessionOpenResponse,
      201
    >;
  };
  "/session/commands": {
    /** Used by the daemon to fetch pending commands. Supports long-poll via `waitMs`. */
    $get:
      | Endpoint<
          { query: HostDaemonCommandsQuery },
          HostDaemonCommandBatch,
          200
        >
      | Endpoint<{ query: HostDaemonCommandsQuery }, undefined, 204>;
  };
  "/session/project-attachment-content": {
    /** Used by the daemon to fetch uploaded prompt attachment bytes for a specific thread. */
    $get: Endpoint<
      { query: HostDaemonProjectAttachmentContentQuery },
      Uint8Array,
      200,
      "binary"
    >;
  };
  "/session/command-result": {
    /** Used by the daemon to report command completion. */
    $post: Endpoint<
      { json: HostDaemonCommandResultReport },
      HostDaemonCommandResultResponse
    >;
  };
  "/session/events": {
    /** Used by the daemon to stream provider events (turn progress, completions, errors) back to the server. */
    $post: Endpoint<
      { json: HostDaemonEventBatchRequest },
      HostDaemonEventBatchResponse
    >;
  };
  "/session/app-data-change": {
    /** Used by the daemon to report host-local app data file changes for server websocket fan-out. */
    $post: Endpoint<{ json: HostDaemonAppDataChangeRequest }, { ok: true }>;
  };
  "/session/app-data-resync": {
    /** Used by the daemon to request client-side app data resync after reconnect reconciliation. */
    $post: Endpoint<{ json: HostDaemonAppDataResyncRequest }, { ok: true }>;
  };
  "/session/tool-call": {
    /** Used by the daemon to execute server-side tool calls on behalf of a provider (e.g. message_user). */
    $post: Endpoint<
      { json: HostDaemonToolCallRequest },
      HostDaemonToolCallResponse
    >;
  };
  "/session/interactive-request": {
    /** Used by the daemon to persist an interactive provider request before awaiting an interactive.resolve command. */
    $post: Endpoint<
      { json: HostDaemonInteractiveRequest },
      HostDaemonInteractiveRequestResponse
    >;
  };
  "/session/interactive-request/interrupt": {
    /** Used by the daemon to mark blocked interactive requests interrupted when the provider or session dies. */
    $post: Endpoint<
      { json: HostDaemonInteractiveInterruptRequest },
      HostDaemonInteractiveInterruptResponse
    >;
  };
};

export type HostDaemonInternalRoutes = Hono<{}, HostDaemonInternalSchema, "/">;

function parseProtocolHeader(protocolHeader: string | undefined): string[] {
  if (!protocolHeader) {
    return [];
  }

  return protocolHeader
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function buildHostDaemonWebSocketAuthorizationHeader(
  hostKey: string,
): string {
  return `Bearer ${hostKey}`;
}

export function buildHostDaemonWebSocketProtocols(): string[] {
  return [HOST_DAEMON_WEBSOCKET_PROTOCOL];
}

export function hasHostDaemonWebSocketProtocol(
  protocolHeader: string | undefined,
): boolean {
  return parseProtocolHeader(protocolHeader).includes(
    HOST_DAEMON_WEBSOCKET_PROTOCOL,
  );
}

export function createHostDaemonClient(baseUrl: string, hostKey: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const internalBaseUrl = normalizedBaseUrl.endsWith("/internal")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/internal`;
  return hc<HostDaemonInternalRoutes>(internalBaseUrl, {
    headers: {
      authorization: `Bearer ${hostKey}`,
    },
  });
}
