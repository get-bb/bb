import type { Hono } from "hono";
import { hc } from "hono/client";
import {
  ENVIRONMENT_CHANGE_KINDS,
  hostTypeSchema,
  pendingInteractionCreateSchema,
  pendingInteractionStatusSchema,
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
  HostDaemonOnlineRpcCommandType,
  HostDaemonSettledCommandType,
} from "./commands.js";
import {
  hostDaemonOnlineRpcResultSchemaByType,
  hostDaemonCommandResultSchemaByType,
  hostDaemonSettledCommandTypeSchema,
  hostDaemonRpcCommandSchema,
  hostDaemonRpcCommandTypeSchema,
  workspaceContextSchema,
} from "./commands.js";

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

export const hostDaemonWatchSetWorkspaceTargetSchema = z
  .object({
    environmentId: z.string().min(1),
    workspaceContext: workspaceContextSchema,
  })
  .strict();
export type HostDaemonWatchSetWorkspaceTarget = z.infer<
  typeof hostDaemonWatchSetWorkspaceTargetSchema
>;

export const hostDaemonWatchSetThreadStorageTargetSchema = z
  .object({
    environmentId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();
export type HostDaemonWatchSetThreadStorageTarget = z.infer<
  typeof hostDaemonWatchSetThreadStorageTargetSchema
>;

export const hostDaemonWatchSetSchema = z
  .object({
    generation: z.number().int().nonnegative(),
    workspaceTargets: z.array(hostDaemonWatchSetWorkspaceTargetSchema),
    threadStorageTargets: z.array(hostDaemonWatchSetThreadStorageTargetSchema),
  })
  .strict();
export type HostDaemonWatchSet = z.infer<typeof hostDaemonWatchSetSchema>;

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

export const hostDaemonEnrollKeyRequestSchema = z
  .object({
    hostId: z.string().min(1).optional(),
  })
  .strict();
export type HostDaemonEnrollKeyRequest = z.infer<
  typeof hostDaemonEnrollKeyRequestSchema
>;

export const hostDaemonEnrollKeyResponseSchema = z
  .object({
    enrollKey: z.string().min(1),
    expiresAt: z.number().int().positive(),
    hostId: z.string().min(1),
  })
  .strict();
export type HostDaemonEnrollKeyResponse = z.infer<
  typeof hostDaemonEnrollKeyResponseSchema
>;

export const hostDaemonSessionOpenResponseSchema = z
  .object({
    sessionId: z.string().min(1),
    heartbeatIntervalMs: z.number().int().positive(),
    leaseTimeoutMs: z.number().int().positive(),
    watchSet: hostDaemonWatchSetSchema.default({
      generation: 0,
      workspaceTargets: [],
      threadStorageTargets: [],
    }),
    retiredEnvironmentIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type HostDaemonSessionOpenResponse = z.infer<
  typeof hostDaemonSessionOpenResponseSchema
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

export const hostDaemonEventEnvelopeSchema = z
  .object({
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
    eventIndex: z.number().int().nonnegative(),
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
          eventIndex: z.number().int().nonnegative(),
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
    command: hostDaemonRpcCommandSchema,
  })
  .strict();

const hostDaemonWatchSetReplaceMessageSchema = hostDaemonWatchSetSchema
  .extend({
    type: z.literal("watch-set.replace"),
  })
  .strict();
export type HostDaemonWatchSetReplaceMessage = z.infer<
  typeof hostDaemonWatchSetReplaceMessageSchema
>;

const hostDaemonOnlineRpcResponseSuccessBaseSchema = z
  .object({
    type: z.literal("host-rpc.response"),
    requestId: hostDaemonOnlineRpcRequestIdSchema,
    ok: z.literal(true),
  })
  .strict();

function onlineRpcResponseSuccessSchemaFor<
  TType extends HostDaemonOnlineRpcCommandType,
>(commandType: TType) {
  return hostDaemonOnlineRpcResponseSuccessBaseSchema.extend({
    commandType: z.literal(commandType),
    result: hostDaemonOnlineRpcResultSchemaByType[commandType],
  });
}

function commandRpcResponseSuccessSchemaFor<
  TType extends HostDaemonSettledCommandType,
>(commandType: TType) {
  return hostDaemonOnlineRpcResponseSuccessBaseSchema.extend({
    commandType: z.literal(commandType),
    result:
      hostDaemonCommandResultSchemaByType[
        hostDaemonSettledCommandTypeSchema.parse(commandType)
      ],
  });
}

const hostDaemonOnlineRpcResponseSuccessSchema = z.discriminatedUnion(
  "commandType",
  [
    onlineRpcResponseSuccessSchemaFor("host.list_files"),
    onlineRpcResponseSuccessSchemaFor("host.list_paths"),
    onlineRpcResponseSuccessSchemaFor("host.browse_directory"),
    onlineRpcResponseSuccessSchemaFor("host.paths_exist"),
    onlineRpcResponseSuccessSchemaFor("host.pick_folder"),
    onlineRpcResponseSuccessSchemaFor("host.list_commands"),
    onlineRpcResponseSuccessSchemaFor("host.file_metadata"),
    onlineRpcResponseSuccessSchemaFor("host.list_branches"),
    onlineRpcResponseSuccessSchemaFor("host.read_file"),
    onlineRpcResponseSuccessSchemaFor("host.read_file_relative"),
    onlineRpcResponseSuccessSchemaFor("host.write_file"),
    onlineRpcResponseSuccessSchemaFor("provider.list_models"),
    onlineRpcResponseSuccessSchemaFor("known_acp_agents.status"),
    onlineRpcResponseSuccessSchemaFor("provider.usage"),
    onlineRpcResponseSuccessSchemaFor("provider_cli.status"),
    onlineRpcResponseSuccessSchemaFor("provider_cli.install"),
    onlineRpcResponseSuccessSchemaFor("workspace.status"),
    onlineRpcResponseSuccessSchemaFor("workspace.diff"),
    onlineRpcResponseSuccessSchemaFor("workspace.diffFiles"),
    onlineRpcResponseSuccessSchemaFor("workspace.diffPatch"),
    onlineRpcResponseSuccessSchemaFor("workspace.pull_request"),
    commandRpcResponseSuccessSchemaFor("thread.start"),
    commandRpcResponseSuccessSchemaFor("turn.submit"),
    commandRpcResponseSuccessSchemaFor("thread.stop"),
    commandRpcResponseSuccessSchemaFor("thread.rename"),
    commandRpcResponseSuccessSchemaFor("thread.archive"),
    commandRpcResponseSuccessSchemaFor("thread.unarchive"),
    commandRpcResponseSuccessSchemaFor("interactive.resolve"),
    commandRpcResponseSuccessSchemaFor("codex.inference.complete"),
    commandRpcResponseSuccessSchemaFor("codex.voice.transcribe"),
    commandRpcResponseSuccessSchemaFor("environment.provision"),
    commandRpcResponseSuccessSchemaFor("environment.provision.cancel"),
    commandRpcResponseSuccessSchemaFor("environment.destroy"),
    commandRpcResponseSuccessSchemaFor("workspace.commit"),
    commandRpcResponseSuccessSchemaFor("workspace.squash_merge"),
    commandRpcResponseSuccessSchemaFor("workspace.pull_request_action"),
  ],
);

const hostDaemonOnlineRpcResponseFailureSchema = z
  .object({
    type: z.literal("host-rpc.response"),
    requestId: hostDaemonOnlineRpcRequestIdSchema,
    commandType: hostDaemonRpcCommandTypeSchema,
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

const hostDaemonTerminalOpenTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace"),
      environmentId: z.string().min(1),
      workspaceContext: workspaceContextSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("host_path"),
      cwd: z.string().min(1).nullable(),
    })
    .strict(),
]);

const hostDaemonTerminalOpenMessageSchema = z
  .object({
    type: z.literal("terminal.open"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    threadId: z.string().min(1).optional(),
    target: hostDaemonTerminalOpenTargetSchema,
    cols: terminalColsSchema,
    rows: terminalRowsSchema,
    start: z
      .discriminatedUnion("mode", [
        z
          .object({
            mode: z.literal("shell"),
          })
          .strict(),
        z
          .object({
            mode: z.literal("command"),
            command: z.string().min(1),
          })
          .strict(),
      ])
      .default({ mode: "shell" }),
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
      type: z.literal("session-close"),
      reason: hostDaemonSessionCloseReasonSchema,
    })
    .strict(),
  hostDaemonOnlineRpcRequestMessageSchema,
  hostDaemonWatchSetReplaceMessageSchema,
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

const hostDaemonTerminalOpenedMessageSchema = z
  .object({
    type: z.literal("terminal.opened"),
    requestId: terminalRequestIdSchema,
    terminalId: terminalIdSchema,
    shell: z.string().min(1),
    title: z.string().min(1),
    initialCwd: z.string().min(1),
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
  "/hosts/enroll-key": {
    /** Used by the local launcher to request one-time bootstrap material for the primary host daemon. */
    $post: Endpoint<
      { json: HostDaemonEnrollKeyRequest },
      HostDaemonEnrollKeyResponse,
      201
    >;
  };
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
  "/session/project-attachment-content": {
    /** Used by the daemon to fetch uploaded prompt attachment bytes for a specific thread. */
    $get: Endpoint<
      { query: HostDaemonProjectAttachmentContentQuery },
      Uint8Array,
      200,
      "binary"
    >;
  };
  "/session/events": {
    /** Used by the daemon to stream provider events (turn progress, completions, errors) back to the server. */
    $post: Endpoint<
      { json: HostDaemonEventBatchRequest },
      HostDaemonEventBatchResponse
    >;
  };
  "/session/tool-call": {
    /** Used by the daemon to execute server-side tool calls requested by a provider. */
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
