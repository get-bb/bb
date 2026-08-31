import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { DbConnection } from "@bb/db";
import {
  BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS,
  BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD,
  BROWSER_AUTOMATION_MAX_TIMEOUT_MS,
  BROWSER_AUTOMATION_MAX_URL_LENGTH,
  browserAutomationCancelMessageSchema,
  browserAutomationCloseMessageSchema,
  browserAutomationCommandMessageSchema,
  browserAutomationOpenMessageSchema,
  isBrowserAutomationUrl,
  type BrowserAutomationCapabilityMessage,
  type BrowserAutomationCancelMessage,
  type BrowserAutomationCancelRequestMessage,
  type BrowserAutomationClientUnavailableReason,
  type BrowserAutomationCommand,
  type BrowserAutomationCommandFailedMessage,
  type BrowserAutomationCommandMessage,
  type BrowserAutomationCommandResult,
  type BrowserAutomationCommandResultMessage,
  type BrowserAutomationCloseMessage,
  type BrowserAutomationOpenFailedMessage,
  type BrowserAutomationOpenFailureCode,
  type BrowserAutomationOpenMessage,
  type BrowserAutomationOpenReadyMessage,
  type BrowserAutomationTarget,
  type BrowserAutomationTargetClosedMessage,
  type BrowserAutomationTargetStatus,
  type RealtimeSubscriptionTarget,
} from "@bb/domain";
import type {
  BrowserClientUnavailableErrorDetails,
  BrowserOpenFailedErrorDetails,
  BrowserOpenTimeoutErrorDetails,
  BrowserTargetLimitErrorDetails,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { HubSocket, NotificationHub } from "../../ws/hub.js";
import {
  requirePublicThread,
  requirePublicThreadEnvironment,
} from "../lib/entity-lookup.js";

const CLOSED_TARGET_RETENTION_LIMIT = 64;
const COMMAND_RECOVERY_TIMEOUT_MS = 5_000;

type BrowserAutomationHub = Pick<
  NotificationHub,
  "hasClientSubscription" | "countClientSubscriptions"
>;

export type BrowserMetricEvent =
  | { kind: "command"; command: BrowserAutomationCommand["kind"]; outcome: "cancelled" | "failed" | "success" | "timeout"; latencyMs: number; sizeBytes: number }
  | { kind: "target_leak"; count: number }
  | { kind: "target_closed_after_success"; count: 1 };

export interface BrowserMetricsRecorder {
  record(event: BrowserMetricEvent): void;
}

interface BrowserAutomationServiceDeps {
  db: DbConnection;
  hub: BrowserAutomationHub;
  logger: ServerLogger;
  metrics?: BrowserMetricsRecorder;
  now?: () => number;
}

interface BrowserAutomationConnection {
  socket: HubSocket;
  windowId: string;
}

interface PendingOpen {
  reject(error: ApiError): void;
  resolve(target: BrowserAutomationTarget): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingCommand {
  commandId: string;
  commandKind: BrowserAutomationCommand["kind"];
  startedAt: number;
  reject(error: ApiError): void;
  resolve(result: BrowserAutomationCommandResult): void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ClosedBrowserAutomationTargetRecord {
  threadId: string;
}

interface BrowserAutomationTargetRecord {
  connection: BrowserAutomationConnection;
  createdAt: number;
  hostId: string;
  navigationEpoch: number;
  pendingCommand: PendingCommand | null;
  pendingOpen: PendingOpen | null;
  recoveringCommandId: string | null;
  recoveryTimeout: ReturnType<typeof setTimeout> | null;
  requestId: string;
  status: BrowserAutomationTargetStatus;
  tabId: string | null;
  targetId: string;
  threadId: string;
  updatedAt: number;
  url: string;
  successfulCommandCount: number;
}

export interface OpenBrowserAutomationTargetArgs {
  threadId: string;
  timeoutMs?: number;
  url: string;
}

export interface ListBrowserAutomationTargetsArgs {
  threadId: string;
}

export interface CloseBrowserAutomationTargetArgs {
  targetId: string;
  threadId: string;
}

export interface RunBrowserAutomationCommandArgs {
  command: BrowserAutomationCommand;
  targetId: string;
  threadId: string;
  timeoutMs?: number;
}

export interface CancelBrowserAutomationCommandArgs {
  targetId: string;
  threadId: string;
}

type BrowserAutomationServerMessage =
  | BrowserAutomationOpenMessage
  | BrowserAutomationCloseMessage
  | BrowserAutomationCommandMessage
  | BrowserAutomationCancelMessage;

const CLIENT_UNAVAILABLE_MESSAGES: Record<
  BrowserAutomationClientUnavailableReason,
  string
> = {
  no_client:
    "No bb desktop app is showing this thread. Open the thread in the bb desktop app, then retry.",
  incompatible:
    "The app showing this thread does not support Browser automation. Update the bb desktop app, then retry.",
  disconnected:
    "The bb desktop app disconnected before the Browser target was ready. Reopen the thread in the bb desktop app, then retry.",
};

const OPEN_FAILED_MESSAGES: Record<BrowserAutomationOpenFailureCode, string> =
  {
    thread_not_open:
      "The bb desktop app is not showing this thread. Open the thread in the bb desktop app, then retry.",
    tab_unavailable:
      "The bb desktop app could not create a Browser tab for this thread.",
  };

function clientUnavailableError(
  reason: BrowserAutomationClientUnavailableReason,
): ApiError {
  const details: BrowserClientUnavailableErrorDetails = { reason };
  return new ApiError(
    503,
    "browser_client_unavailable",
    CLIENT_UNAVAILABLE_MESSAGES[reason],
    { details },
  );
}

function targetLimitError(): ApiError {
  const details: BrowserTargetLimitErrorDetails = {
    limit: BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD,
  };
  return new ApiError(
    409,
    "browser_target_limit",
    `This thread already has ${BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD} live Browser targets. Close one before opening another.`,
    { details },
  );
}

function targetNotFoundError(): ApiError {
  return new ApiError(
    404,
    "browser_target_not_found",
    "Browser target not found for this thread",
  );
}

function targetClosedError(): ApiError {
  return new ApiError(
    409,
    "browser_target_closed",
    "Browser target is closed. Open a new target.",
  );
}

function openTimeoutError(timeoutMs: number): ApiError {
  const details: BrowserOpenTimeoutErrorDetails = { timeoutMs };
  return new ApiError(
    504,
    "browser_open_timeout",
    `The bb desktop app did not open the Browser tab within ${timeoutMs}ms.`,
    { details },
  );
}

function openFailedError(reason: BrowserAutomationOpenFailureCode): ApiError {
  const details: BrowserOpenFailedErrorDetails = { reason };
  return new ApiError(
    409,
    "browser_open_failed",
    OPEN_FAILED_MESSAGES[reason],
    { details },
  );
}

function commandError(
  code:
    | "browser_target_busy"
    | "browser_command_timeout"
    | "browser_command_cancelled"
    | "browser_stale_revision"
    | "browser_native_operation_failed",
  message: string,
  timeoutMs?: number,
): ApiError {
  const status = code === "browser_command_timeout" ? 504 : 409;
  return new ApiError(status, code, message, {
    ...(timeoutMs === undefined ? {} : { details: { timeoutMs } }),
  });
}

function commandFailureError(
  message: BrowserAutomationCommandFailedMessage,
): ApiError {
  if (message.code === "cancelled") {
    return commandError("browser_command_cancelled", "Browser automation command was cancelled");
  }
  if (message.code === "stale_revision") {
    return commandError("browser_stale_revision", "Browser automation page or reference revision is stale");
  }
  return commandError("browser_native_operation_failed", message.detail);
}

function threadDetailTarget(threadId: string): RealtimeSubscriptionTarget {
  return { kind: "thread-detail", threadId };
}

function toTarget(record: BrowserAutomationTargetRecord): BrowserAutomationTarget {
  return {
    targetId: record.targetId,
    threadId: record.threadId,
    hostId: record.hostId,
    status: record.status,
    navigationEpoch: record.navigationEpoch,
    navigating: record.pendingCommand?.commandKind === "navigate",
    visible: true,
    url: record.url,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class BrowserAutomationService {
  private readonly connectionsBySocket = new Map<
    HubSocket,
    BrowserAutomationConnection
  >();
  private readonly liveTargets = new Map<
    string,
    BrowserAutomationTargetRecord
  >();
  private readonly closedTargets = new Map<
    string,
    ClosedBrowserAutomationTargetRecord
  >();
  private readonly now: () => number;

  constructor(private readonly deps: BrowserAutomationServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  registerConnection(
    socket: HubSocket,
    message: BrowserAutomationCapabilityMessage,
  ): void {
    const existing = this.connectionsBySocket.get(socket);
    if (existing !== undefined) {
      if (existing.windowId === message.windowId) {
        return;
      }
      this.retireTargetsForConnection(existing);
    }
    this.connectionsBySocket.set(socket, {
      socket,
      windowId: message.windowId,
    });
  }

  releaseConnection(socket: HubSocket): void {
    const connection = this.connectionsBySocket.get(socket);
    if (connection === undefined) {
      return;
    }
    this.connectionsBySocket.delete(socket);
    this.retireTargetsForConnection(connection);
  }

  recordOpenReady(
    socket: HubSocket,
    message: BrowserAutomationOpenReadyMessage,
  ): void {
    const record = this.findOpeningRecordForAck(socket, message);
    if (record === null || record.connection.windowId !== message.windowId) {
      this.deps.logger.debug(
        { targetId: message.targetId, requestId: message.requestId },
        "Ignored uncorrelated Browser automation open acknowledgement",
      );
      return;
    }
    record.status = "ready";
    record.tabId = message.tabId;
    record.url = message.url;
    record.updatedAt = this.now();
    const pending = record.pendingOpen;
    record.pendingOpen = null;
    if (pending !== null) {
      clearTimeout(pending.timeout);
      pending.resolve(toTarget(record));
    }
  }

  recordOpenFailed(
    socket: HubSocket,
    message: BrowserAutomationOpenFailedMessage,
  ): void {
    const record = this.findOpeningRecordForAck(socket, message);
    if (record === null) {
      this.deps.logger.debug(
        { targetId: message.targetId, requestId: message.requestId },
        "Ignored uncorrelated Browser automation open failure",
      );
      return;
    }
    this.retireTarget(record, openFailedError(message.code));
  }

  recordTargetClosed(
    socket: HubSocket,
    message: BrowserAutomationTargetClosedMessage,
  ): void {
    const record = this.liveTargets.get(message.targetId);
    if (
      record === undefined ||
      record.connection.socket !== socket ||
      record.connection.windowId !== message.windowId ||
      record.tabId !== message.tabId
    ) {
      return;
    }
    this.retireTarget(record, targetClosedError());
  }

  recordCommandResult(
    socket: HubSocket,
    message: BrowserAutomationCommandResultMessage,
  ): void {
    const record = this.correlatedCommandRecord(socket, message);
    if (record === null) return;
    const pending = record.pendingCommand;
    if (pending?.commandId === message.commandId) {
      record.pendingCommand = null;
      clearTimeout(pending.timeout);
      record.navigationEpoch = message.result.navigationEpoch;
      record.url = message.result.url;
      record.updatedAt = this.now();
      record.successfulCommandCount += 1;
      this.recordCommandMetric(pending, "success", message.result.kind === "snapshot" ? Buffer.byteLength(JSON.stringify(message.result.nodes)) : message.result.kind === "screenshot" ? Buffer.byteLength(message.result.base64, "base64") : 0);
      pending.resolve(message.result);
      return;
    }
    if (record.recoveringCommandId !== message.commandId) return;
    this.clearCommandRecovery(record);
    record.navigationEpoch = message.result.navigationEpoch;
    record.url = message.result.url;
    record.updatedAt = this.now();
  }

  recordCommandFailed(
    socket: HubSocket,
    message: BrowserAutomationCommandFailedMessage,
  ): void {
    const record = this.correlatedCommandRecord(socket, message);
    if (record === null) return;
    const pending = record.pendingCommand;
    if (message.state !== undefined) {
      record.navigationEpoch = message.state.navigationEpoch;
      record.url = message.state.url;
      record.updatedAt = this.now();
    }
    if (pending?.commandId === message.commandId) {
      record.pendingCommand = null;
      clearTimeout(pending.timeout);
      this.recordCommandMetric(pending, message.code === "cancelled" ? "cancelled" : "failed", 0);
      pending.reject(commandFailureError(message));
      return;
    }
    if (record.recoveringCommandId === message.commandId) {
      this.clearCommandRecovery(record);
    }
  }

  recordCancelRequest(
    socket: HubSocket,
    message: BrowserAutomationCancelRequestMessage,
  ): void {
    const record = this.correlatedPendingCommandRecord(socket, message);
    if (record === null) return;
    this.cancelRecordCommand(record);
  }

  open(args: OpenBrowserAutomationTargetArgs): Promise<BrowserAutomationTarget> {
    const timeoutMs = args.timeoutMs ?? BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS;
    if (
      args.url.length > BROWSER_AUTOMATION_MAX_URL_LENGTH ||
      !isBrowserAutomationUrl(args.url)
    ) {
      return Promise.reject(
        new ApiError(
          400,
          "invalid_request",
          `Browser automation URLs must be http or https and at most ${BROWSER_AUTOMATION_MAX_URL_LENGTH} characters`,
        ),
      );
    }
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > BROWSER_AUTOMATION_MAX_TIMEOUT_MS
    ) {
      return Promise.reject(
        new ApiError(
          400,
          "invalid_request",
          `timeoutMs must be an integer between 1 and ${BROWSER_AUTOMATION_MAX_TIMEOUT_MS}`,
        ),
      );
    }
    let threadId: string;
    let hostId: string;
    let connection: BrowserAutomationConnection;
    try {
      const lookup = requirePublicThreadEnvironment(
        this.deps.db,
        args.threadId,
      );
      threadId = lookup.thread.id;
      hostId = lookup.environment.hostId;
      if (
        this.countLiveTargetsForThread(threadId) >=
        BROWSER_AUTOMATION_MAX_TARGETS_PER_THREAD
      ) {
        throw targetLimitError();
      }
      connection = this.selectConnection(threadId);
    } catch (error) {
      return Promise.reject(error);
    }
    const now = this.now();
    const record: BrowserAutomationTargetRecord = {
      connection,
      createdAt: now,
      hostId,
      navigationEpoch: 0,
      pendingCommand: null,
      pendingOpen: null,
      recoveringCommandId: null,
      recoveryTimeout: null,
      requestId: randomUUID(),
      status: "opening",
      tabId: null,
      targetId: `bt_${randomUUID()}`,
      threadId,
      updatedAt: now,
      url: args.url,
      successfulCommandCount: 0,
    };
    this.liveTargets.set(record.targetId, record);
    return new Promise<BrowserAutomationTarget>((resolve, reject) => {
      record.pendingOpen = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          this.handleOpenTimeout(record, timeoutMs);
        }, timeoutMs),
      };
      const sent = this.sendToConnection(connection, {
        type: "browser-automation.open",
        requestId: record.requestId,
        targetId: record.targetId,
        threadId,
        url: args.url,
      });
      if (!sent) {
        this.retireTarget(record, clientUnavailableError("disconnected"));
      }
    });
  }

  list(args: ListBrowserAutomationTargetsArgs): BrowserAutomationTarget[] {
    const thread = requirePublicThread(this.deps.db, args.threadId);
    return [...this.liveTargets.values()]
      .filter((record) => record.threadId === thread.id)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map(toTarget);
  }

  close(args: CloseBrowserAutomationTargetArgs): BrowserAutomationTarget {
    const record = this.liveTargets.get(args.targetId);
    if (record === undefined) {
      const closed = this.closedTargets.get(args.targetId);
      if (closed !== undefined && closed.threadId === args.threadId) {
        throw targetClosedError();
      }
      throw targetNotFoundError();
    }
    if (record.threadId !== args.threadId) {
      throw targetNotFoundError();
    }
    if (record.successfulCommandCount > 0) {
      this.deps.metrics?.record({ kind: "target_closed_after_success", count: 1 });
    }
    this.retireTarget(record, targetClosedError());
    this.sendToConnection(record.connection, {
      type: "browser-automation.close",
      targetId: record.targetId,
    });
    return toTarget(record);
  }

  run(args: RunBrowserAutomationCommandArgs): Promise<BrowserAutomationCommandResult> {
    const timeoutMs = args.timeoutMs ?? BROWSER_AUTOMATION_DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > BROWSER_AUTOMATION_MAX_TIMEOUT_MS) {
      return Promise.reject(new ApiError(400, "invalid_request", `timeoutMs must be an integer between 1 and ${BROWSER_AUTOMATION_MAX_TIMEOUT_MS}`));
    }
    let owningThreadId: string;
    let owningHostId: string;
    try {
      const lookup = requirePublicThreadEnvironment(this.deps.db, args.threadId);
      owningThreadId = lookup.thread.id;
      owningHostId = lookup.environment.hostId;
    } catch (error) {
      return Promise.reject(error);
    }
    const record = this.liveTargets.get(args.targetId);
    if (record === undefined) {
      const closed = this.closedTargets.get(args.targetId);
      return Promise.reject(closed?.threadId === owningThreadId ? targetClosedError() : targetNotFoundError());
    }
    if (record.threadId !== owningThreadId || record.hostId !== owningHostId) {
      return Promise.reject(targetNotFoundError());
    }
    if (record.status !== "ready" || record.tabId === null) {
      return Promise.reject(targetClosedError());
    }
    if (record.pendingCommand !== null || record.recoveringCommandId !== null) {
      return Promise.reject(commandError("browser_target_busy", "Browser target already has a command in progress"));
    }
    const commandId = `bc_${randomUUID()}`;
    const tabId = record.tabId;
    return new Promise<BrowserAutomationCommandResult>((resolve, reject) => {
      const pending: PendingCommand = {
        commandId,
        commandKind: args.command.kind,
        startedAt: this.now(),
        reject,
        resolve,
        timeout: setTimeout(() => {
          if (record.pendingCommand !== pending) return;
          record.pendingCommand = null;
          this.startCommandRecovery(record, commandId);
          this.sendCancel(record, commandId);
          this.recordCommandMetric(pending, "timeout", 0);
          reject(commandError("browser_command_timeout", `Browser automation command exceeded ${timeoutMs}ms`, timeoutMs));
        }, timeoutMs),
      };
      record.pendingCommand = pending;
      record.updatedAt = this.now();
      const sent = this.sendToConnection(record.connection, {
        type: "browser-automation.command",
        commandId,
        targetId: record.targetId,
        windowId: record.connection.windowId,
        tabId,
        navigationEpoch: record.navigationEpoch,
        timeoutMs,
        command: args.command,
      });
      if (!sent && record.pendingCommand === pending) {
        record.pendingCommand = null;
        clearTimeout(pending.timeout);
        this.recordCommandMetric(pending, "failed", 0);
        reject(clientUnavailableError("disconnected"));
      }
    });
  }

  cancel(args: CancelBrowserAutomationCommandArgs): boolean {
    const record = this.liveTargets.get(args.targetId);
    if (record === undefined || record.threadId !== args.threadId) throw targetNotFoundError();
    if (record.pendingCommand === null) return false;
    this.cancelRecordCommand(record);
    return true;
  }

  private findOpeningRecordForAck(
    socket: HubSocket,
    message: { requestId: string; targetId: string },
  ): BrowserAutomationTargetRecord | null {
    const record = this.liveTargets.get(message.targetId);
    if (
      record === undefined ||
      record.status !== "opening" ||
      record.connection.socket !== socket ||
      record.requestId !== message.requestId
    ) {
      return null;
    }
    return record;
  }

  private correlatedCommandRecord(
    socket: HubSocket,
    message: { commandId: string; targetId: string; windowId: string; tabId: string },
  ): BrowserAutomationTargetRecord | null {
    const record = this.liveTargets.get(message.targetId);
    if (
      record === undefined ||
      record.connection.socket !== socket ||
      record.connection.windowId !== message.windowId ||
      record.tabId !== message.tabId ||
      (record.pendingCommand?.commandId !== message.commandId &&
        record.recoveringCommandId !== message.commandId)
    ) {
      return null;
    }
    return record;
  }

  private correlatedPendingCommandRecord(
    socket: HubSocket,
    message: { commandId: string; targetId: string; windowId: string; tabId: string },
  ): BrowserAutomationTargetRecord | null {
    const record = this.correlatedCommandRecord(socket, message);
    if (record === null || record.pendingCommand?.commandId !== message.commandId) return null;
    return record;
  }

  private cancelRecordCommand(record: BrowserAutomationTargetRecord): void {
    const pending = record.pendingCommand;
    if (pending === null) return;
    record.pendingCommand = null;
    this.startCommandRecovery(record, pending.commandId);
    clearTimeout(pending.timeout);
    this.sendCancel(record, pending.commandId);
    this.recordCommandMetric(pending, "cancelled", 0);
    pending.reject(commandError("browser_command_cancelled", "Browser automation command was cancelled"));
  }

  private startCommandRecovery(
    record: BrowserAutomationTargetRecord,
    commandId: string,
  ): void {
    this.clearCommandRecovery(record);
    record.recoveringCommandId = commandId;
    record.recoveryTimeout = setTimeout(() => {
      if (
        record.recoveringCommandId !== commandId ||
        this.liveTargets.get(record.targetId) !== record
      ) {
        return;
      }
      this.retireTarget(record, targetClosedError());
      this.sendToConnection(record.connection, {
        type: "browser-automation.close",
        targetId: record.targetId,
      });
    }, COMMAND_RECOVERY_TIMEOUT_MS);
  }

  private clearCommandRecovery(record: BrowserAutomationTargetRecord): void {
    if (record.recoveryTimeout !== null) {
      clearTimeout(record.recoveryTimeout);
      record.recoveryTimeout = null;
    }
    record.recoveringCommandId = null;
  }

  private sendCancel(record: BrowserAutomationTargetRecord, commandId: string): void {
    if (record.tabId === null) return;
    this.sendToConnection(record.connection, {
      type: "browser-automation.cancel",
      commandId,
      targetId: record.targetId,
      windowId: record.connection.windowId,
      tabId: record.tabId,
    });
  }

  private countLiveTargetsForThread(threadId: string): number {
    let count = 0;
    for (const record of this.liveTargets.values()) {
      if (record.threadId === threadId) {
        count += 1;
      }
    }
    return count;
  }

  private selectConnection(threadId: string): BrowserAutomationConnection {
    const target = threadDetailTarget(threadId);
    for (const connection of this.connectionsBySocket.values()) {
      if (this.deps.hub.hasClientSubscription(connection.socket, target)) {
        return connection;
      }
    }
    throw clientUnavailableError(
      this.deps.hub.countClientSubscriptions(target) > 0
        ? "incompatible"
        : "no_client",
    );
  }

  private handleOpenTimeout(
    record: BrowserAutomationTargetRecord,
    timeoutMs: number,
  ): void {
    if (record.status !== "opening") {
      return;
    }
    this.retireTarget(record, openTimeoutError(timeoutMs));
    this.sendToConnection(record.connection, {
      type: "browser-automation.close",
      targetId: record.targetId,
    });
  }

  private retireTargetsForConnection(
    connection: BrowserAutomationConnection,
  ): void {
    let leaked = 0;
    for (const record of [...this.liveTargets.values()]) {
      if (record.connection === connection) {
        leaked += 1;
        this.retireTarget(record, clientUnavailableError("disconnected"));
      }
    }
    if (leaked > 0) this.deps.metrics?.record({ kind: "target_leak", count: leaked });
  }

  private recordCommandMetric(
    pending: PendingCommand,
    outcome: "cancelled" | "failed" | "success" | "timeout",
    sizeBytes: number,
  ): void {
    this.deps.metrics?.record({
      kind: "command",
      command: pending.commandKind,
      outcome,
      latencyMs: Math.max(0, this.now() - pending.startedAt),
      sizeBytes: Math.max(0, sizeBytes),
    });
  }

  private retireTarget(
    record: BrowserAutomationTargetRecord,
    pendingOpenError: ApiError,
  ): void {
    const pending = record.pendingOpen;
    record.pendingOpen = null;
    this.clearCommandRecovery(record);
    record.status = "closed";
    record.updatedAt = this.now();
    this.liveTargets.delete(record.targetId);
    this.closedTargets.set(record.targetId, { threadId: record.threadId });
    for (const targetId of this.closedTargets.keys()) {
      if (this.closedTargets.size <= CLOSED_TARGET_RETENTION_LIMIT) {
        break;
      }
      this.closedTargets.delete(targetId);
    }
    if (pending !== null) {
      clearTimeout(pending.timeout);
      pending.reject(pendingOpenError);
    }
    const pendingCommand = record.pendingCommand;
    record.pendingCommand = null;
    if (pendingCommand !== null) {
      clearTimeout(pendingCommand.timeout);
      pendingCommand.reject(pendingOpenError);
    }
  }

  private sendToConnection(
    connection: BrowserAutomationConnection,
    message: BrowserAutomationServerMessage,
  ): boolean {
    const payload = message.type === "browser-automation.open"
      ? browserAutomationOpenMessageSchema.parse(message)
      : message.type === "browser-automation.close"
        ? browserAutomationCloseMessageSchema.parse(message)
        : message.type === "browser-automation.command"
          ? browserAutomationCommandMessageSchema.parse(message)
          : browserAutomationCancelMessageSchema.parse(message);
    try {
      connection.socket.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      this.deps.logger.warn(
        { err: error, windowId: connection.windowId },
        "Failed to send Browser automation message to desktop client",
      );
      return false;
    }
  }
}
