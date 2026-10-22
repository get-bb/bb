import { emitPluginTerminalInput } from "../plugins/plugin-thread-events.js";
import { resolveHostEnvironment } from "../hosts/host-environment.js";
import { randomUUID } from "node:crypto";
import {
  createTerminalSession,
  getSessionById,
  getTerminalSession,
  countTerminalSessions,
  listTerminalSessions,
  updateTerminalSession,
  updateTerminalSessions,
  type TerminalSessionMutation,
  type TerminalSessionRow,
} from "@bb/db";
import type { TerminalSessionCloseReason } from "@bb/domain";
import type {
  HostDaemonDaemonWsMessage,
  HostDaemonServerWsMessage,
  HostDaemonTerminalDataServerMessage,
} from "@bb/host-daemon-contract";
import { HOST_DAEMON_TERMINAL_EXIT_RETENTION_MS } from "@bb/host-daemon-contract/protocol";
import type {
  CloseTerminalRequest,
  CreateTerminalRequest,
  TerminalInputRequest,
  TerminalCreateTarget,
  TerminalListQuery,
  TerminalOutputChunk,
  TerminalOutputQuery,
  TerminalOutputResponse,
  TerminalResizeRequest,
  TerminalSession,
  UpdateTerminalRequest,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps, ServerLogger } from "../../types.js";
import { assertUsableHostId } from "../hosts/primary-host.js";
import {
  requireConnectedHostSession,
  requireEnvironment,
  requirePublicThread,
  requireReadyEnvironment,
} from "../lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import { requireWorkspaceCommandTarget } from "../environments/workspace-command-target.js";
import {
  isServerMoveSnapshotFenced,
  serverMovingError,
} from "../server-move/freeze-state.js";
import {
  type PendingRpcKey,
  PendingRpcRegistry,
} from "./pending-rpc-registry.js";
import {
  terminalRpcKey,
  type TerminalRelayHost,
  type TerminalRelayTerminal,
} from "./terminal-relay.js";
import type { TerminalRelayRouter } from "./terminal-relay-transport.js";

const DEFAULT_TERMINAL_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINAL_START: NonNullable<CreateTerminalRequest["start"]> = {
  mode: "shell",
};
const HOST_HOME_INITIAL_CWD = "~";
const TERMINAL_SCROLLBACK_MAX_BYTES = 4 * 1024 * 1024;
const TERMINAL_EXIT_RETENTION_MINUTES = Math.round(
  HOST_DAEMON_TERMINAL_EXIT_RETENTION_MS / 60_000,
);
const TERMINAL_OUTPUT_NOT_RUNNING_MESSAGE =
  "Terminal output is unavailable because the session is not running";
const TERMINAL_OUTPUT_DISCARDED_MESSAGE = `The host no longer has the output of this exited terminal. Hosts keep terminal output for ${TERMINAL_EXIT_RETENTION_MINUTES} minutes after a terminal exits, so read it sooner or run the command again.`;
const TERMINAL_OUTPUT_HOST_GONE_MESSAGE = `The host session that ran this terminal is no longer connected, so its output is gone. Hosts keep terminal output for ${TERMINAL_EXIT_RETENTION_MINUTES} minutes after a terminal exits and lose it when the host daemon restarts.`;
const DAEMON_OWNED_TERMINAL_STATUSES = ["starting", "running"] as const;
const NON_TERMINAL_SESSION_STATUSES = [
  ...DAEMON_OWNED_TERMINAL_STATUSES,
  "disconnected",
] as const;

type TerminalOpenedMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.opened" }
>;
type TerminalReplayMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.replay" }
>;
type TerminalOutputMessage = Extract<
  HostDaemonDaemonWsMessage,
  { type: "terminal.output" }
>;
type TerminalApiErrorStatus = ConstructorParameters<typeof ApiError>[0];
type RunningBrowserTerminalSession = TerminalSessionRow & {
  daemonSessionId: string;
  status: "running";
};

interface PendingTerminalRpcKey extends PendingRpcKey {
  daemonSessionId: string;
  requestId: string;
  terminalId: string;
}

interface PendingTerminalCloseKey extends PendingRpcKey {
  closeReason: TerminalSessionCloseReason;
  daemonSessionId: string;
  terminalId: string;
}

interface RejectPendingOpenForTerminalArgs {
  code: string;
  daemonSessionId: string;
  message: string;
  status: TerminalApiErrorStatus;
  terminalId: string;
}

interface RequestTerminalClosesArgs {
  closeReason: TerminalSessionCloseReason;
  sessions: readonly TerminalSessionRow[];
}

interface PublishLifecycleTerminalExitsArgs {
  code: string;
  message: string;
  previousSessionsById: ReadonlyMap<string, TerminalSessionRow>;
  sessions: readonly TerminalSessionRow[];
}

interface NotifyExitedTerminalSessionArgs {
  code: string;
  message: string;
  session: TerminalSessionRow;
}

interface TerminalDaemonCloseTarget {
  daemonSessionId: string;
  terminalId: string;
}

type TerminalDaemonOpenTarget = Extract<
  HostDaemonServerWsMessage,
  { type: "terminal.open" }
>["target"];
type TerminalLaunchTarget = Exclude<TerminalCreateTarget, { kind: "thread" }>;

interface ResolvedTerminalLaunchTarget {
  daemonTarget: TerminalDaemonOpenTarget;
  environmentId: string | null;
  hostId: string;
  initialCwd: string;
}

interface SendTerminalInputArgs {
  payload: TerminalInputRequest;
  terminalId: string;
}

interface ResizeTerminalArgs {
  payload: TerminalResizeRequest;
  terminalId: string;
}

interface ReadTerminalOutputArgs {
  query: TerminalOutputQuery;
  terminalId: string;
}

interface ReadRunningTerminalOutputArgs {
  query: TerminalOutputQuery;
  session: RunningBrowserTerminalSession;
}

interface ReadExitedTerminalOutputArgs {
  query: TerminalOutputQuery;
  session: TerminalSessionRow;
}

interface RequestTerminalOutputReplayArgs {
  daemonSessionId: string;
  query: TerminalOutputQuery;
  session: TerminalSessionRow;
}

interface DisconnectDaemonSessionTerminalsArgs {
  daemonSessionId: string;
}

interface RejectPendingOutputReadsForTerminalArgs {
  code: string;
  message: string;
  terminalId: string;
}

interface CloseStaleOpenedTerminalArgs {
  daemonSessionId: string;
  terminalId: string;
}

interface PublishLifecycleTerminalExitsForSessionsArgs {
  currentSessions: TerminalSessionRow[];
  exitedSessions: TerminalSessionRow[];
  message: string;
}

interface CloseThreadTerminalsForLifecycleArgs {
  closeReason: TerminalSessionCloseReason;
  message: string;
  threadId: string;
}

interface TerminalSessionLifecycleOptions {
  attachTimeoutMs?: number;
  closeTimeoutMs?: number;
  config: AppDeps["config"];
  db: AppDeps["db"];
  hub: AppDeps["hub"];
  logger: ServerLogger;
  openTimeoutMs?: number;
  relay: TerminalRelayRouter;
}

interface ListTerminalsArgs {
  query: TerminalListQuery;
}

interface CreateTerminalArgs {
  payload: CreateTerminalRequest;
}

interface GetTerminalArgs {
  terminalId: string;
}

interface TerminalCreatePayload {
  cols: number;
  id?: string;
  rows: number;
  start?: NonNullable<CreateTerminalRequest["start"]>;
  title?: string;
}

interface CreateTerminalForTargetArgs {
  payload: TerminalCreatePayload;
  target: TerminalLaunchTarget;
  threadId: string | null;
  title: string;
}

interface RenameTerminalArgs {
  payload: UpdateTerminalRequest;
  terminalId: string;
}

interface CloseTerminalArgs {
  payload: CloseTerminalRequest;
  terminalId: string;
}

interface RestartTerminalArgs {
  terminalId: string;
}

interface CloseTerminalSessionArgs {
  current: TerminalSessionRow;
  payload: CloseTerminalRequest;
}

interface CloseDeletedThreadTerminalsArgs {
  threadId: string;
}

interface CloseArchivedThreadTerminalsArgs {
  threadId: string;
}

interface CloseDestroyedEnvironmentTerminalsArgs {
  environmentId: string;
}

interface ReconcileDisconnectedHostTerminalsArgs {
  daemonSessionId: string;
  hostId: string;
}

interface HandleDaemonTerminalMessageArgs {
  hostId: string;
  message: HostDaemonDaemonWsMessage;
  sessionId: string;
}

interface RefuseDaemonTerminalOpenArgs {
  message: TerminalOpenedMessage;
  sessionId: string;
}

interface HandleDaemonSessionClosedArgs {
  sessionId: string;
}

function toTerminalOutputChunk(
  chunk: TerminalOutputMessage["chunk"],
): TerminalOutputChunk {
  return {
    seq: chunk.seq,
    dataBase64: chunk.dataBase64,
  };
}

function terminalResponseRpcKey(
  daemonSessionId: string,
  message: { requestId: string; terminalId: string },
): string {
  return terminalRpcKey(daemonSessionId, message.terminalId, message.requestId);
}

function terminalTimeoutError(code: string, message: string): () => ApiError {
  return () => new ApiError(504, code, message);
}

function titleFromCommand(command: string): string {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }
  return `${normalized.slice(0, 77)}...`;
}

function initialTitleForTerminal(
  payload: TerminalCreatePayload,
  existingSessionCount: number,
): string {
  if (payload.title !== undefined) {
    return payload.title;
  }
  if (payload.start?.mode === "command") {
    return titleFromCommand(payload.start.command);
  }
  if (payload.start?.mode === "argv") {
    return titleFromCommand(payload.start.argv.join(" "));
  }
  return `Terminal ${existingSessionCount + 1}`;
}

interface BoundedTerminalOutput {
  chunks: TerminalOutputChunk[];
  truncated: boolean;
}

function applyTerminalOutputBounds(args: {
  chunks: readonly TerminalOutputChunk[];
  query: TerminalOutputQuery;
  replayNextSeq: number;
  requestedSinceSeq: number;
}): BoundedTerminalOutput {
  const { chunks, query, replayNextSeq, requestedSinceSeq } = args;
  const limitedByChunks =
    query.limitChunks === undefined ? chunks : chunks.slice(-query.limitChunks);
  let truncated =
    limitedByChunks.length < chunks.length ||
    (chunks[0]?.seq ?? replayNextSeq) > requestedSinceSeq;
  if (query.tailBytes === undefined) {
    return { chunks: [...limitedByChunks], truncated };
  }

  const bounded: TerminalOutputChunk[] = [];
  let byteLength = 0;
  for (let index = limitedByChunks.length - 1; index >= 0; index -= 1) {
    const chunk = limitedByChunks[index];
    const chunkByteLength = Buffer.byteLength(chunk.dataBase64, "base64");
    if (bounded.length > 0 && byteLength + chunkByteLength > query.tailBytes) {
      truncated = true;
      break;
    }
    bounded.unshift(chunk);
    byteLength += chunkByteLength;
    if (byteLength >= query.tailBytes) {
      truncated = truncated || index > 0;
      break;
    }
  }
  if (bounded.length < limitedByChunks.length) {
    truncated = true;
  }
  return { chunks: bounded, truncated };
}

function retainedTerminalOutputError(error: unknown): ApiError | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (error.body.code === "terminal_not_found") {
    return new ApiError(
      409,
      "terminal_output_unavailable",
      TERMINAL_OUTPUT_DISCARDED_MESSAGE,
    );
  }
  if (error.body.code === "host_disconnected") {
    return new ApiError(
      409,
      "terminal_output_unavailable",
      TERMINAL_OUTPUT_HOST_GONE_MESSAGE,
    );
  }
  return null;
}

function isRunningBrowserTerminalSession(
  row: TerminalSessionRow,
): row is RunningBrowserTerminalSession {
  return row.status === "running" && row.daemonSessionId !== null;
}

function terminalRestartTarget(row: TerminalSessionRow): TerminalCreateTarget {
  if (row.threadId !== null) {
    return { kind: "thread", threadId: row.threadId };
  }
  if (row.environmentId !== null) {
    return { kind: "environment", environmentId: row.environmentId };
  }
  return {
    kind: "host_path",
    hostId: row.hostId,
    cwd: row.initialCwd === HOST_HOME_INITIAL_CWD ? null : row.initialCwd,
  };
}

function getTerminalDaemonCloseTarget(
  row: TerminalSessionRow,
): TerminalDaemonCloseTarget | null {
  if (row.daemonSessionId === null) {
    return null;
  }
  if (row.status !== "starting" && row.status !== "running") {
    return null;
  }
  return {
    daemonSessionId: row.daemonSessionId,
    terminalId: row.id,
  };
}

function toTerminalSession(row: TerminalSessionRow): TerminalSession {
  return {
    id: row.id,
    threadId: row.threadId,
    environmentId: row.environmentId,
    hostId: row.hostId,
    title: row.title,
    initialCwd: row.initialCwd,
    cols: row.cols,
    rows: row.rows,
    status: row.status,
    exitCode: row.exitCode,
    closeReason: row.closeReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUserInputAt: row.lastUserInputAt,
  };
}

function toRelayTerminal(row: TerminalSessionRow): TerminalRelayTerminal {
  return {
    daemonSessionId: row.daemonSessionId,
    session: toTerminalSession(row),
  };
}

function getTerminalById(
  db: AppDeps["db"],
  terminalId: string,
): TerminalSessionRow | null {
  return getTerminalSession(db, { kind: "terminal", terminalId });
}

function updateTerminalById(
  db: AppDeps["db"],
  terminalId: string,
  update: TerminalSessionMutation,
): TerminalSessionRow | null {
  return updateTerminalSession(db, {
    scope: { kind: "terminal", terminalId },
    update,
  });
}

export class TerminalSessionLifecycle implements TerminalRelayHost {
  private readonly pendingCloses: PendingRpcRegistry<
    PendingTerminalCloseKey,
    TerminalSessionRow
  >;
  private readonly pendingOutputReads: PendingRpcRegistry<
    PendingTerminalRpcKey,
    TerminalReplayMessage
  >;
  private readonly pendingOpens: PendingRpcRegistry<
    PendingTerminalRpcKey,
    TerminalOpenedMessage
  >;
  private readonly pendingRestarts: PendingRpcRegistry<
    PendingRpcKey,
    TerminalSession
  >;

  constructor(private readonly options: TerminalSessionLifecycleOptions) {
    options.relay.bindHost(this);
    const attachTimeoutMs =
      options.attachTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
    const closeTimeoutMs =
      options.closeTimeoutMs ?? DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS;
    const openTimeoutMs =
      options.openTimeoutMs ?? DEFAULT_TERMINAL_OPEN_TIMEOUT_MS;
    this.pendingCloses = new PendingRpcRegistry<
      PendingTerminalCloseKey,
      TerminalSessionRow
    >({
      onFail: (pending, error) =>
        this.finalizeTimedOutTerminalClose(pending, error),
      timeoutMs: closeTimeoutMs,
      timeoutError: terminalTimeoutError(
        "terminal_close_timeout",
        "Timed out waiting for terminal process to exit",
      ),
    });
    this.pendingOutputReads = new PendingRpcRegistry({
      timeoutMs: attachTimeoutMs,
      timeoutError: terminalTimeoutError(
        "terminal_output_timeout",
        "Timed out reading terminal output",
      ),
    });
    this.pendingOpens = new PendingRpcRegistry({
      timeoutMs: openTimeoutMs,
      timeoutError: terminalTimeoutError(
        "terminal_open_timeout",
        "Timed out opening terminal session",
      ),
    });
    this.pendingRestarts = new PendingRpcRegistry({
      timeoutMs: null,
    });
  }

  get relay(): TerminalRelayRouter {
    return this.options.relay;
  }

  relayTerminal(terminalId: string): TerminalRelayTerminal | null {
    const current = getTerminalById(this.options.db, terminalId);
    return current === null ? null : toRelayTerminal(current);
  }

  recordInput(args: { hasData: boolean; terminalId: string }): void {
    const markedInput = updateTerminalById(this.options.db, args.terminalId, {
      kind: "user-input",
    });
    if (markedInput) {
      this.notifyTerminalSessionChanged(markedInput);
      this.publishSession("session-updated", markedInput);
    }
    if (!args.hasData) {
      return;
    }
    const current =
      markedInput ?? getTerminalById(this.options.db, args.terminalId);
    if (current) {
      emitPluginTerminalInput(toTerminalSession(current));
    }
  }

  recordResize(args: { cols: number; rows: number; terminalId: string }): void {
    const current = getTerminalById(this.options.db, args.terminalId);
    if (
      current === null ||
      (current.cols === args.cols && current.rows === args.rows)
    ) {
      return;
    }
    const resized = updateTerminalById(this.options.db, current.id, {
      cols: args.cols,
      kind: "size",
      rows: args.rows,
    });
    if (resized) {
      this.notifyTerminalSessionChanged(resized);
      this.publishSession("session-updated", resized);
    }
  }

  sendDaemonControlMessage(args: {
    daemonSessionId: string;
    message: HostDaemonTerminalDataServerMessage;
  }): void {
    if (
      !this.options.hub.sendDaemonSessionMessage(
        args.daemonSessionId,
        args.message,
      )
    ) {
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: args.daemonSessionId,
      });
    }
  }

  listTerminals(args: ListTerminalsArgs): TerminalSession[] {
    const { query } = args;
    if (query.threadId !== undefined) {
      requirePublicThread(this.options.db, query.threadId);
      return listTerminalSessions(this.options.db, {
        scope: { kind: "thread", threadId: query.threadId },
        visible: true,
      }).map(toTerminalSession);
    }
    if (query.environmentId !== undefined) {
      requireEnvironment(this.options.db, query.environmentId);
      return listTerminalSessions(this.options.db, {
        scope: {
          environmentId: query.environmentId,
          kind: "threadless-environment",
        },
        visible: true,
      }).map(toTerminalSession);
    }
    const hostId = query.hostId;
    if (hostId === undefined) {
      return [];
    }
    assertUsableHostId(
      {
        config: this.options.config,
        db: this.options.db,
        hub: this.options.hub,
      },
      { hostId },
    );
    return listTerminalSessions(this.options.db, {
      scope: { kind: "all" },
      visible: true,
    })
      .filter(
        (session) =>
          session.threadId === null &&
          session.environmentId === null &&
          session.hostId === hostId &&
          (query.cwd === undefined || session.initialCwd === query.cwd),
      )
      .map(toTerminalSession);
  }

  getTerminal(args: GetTerminalArgs): TerminalSession {
    const session = getTerminalById(this.options.db, args.terminalId);
    if (!session) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    return toTerminalSession(session);
  }

  async createTerminal(args: CreateTerminalArgs): Promise<TerminalSession> {
    const { id, target } = args.payload;
    if (id !== undefined && getTerminalById(this.options.db, id)) {
      throw new ApiError(
        409,
        "terminal_id_conflict",
        `Terminal session ${id} already exists`,
      );
    }
    const existingSessionCount = this.countExistingSessionsForTarget(target);
    const launchTarget =
      target.kind === "thread"
        ? this.resolveThreadTerminalCreateTarget(target.threadId)
        : target;
    return this.createTerminalForTarget({
      payload: args.payload,
      target: launchTarget,
      threadId: target.kind === "thread" ? target.threadId : null,
      title: initialTitleForTerminal(args.payload, existingSessionCount),
    });
  }

  private countExistingSessionsForTarget(target: TerminalCreateTarget): number {
    switch (target.kind) {
      case "thread": {
        const thread = requirePublicThread(this.options.db, target.threadId);
        return countTerminalSessions(this.options.db, {
          scope: { kind: "thread", threadId: thread.id },
          visible: false,
        });
      }
      case "environment":
        return countTerminalSessions(this.options.db, {
          scope: {
            environmentId: target.environmentId,
            kind: "threadless-environment",
          },
          visible: false,
        });
      case "host_path":
        return countTerminalSessions(this.options.db, {
          scope: { kind: "host-path", hostId: target.hostId, cwd: target.cwd },
          visible: true,
        });
    }
  }

  private resolveThreadTerminalCreateTarget(
    threadId: string,
  ): TerminalLaunchTarget {
    const thread = requirePublicThread(this.options.db, threadId);
    if (!thread.environmentId) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    }
    return { kind: "environment", environmentId: thread.environmentId };
  }

  private async createTerminalForTarget(
    args: CreateTerminalForTargetArgs,
  ): Promise<TerminalSession> {
    const launchTarget = this.resolveTerminalLaunchTarget(args.target);
    const daemonSession = requireConnectedHostSession(
      this.options,
      launchTarget.hostId,
    );
    const start = args.payload.start ?? DEFAULT_TERMINAL_START;
    const startingSession = createTerminalSession(this.options.db, {
      cols: args.payload.cols,
      daemonSessionId: daemonSession.id,
      environmentId: launchTarget.environmentId,
      hostId: launchTarget.hostId,
      id: args.payload.id,
      initialCwd: launchTarget.initialCwd,
      rows: args.payload.rows,
      status: "starting",
      threadId: args.threadId,
      title: args.title,
    });
    const requestId = randomUUID();
    const openMessage: HostDaemonServerWsMessage = {
      type: "terminal.open",
      contributedEnv: await resolveHostEnvironment(this.options, {
        hostId: launchTarget.hostId,
        projectId:
          launchTarget.environmentId === null
            ? null
            : requireEnvironment(this.options.db, launchTarget.environmentId)
                .projectId,
      }),
      requestId,
      terminalId: startingSession.id,
      ...(args.threadId !== null ? { threadId: args.threadId } : {}),
      target: launchTarget.daemonTarget,
      cols: args.payload.cols,
      rows: args.payload.rows,
      start,
    };

    const pendingOpenKey = terminalRpcKey(
      daemonSession.id,
      startingSession.id,
      requestId,
    );
    const pendingOpen = this.pendingOpens.claim({
      daemonSessionId: daemonSession.id,
      requestId,
      rpcKey: pendingOpenKey,
      terminalId: startingSession.id,
    }).promise;
    const sent = this.options.hub.sendDaemonSessionMessage(
      daemonSession.id,
      openMessage,
    );
    if (!sent) {
      this.pendingOpens.cancel(pendingOpenKey);
      const exited = updateTerminalById(this.options.db, startingSession.id, {
        closeReason: "daemon-disconnect",
        exitCode: null,
        kind: "exit",
      });
      if (exited) {
        this.notifyTerminalSessionChanged(exited);
      }
      throw new ApiError(
        502,
        "host_disconnected",
        `Host is not connected for terminal ${exited?.id ?? startingSession.id}`,
      );
    }

    let opened: TerminalOpenedMessage;
    try {
      opened = await pendingOpen;
    } catch (error) {
      const code = error instanceof ApiError ? error.body.code : null;
      const fenced = isServerMoveSnapshotFenced(this.options.db);
      if (code === "terminal_open_timeout" || code === "server_moving") {
        if (!fenced) {
          const exited = updateTerminalById(
            this.options.db,
            startingSession.id,
            {
              closeReason: "open-timeout",
              exitCode: null,
              kind: "exit",
            },
          );
          if (exited) {
            this.notifyTerminalSessionChanged(exited);
          }
        }
        this.options.hub.sendDaemonSessionMessage(daemonSession.id, {
          type: "terminal.close",
          terminalId: startingSession.id,
          reason: "open-timeout",
        });
      } else if (!fenced && code !== "host_disconnected") {
        const exited = updateTerminalById(this.options.db, startingSession.id, {
          closeReason: "process-exit",
          exitCode: null,
          kind: "exit",
        });
        if (exited) {
          this.notifyTerminalSessionChanged(exited);
        }
      }
      throw error;
    }

    const runningSession = updateTerminalSession(this.options.db, {
      scope: {
        daemonSessionId: daemonSession.id,
        kind: "daemon",
        statuses: ["starting"],
        terminalId: startingSession.id,
      },
      update: {
        cols: opened.cols,
        daemonSessionId: daemonSession.id,
        initialCwd: opened.initialCwd,
        kind: "running",
        rows: opened.rows,
        title: args.payload.title ?? opened.title,
      },
    });
    if (!runningSession) {
      this.closeStaleOpenedTerminal({
        daemonSessionId: daemonSession.id,
        terminalId: startingSession.id,
      });
      throw new ApiError(
        409,
        "terminal_open_cancelled",
        "Terminal session was cancelled before it opened",
      );
    }
    this.notifyTerminalSessionChanged(runningSession);
    return toTerminalSession(runningSession);
  }

  private resolveTerminalLaunchTarget(
    target: TerminalLaunchTarget,
  ): ResolvedTerminalLaunchTarget {
    switch (target.kind) {
      case "environment": {
        const environment = requireReadyEnvironment(
          this.options.db,
          target.environmentId,
        );
        const workspaceTarget = requireWorkspaceCommandTarget(environment);
        return {
          daemonTarget: {
            kind: "workspace",
            environmentId: workspaceTarget.environmentId,
            workspaceContext: workspaceTarget.workspaceContext,
          },
          environmentId: environment.id,
          hostId: workspaceTarget.hostId,
          initialCwd: workspaceTarget.workspaceContext.workspacePath,
        };
      }
      case "host_path":
        assertUsableHostId(
          {
            config: this.options.config,
            db: this.options.db,
            hub: this.options.hub,
          },
          { hostId: target.hostId },
        );
        return {
          daemonTarget: {
            kind: "host_path",
            cwd: target.cwd,
          },
          environmentId: null,
          hostId: target.hostId,
          initialCwd: target.cwd ?? HOST_HOME_INITIAL_CWD,
        };
    }
  }

  renameTerminal(args: RenameTerminalArgs): TerminalSession {
    const renamed = updateTerminalById(this.options.db, args.terminalId, {
      kind: "title",
      title: args.payload.title,
    });
    if (!renamed) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    this.notifyTerminalSessionChanged(renamed);
    const session = toTerminalSession(renamed);
    this.publishSession("session-updated", renamed);
    return session;
  }

  async restartTerminal(args: RestartTerminalArgs): Promise<TerminalSession> {
    const pending = this.pendingRestarts.claim({ rpcKey: args.terminalId });
    if (pending.created) {
      void this.restartTerminalOnce(args.terminalId).then(
        (session) => this.pendingRestarts.settle(args.terminalId, session),
        (error) =>
          this.pendingRestarts.fail(
            args.terminalId,
            error instanceof Error ? error : new Error(String(error)),
          ),
      );
    }
    return pending.promise;
  }

  private async restartTerminalOnce(
    terminalId: string,
  ): Promise<TerminalSession> {
    const current = getTerminalById(this.options.db, terminalId);
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }

    const replacement = await this.createTerminal({
      payload: {
        cols: current.cols,
        rows: current.rows,
        start: { mode: "shell" },
        target: terminalRestartTarget(current),
        title: current.title,
      },
    });
    if (current.status === "exited") {
      return replacement;
    }

    try {
      await this.closeTerminalSession({
        current,
        payload: { mode: "force", reason: "user" },
      });
    } catch (error) {
      const replacementRow = getTerminalById(this.options.db, replacement.id);
      if (replacementRow) {
        void this.closeTerminalSession({
          current: replacementRow,
          payload: { mode: "force", reason: "user" },
        }).catch((cleanupError) => {
          this.options.logger.warn(
            {
              err:
                cleanupError instanceof Error
                  ? cleanupError
                  : new Error(String(cleanupError)),
              terminalId: replacement.id,
            },
            "Failed to clean up replacement terminal after restart failure",
          );
        });
      }
      throw error;
    }
    return replacement;
  }

  async closeTerminal(args: CloseTerminalArgs): Promise<TerminalSession> {
    const current = getTerminalById(this.options.db, args.terminalId);
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    return this.closeTerminalSession({
      current,
      payload: args.payload,
    });
  }

  private async closeTerminalSession(
    args: CloseTerminalSessionArgs,
  ): Promise<TerminalSession> {
    const current = args.current;
    if (current.status === "exited") {
      return toTerminalSession(current);
    }
    if (args.payload.mode === "if-clean" && current.lastUserInputAt !== null) {
      return toTerminalSession(current);
    }
    if (
      current.daemonSessionId === null ||
      (current.status !== "starting" && current.status !== "running")
    ) {
      return this.finishTerminalCloseWithoutDaemon({
        current,
        reason: args.payload.reason,
      });
    }

    const pending = this.pendingCloses.claim({
      closeReason: args.payload.reason,
      daemonSessionId: current.daemonSessionId,
      rpcKey: terminalRpcKey(current.daemonSessionId, current.id, current.id),
      terminalId: current.id,
    });
    if (pending.created) {
      const sent = this.options.hub.sendDaemonSessionMessage(
        current.daemonSessionId,
        {
          type: "terminal.close",
          terminalId: current.id,
          reason: args.payload.reason,
        },
      );
      if (!sent) {
        this.disconnectDaemonSessionTerminals({
          daemonSessionId: current.daemonSessionId,
        });
        this.rejectPendingClose(
          current.id,
          new ApiError(502, "host_disconnected", "Host is not connected"),
        );
      }
    }
    try {
      return toTerminalSession(await pending.promise);
    } catch (error) {
      const finalized = getTerminalById(this.options.db, current.id);
      if (
        finalized?.status === "exited" &&
        finalized.closeReason === args.payload.reason
      ) {
        return toTerminalSession(finalized);
      }
      throw error;
    }
  }

  private finishTerminalCloseWithoutDaemon(args: {
    current: TerminalSessionRow;
    reason: TerminalSessionCloseReason;
  }): TerminalSession {
    const closed = updateTerminalById(this.options.db, args.current.id, {
      closeReason: args.reason,
      exitCode: args.current.exitCode,
      kind: "exit",
    });
    const session = closed ?? args.current;
    this.notifyExitedTerminalSession({
      session,
      code: "terminal_closed",
      message: "Terminal session closed",
    });
    return toTerminalSession(session);
  }

  sendTerminalInput(args: SendTerminalInputArgs): TerminalSession {
    const current = getTerminalById(this.options.db, args.terminalId);
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (!isRunningBrowserTerminalSession(current)) {
      throw new ApiError(
        409,
        "terminal_not_running",
        "Terminal session is not running",
      );
    }

    const markedInput = updateTerminalById(this.options.db, current.id, {
      kind: "user-input",
    });
    const session = markedInput ?? current;
    if (markedInput) {
      this.notifyTerminalSessionChanged(markedInput);
      this.publishSession("session-updated", markedInput);
    }

    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.input",
        terminalId: current.id,
        dataBase64: args.payload.dataBase64,
      },
    );
    if (!sent) {
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }
    if (args.payload.dataBase64.length > 0)
      emitPluginTerminalInput(toTerminalSession(session));
    return toTerminalSession(session);
  }

  resizeTerminal(args: ResizeTerminalArgs): TerminalSession {
    const current = getTerminalById(this.options.db, args.terminalId);
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (!isRunningBrowserTerminalSession(current)) {
      throw new ApiError(
        409,
        "terminal_not_running",
        "Terminal session is not running",
      );
    }

    const resized =
      current.cols === args.payload.cols && current.rows === args.payload.rows
        ? current
        : updateTerminalById(this.options.db, current.id, {
            cols: args.payload.cols,
            kind: "size",
            rows: args.payload.rows,
          });
    const session = resized ?? current;
    if (resized && resized !== current) {
      this.notifyTerminalSessionChanged(resized);
      this.publishSession("session-updated", resized);
    }

    const sent = this.options.hub.sendDaemonSessionMessage(
      current.daemonSessionId,
      {
        type: "terminal.resize",
        terminalId: current.id,
        cols: args.payload.cols,
        rows: args.payload.rows,
      },
    );
    if (!sent) {
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: current.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }
    return toTerminalSession(session);
  }

  async readTerminalOutput(
    args: ReadTerminalOutputArgs,
  ): Promise<TerminalOutputResponse> {
    const current = getTerminalById(this.options.db, args.terminalId);
    if (!current) {
      throw new ApiError(
        404,
        "terminal_not_found",
        "Terminal session not found",
      );
    }
    if (isRunningBrowserTerminalSession(current)) {
      return this.readRunningTerminalOutput({
        query: args.query,
        session: current,
      });
    }
    if (current.status !== "exited") {
      throw new ApiError(
        409,
        "terminal_output_unavailable",
        TERMINAL_OUTPUT_NOT_RUNNING_MESSAGE,
      );
    }
    return this.readExitedTerminalOutput({
      query: args.query,
      session: current,
    });
  }

  private async readRunningTerminalOutput(
    args: ReadRunningTerminalOutputArgs,
  ): Promise<TerminalOutputResponse> {
    try {
      return await this.requestTerminalOutputReplay({
        daemonSessionId: args.session.daemonSessionId,
        query: args.query,
        session: args.session,
      });
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.body.code !== "terminal_exited"
      ) {
        throw error;
      }
      const exited = getTerminalById(this.options.db, args.session.id);
      if (exited?.status !== "exited") {
        throw error;
      }
      return this.readExitedTerminalOutput({
        query: args.query,
        session: exited,
      });
    }
  }

  private async readExitedTerminalOutput(
    args: ReadExitedTerminalOutputArgs,
  ): Promise<TerminalOutputResponse> {
    const daemonSessionId = this.options.hub.getDaemonSessionIdForHost(
      args.session.hostId,
    );
    if (daemonSessionId === null) {
      throw new ApiError(
        409,
        "terminal_output_unavailable",
        TERMINAL_OUTPUT_HOST_GONE_MESSAGE,
      );
    }
    try {
      return await this.requestTerminalOutputReplay({
        daemonSessionId,
        query: args.query,
        session: args.session,
      });
    } catch (error) {
      throw retainedTerminalOutputError(error) ?? error;
    }
  }

  private async requestTerminalOutputReplay(
    args: RequestTerminalOutputReplayArgs,
  ): Promise<TerminalOutputResponse> {
    const requestId = randomUUID();
    const pendingReplayKey = terminalRpcKey(
      args.daemonSessionId,
      args.session.id,
      requestId,
    );
    const pendingReplay = this.pendingOutputReads.claim({
      daemonSessionId: args.daemonSessionId,
      requestId,
      rpcKey: pendingReplayKey,
      terminalId: args.session.id,
    }).promise;
    const sent = this.options.hub.sendDaemonSessionMessage(
      args.daemonSessionId,
      {
        type: "terminal.attach",
        requestId,
        terminalId: args.session.id,
        sinceSeq: args.query.sinceSeq ?? 0,
        tailBytes: args.query.tailBytes ?? TERMINAL_SCROLLBACK_MAX_BYTES,
      },
    );
    if (!sent) {
      this.pendingOutputReads.cancel(pendingReplayKey);
      this.disconnectDaemonSessionTerminals({
        daemonSessionId: args.daemonSessionId,
      });
      throw new ApiError(502, "host_disconnected", "Host is not connected");
    }

    const requestedSinceSeq = args.query.sinceSeq ?? 0;
    const replay = await pendingReplay;
    const bounded = applyTerminalOutputBounds({
      chunks: replay.chunks.map(toTerminalOutputChunk),
      query: args.query,
      replayNextSeq: replay.nextSeq,
      requestedSinceSeq,
    });
    return {
      chunks: bounded.chunks,
      nextSeq: replay.nextSeq,
      truncated: bounded.truncated,
      status: args.session.status,
      exitCode: args.session.exitCode,
      closeReason: args.session.closeReason,
    };
  }

  closeDeletedThreadTerminals(args: CloseDeletedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-deleted",
      message: "Terminal session closed because the thread was deleted",
    });
  }

  closeArchivedThreadTerminals(args: CloseArchivedThreadTerminalsArgs): void {
    this.closeThreadTerminalsForLifecycle({
      threadId: args.threadId,
      closeReason: "thread-archived",
      message: "Terminal session closed because the thread was archived",
    });
  }

  closeDestroyedEnvironmentTerminals(
    args: CloseDestroyedEnvironmentTerminalsArgs,
  ): void {
    const currentSessions = listTerminalSessions(this.options.db, {
      scope: { environmentId: args.environmentId, kind: "environment" },
      visible: false,
    });
    this.requestTerminalCloses({
      closeReason: "environment-destroyed",
      sessions: currentSessions,
    });
    const exitedSessions = updateTerminalSessions(this.options.db, {
      scope: {
        environmentId: args.environmentId,
        kind: "environment",
        statuses: NON_TERMINAL_SESSION_STATUSES,
      },
      update: { closeReason: "environment-destroyed", kind: "exit" },
    });
    this.publishLifecycleTerminalExitsForSessions({
      currentSessions,
      exitedSessions,
      message: "Terminal session closed because the environment was destroyed",
    });
  }

  reconcileDisconnectedHostTerminals(
    args: ReconcileDisconnectedHostTerminalsArgs,
  ): void {
    const openedInstanceId =
      getSessionById(this.options.db, { sessionId: args.daemonSessionId })
        ?.instanceId ?? null;
    const disconnected = listTerminalSessions(this.options.db, {
      scope: { hostId: args.hostId, kind: "host", statuses: ["disconnected"] },
      visible: false,
    });
    for (const session of disconnected) {
      const ownerInstanceId =
        session.daemonSessionId === null
          ? null
          : (getSessionById(this.options.db, {
              sessionId: session.daemonSessionId,
            })?.instanceId ?? null);
      if (openedInstanceId === null || ownerInstanceId !== openedInstanceId) {
        continue;
      }
      const reconnected = updateTerminalSession(this.options.db, {
        scope: {
          kind: "terminal",
          statuses: ["disconnected"],
          terminalId: session.id,
        },
        update: { daemonSessionId: args.daemonSessionId, kind: "reconnect" },
      });
      if (!reconnected) {
        continue;
      }
      this.options.logger.info(
        { terminalId: reconnected.id, sessionId: args.daemonSessionId },
        "Terminal session reattached to reconnected daemon",
      );
      this.notifyTerminalSessionChanged(reconnected);
      this.publishSession("session-updated", reconnected);
    }

    const exitedSessions = updateTerminalSessions(this.options.db, {
      scope: {
        hostId: args.hostId,
        kind: "host",
        statuses: ["disconnected"],
      },
      update: { closeReason: "daemon-disconnect", kind: "exit" },
    });
    for (const session of exitedSessions) {
      this.options.hub.sendDaemonSessionMessage(args.daemonSessionId, {
        type: "terminal.close",
        terminalId: session.id,
        reason: "daemon-disconnect",
      });
      this.notifyExitedTerminalSession({
        session,
        code: "host_disconnected",
        message: "Host disconnected from terminal session",
      });
    }
  }

  refuseDaemonTerminalOpen(args: RefuseDaemonTerminalOpenArgs): void {
    this.pendingOpens.fail(
      terminalResponseRpcKey(args.sessionId, args.message),
      serverMovingError(),
    );
  }

  handleDaemonTerminalMessage(args: HandleDaemonTerminalMessageArgs): void {
    switch (args.message.type) {
      case "heartbeat":
        return;
      case "terminal.opened":
        this.pendingOpens.settle(
          terminalResponseRpcKey(args.sessionId, args.message),
          args.message,
        );
        return;
      case "terminal.error":
        const rpcKey = terminalResponseRpcKey(args.sessionId, args.message);
        this.pendingOpens.fail(
          rpcKey,
          new ApiError(
            502,
            args.message.code,
            `Terminal failed to open: ${args.message.message}`,
          ),
        );
        this.options.relay.control.handleDaemonControlMessage({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        this.pendingOutputReads.fail(
          rpcKey,
          new ApiError(
            502,
            args.message.code,
            `Terminal output read failed: ${args.message.message}`,
          ),
        );
        return;
      case "terminal.exited":
        const exited = updateTerminalSession(this.options.db, {
          scope: {
            daemonSessionId: args.sessionId,
            kind: "daemon",
            terminalId: args.message.terminalId,
          },
          update: {
            closeReason: args.message.closeReason,
            exitCode: args.message.exitCode,
            kind: "exit",
          },
        });
        if (exited) {
          this.pendingCloses.settle(
            terminalRpcKey(args.sessionId, exited.id, exited.id),
            exited,
          );
          this.notifyTerminalSessionChanged(exited);
          this.publishSession("exited", exited);
          this.rejectPendingOutputReadsForTerminal({
            terminalId: exited.id,
            code: "terminal_exited",
            message: "Terminal session exited",
          });
        }
        return;
      case "terminal.output":
        this.options.relay.control.handleDaemonControlMessage({
          daemonSessionId: args.sessionId,
          message: args.message,
        });
        return;
      case "terminal.replay":
        if (
          !this.pendingOutputReads.settle(
            terminalResponseRpcKey(args.sessionId, args.message),
            args.message,
          )
        ) {
          this.options.relay.control.handleDaemonControlMessage({
            daemonSessionId: args.sessionId,
            message: args.message,
          });
        }
        return;
    }
  }

  handleDaemonSessionClosed(args: HandleDaemonSessionClosedArgs): void {
    this.options.relay.control.closeDaemonSession(args.sessionId);
    this.disconnectDaemonSessionTerminals({ daemonSessionId: args.sessionId });
  }

  private closeThreadTerminalsForLifecycle(
    args: CloseThreadTerminalsForLifecycleArgs,
  ): void {
    const currentSessions = listTerminalSessions(this.options.db, {
      scope: { kind: "thread", threadId: args.threadId },
      visible: false,
    });
    this.requestTerminalCloses({
      closeReason: args.closeReason,
      sessions: currentSessions,
    });
    const exitedSessions = updateTerminalSessions(this.options.db, {
      scope: {
        kind: "thread",
        statuses: NON_TERMINAL_SESSION_STATUSES,
        threadId: args.threadId,
      },
      update: { closeReason: args.closeReason, kind: "exit" },
    });
    this.publishLifecycleTerminalExitsForSessions({
      currentSessions,
      exitedSessions,
      message: args.message,
    });
  }

  private publishLifecycleTerminalExitsForSessions(
    args: PublishLifecycleTerminalExitsForSessionsArgs,
  ): void {
    this.publishLifecycleTerminalExits({
      code: "terminal_closed",
      message: args.message,
      previousSessionsById: new Map(
        args.currentSessions.map((session) => [session.id, session]),
      ),
      sessions: args.exitedSessions,
    });
  }

  private requestTerminalCloses(args: RequestTerminalClosesArgs): void {
    for (const session of args.sessions) {
      const target = getTerminalDaemonCloseTarget(session);
      if (!target) {
        continue;
      }
      this.options.hub.sendDaemonSessionMessage(target.daemonSessionId, {
        type: "terminal.close",
        terminalId: target.terminalId,
        reason: args.closeReason,
      });
    }
  }

  private closeStaleOpenedTerminal(args: CloseStaleOpenedTerminalArgs): void {
    const current = getTerminalById(this.options.db, args.terminalId);
    this.options.hub.sendDaemonSessionMessage(args.daemonSessionId, {
      type: "terminal.close",
      terminalId: args.terminalId,
      reason: current?.closeReason ?? "daemon-disconnect",
    });
  }

  private publishLifecycleTerminalExits(
    args: PublishLifecycleTerminalExitsArgs,
  ): void {
    for (const session of args.sessions) {
      const previousSession = args.previousSessionsById.get(session.id);
      if (previousSession?.daemonSessionId) {
        this.rejectPendingOpenForTerminal({
          daemonSessionId: previousSession.daemonSessionId,
          terminalId: session.id,
          status: 409,
          code: args.code,
          message: args.message,
        });
      }
      this.notifyExitedTerminalSession({
        session,
        code: args.code,
        message: args.message,
      });
    }
  }

  private notifyExitedTerminalSession(
    args: NotifyExitedTerminalSessionArgs,
  ): void {
    this.notifyTerminalSessionChanged(args.session);
    this.publishSession("exited", args.session);
    this.rejectPendingOutputReadsForTerminal({
      terminalId: args.session.id,
      code: args.code,
      message: args.message,
    });
  }

  private disconnectDaemonSessionTerminals(
    args: DisconnectDaemonSessionTerminalsArgs,
  ): void {
    const disconnected = [
      ...updateTerminalSessions(this.options.db, {
        scope: {
          daemonSessionId: args.daemonSessionId,
          kind: "daemon",
          statuses: ["running"],
        },
        update: { kind: "disconnect", retainDaemonSession: true },
      }),
      ...updateTerminalSessions(this.options.db, {
        scope: {
          daemonSessionId: args.daemonSessionId,
          kind: "daemon",
          statuses: ["starting"],
        },
        update: { kind: "disconnect", retainDaemonSession: false },
      }),
    ];
    for (const session of disconnected) {
      this.rejectPendingClose(
        session.id,
        new ApiError(
          502,
          "host_disconnected",
          "Host disconnected while closing terminal session",
        ),
      );
      this.rejectPendingOpenForTerminal({
        daemonSessionId: args.daemonSessionId,
        terminalId: session.id,
        status: 502,
        code: "host_disconnected",
        message: "Host disconnected while opening terminal session",
      });
      this.rejectPendingOutputReadsForTerminal({
        terminalId: session.id,
        code: "host_disconnected",
        message: "Host disconnected from terminal session",
      });
      this.options.logger.info(
        { terminalId: session.id, sessionId: args.daemonSessionId },
        "Terminal session disconnected with daemon session",
      );
      this.notifyTerminalSessionChanged(session);
      this.publishSession("session-updated", session);
    }
  }

  private finalizeTimedOutTerminalClose(
    pending: PendingTerminalCloseKey,
    error: Error,
  ): void {
    if (
      !(error instanceof ApiError) ||
      error.body.code !== "terminal_close_timeout"
    ) {
      return;
    }
    const exited = updateTerminalSession(this.options.db, {
      scope: {
        daemonSessionId: pending.daemonSessionId,
        kind: "daemon",
        statuses: DAEMON_OWNED_TERMINAL_STATUSES,
        terminalId: pending.terminalId,
      },
      update: {
        closeReason: pending.closeReason,
        exitCode: null,
        kind: "exit",
      },
    });
    if (!exited) {
      return;
    }

    this.options.logger.warn(
      {
        err: error,
        sessionId: pending.daemonSessionId,
        terminalId: pending.terminalId,
      },
      "Finalized terminal after close acknowledgement timed out",
    );
    this.notifyExitedTerminalSession({
      code: error.body.code,
      message: error.body.message,
      session: exited,
    });
  }

  private rejectPendingClose(terminalId: string, error: Error): void {
    this.pendingCloses.failAllMatching(
      (pending) => pending.terminalId === terminalId,
      error,
    );
  }

  private rejectPendingOpenForTerminal(
    args: RejectPendingOpenForTerminalArgs,
  ): void {
    this.pendingOpens.failAllMatching(
      (pending) =>
        pending.daemonSessionId === args.daemonSessionId &&
        pending.terminalId === args.terminalId,
      new ApiError(args.status, args.code, args.message),
    );
  }

  private rejectPendingOutputReadsForTerminal(
    args: RejectPendingOutputReadsForTerminalArgs,
  ): void {
    this.pendingOutputReads.failAllMatching(
      (pending) => pending.terminalId === args.terminalId,
      new ApiError(409, args.code, args.message),
    );
  }

  private publishSession(
    kind: "exited" | "session-updated",
    row: TerminalSessionRow,
  ): void {
    this.options.relay.control.publishSession({
      kind,
      terminal: toRelayTerminal(row),
    });
  }

  private notifyTerminalSessionChanged(
    session: Pick<TerminalSessionRow, "threadId">,
  ): void {
    if (session.threadId !== null) {
      this.options.hub.notifyThread(session.threadId, ["terminals-changed"]);
    }
  }
}
