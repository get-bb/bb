import { setTimeout as sleep } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { hostDaemonSessions } from "@bb/db";
import {
  hostDaemonCommandSchema,
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonRpcCommandSchema,
  hostDaemonServerWsMessageSchema,
  parseHostDaemonRpcResultForCommand,
} from "@bb/host-daemon-contract";
import {
  type HostType,
  type ThreadEvent,
} from "@bb/domain";
import type {
  HostDaemonCommand,
  HostDaemonEventEnvelope,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonRpcCommand,
  HostDaemonRpcResultForCommand,
} from "@bb/host-daemon-contract";
import type { TestAppHarness } from "./test-app.js";
import { createTestDaemonHostKey } from "./test-app.js";

interface CapturedRpcRow {
  completedAt: number | null;
  createdAt: number;
  cursor: number;
  fetchedAt: number;
  hostId: string;
  id: string;
  payload: string;
  resultPayload: string | null;
  retryCount: number;
  sessionId: string | null;
  state: string;
  type: string;
}

type QueuedCommandPayload = HostDaemonRpcCommand;
type QueuedCommandResult<TCommand extends QueuedCommandPayload> =
  HostDaemonRpcResultForCommand<TCommand>;

export interface QueuedCommand<
  TCommand extends QueuedCommandPayload = QueuedCommandPayload,
> {
  command: TCommand;
  row: CapturedRpcRow;
  rpcRequest?: HostDaemonOnlineRpcRequestMessage;
}

type ManagedWorktreeEnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision"; workspaceProvisionType: "managed-worktree" }
>;

export type ManagedWorktreeEnvironmentProvisionLiveCommand =
  QueuedCommand<ManagedWorktreeEnvironmentProvisionCommand>;

export function isManagedWorktreeEnvironmentProvisionLiveCommand(
  queued: QueuedCommand,
): queued is ManagedWorktreeEnvironmentProvisionLiveCommand {
  return (
    queued.command.type === "environment.provision" &&
    queued.command.workspaceProvisionType === "managed-worktree"
  );
}

export function requireManagedWorktreeEnvironmentProvisionLiveCommand(
  queued: QueuedCommand,
): ManagedWorktreeEnvironmentProvisionLiveCommand {
  if (isManagedWorktreeEnvironmentProvisionLiveCommand(queued)) {
    return queued;
  }
  throw new Error("Expected managed-worktree environment.provision command");
}

export function listQueuedThreadCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  threadId: string,
): HostDaemonCommand[] {
  return pendingHostRpcRequests
    .filter(
      (queued) =>
        isCapturedRpcForHarness(harness, queued) &&
        queued.command.type === type &&
        "threadId" in queued.command &&
        queued.command.threadId === threadId,
    )
    .map((queued) => hostDaemonCommandSchema.parse(queued.command));
}

export function listQueuedWorkflowRunCommands(
  harness: TestAppHarness,
  type: "workflow.start" | "workflow.cancel",
): QueuedCommand[] {
  return pendingHostRpcRequests.filter(
    (queued) =>
      isCapturedRpcForHarness(harness, queued) && queued.command.type === type,
  );
}

export function listQueuedEnvironmentCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  environmentId: string,
): HostDaemonCommand[] {
  return pendingHostRpcRequests
    .filter(
      (queued) =>
        isCapturedRpcForHarness(harness, queued) &&
        queued.command.type === type &&
        "environmentId" in queued.command &&
        queued.command.environmentId === environmentId,
    )
    .map((queued) => hostDaemonCommandSchema.parse(queued.command));
}

const pendingHostRpcRequests: QueuedCommand[] = [];
const testRpcCursorByHost = new Map<string, number>();

interface RegisterTestHostRpcCaptureArgs {
  hostId: string;
  sessionId: string;
}

interface TestHostRpcSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export interface CreateTestDaemonEventEnvelopeArgs {
  event: ThreadEvent;
  threadId?: string;
}

export function createTestDaemonEventEnvelope(
  args: CreateTestDaemonEventEnvelopeArgs,
): HostDaemonEventEnvelope {
  return {
    threadId: args.threadId ?? args.event.threadId,
    event: args.event,
  };
}

export function internalAuthHeaders(
  harness: TestAppHarness,
  args: { hostId?: string; hostType?: HostType } = {},
): HeadersInit {
  const activeSessions = harness.db
    .select({
      hostId: hostDaemonSessions.hostId,
      hostType: hostDaemonSessions.hostType,
    })
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.status, "active"))
    .all();

  const inferredHost = activeSessions.length === 1 ? activeSessions[0] : null;

  return {
    authorization: `Bearer ${createTestDaemonHostKey({
      hostId: args.hostId ?? inferredHost?.hostId ?? "host-1",
      hostType: args.hostType ?? inferredHost?.hostType ?? "persistent",
    })}`,
    "content-type": "application/json",
  };
}

function nextTestRpcCursor(
  deps: Pick<TestAppHarness, "db">,
  hostId: string,
): number {
  void deps;
  const previousCursor = Math.max(
    testRpcCursorByHost.get(hostId) ?? 0,
  );
  const nextCursor = previousCursor + 0.0001;
  testRpcCursorByHost.set(hostId, nextCursor);
  return nextCursor;
}

export function registerTestHostRpcCapture(
  deps: Pick<TestAppHarness, "db" | "hub">,
  args: RegisterTestHostRpcCaptureArgs,
): void {
  testRpcCursorByHost.delete(args.hostId);
  for (let index = pendingHostRpcRequests.length - 1; index >= 0; index -= 1) {
    const queued = pendingHostRpcRequests[index];
    if (queued?.row.hostId === args.hostId) {
      pendingHostRpcRequests.splice(index, 1);
    }
  }
  const socket: TestHostRpcSocket = {
    close() {},
    send(data) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type !== "host-rpc.request") {
        return;
      }
      const command = hostDaemonRpcCommandSchema.parse(message.command);
      const now = Date.now();
      const row: CapturedRpcRow = {
        id: `rpc-${message.requestId}`,
        hostId: args.hostId,
        sessionId: args.sessionId,
        cursor: nextTestRpcCursor(deps, args.hostId),
        type: command.type,
        payload: JSON.stringify(command),
        state: "pending",
        retryCount: 0,
        resultPayload: null,
        createdAt: now,
        fetchedAt: now,
        completedAt: null,
      };
      pendingHostRpcRequests.push({
        command,
        row,
        rpcRequest: message,
      });
    },
  };
  deps.hub.registerDaemon(args.sessionId, args.hostId, socket);
}

function removePendingHostRpcRequest(requestId: string): void {
  const index = pendingHostRpcRequests.findIndex(
    (queued) => queued.rpcRequest?.requestId === requestId,
  );
  if (index >= 0) {
    pendingHostRpcRequests.splice(index, 1);
  }
}

function isCapturedRpcForHarness(
  harness: TestAppHarness,
  queued: QueuedCommand,
): boolean {
  return (
    harness.db
      .select({ id: hostDaemonSessions.id })
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.hostId, queued.row.hostId))
      .get() !== undefined
  );
}

export async function waitForQueuedCommand(
  harness: TestAppHarness,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const queued of pendingHostRpcRequests) {
      if (isCapturedRpcForHarness(harness, queued) && predicate(queued)) {
        return queued;
      }
    }

    await sleep(10);
  }

  throw new Error("Timed out waiting for queued command");
}

export async function waitForQueuedCommandAfter(
  harness: TestAppHarness,
  afterCursor: number,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  return waitForQueuedCommand(
    harness,
    (queued) => queued.row.cursor > afterCursor && predicate(queued),
    timeoutMs,
  );
}

export async function reportQueuedCommandSuccess<
  TCommand extends QueuedCommandPayload,
>(
  harness: TestAppHarness,
  queued: QueuedCommand<TCommand>,
  result: QueuedCommandResult<TCommand>,
  args: { hostId?: string; hostType?: HostType } = {},
): Promise<Response> {
  const sessionId = queued.row.sessionId;
  if (!sessionId) {
    throw new Error("Queued host RPC is missing sessionId");
  }
  if (!queued.rpcRequest) {
    throw new Error("Queued command is missing RPC request metadata");
  }
  const parsedResult = parseHostDaemonRpcResultForCommand(
    queued.rpcRequest.command,
    result,
  );
  harness.hub.recordHostOnlineRpcResponse({
    message: hostDaemonOnlineRpcResponseMessageSchema.parse({
      type: "host-rpc.response",
      requestId: queued.rpcRequest.requestId,
      commandType: queued.rpcRequest.command.type,
      ok: true,
      result: parsedResult,
    }),
    sessionId,
  });
  removePendingHostRpcRequest(queued.rpcRequest.requestId);
  await sleep(0);
  void args;
  return new Response(null, { status: 200 });
}

export async function reportQueuedCommandError(
  harness: TestAppHarness,
  queued: QueuedCommand,
  args: { errorCode: string; errorMessage: string },
  auth: { hostId?: string; hostType?: HostType } = {},
): Promise<Response> {
  const sessionId = queued.row.sessionId;
  if (!sessionId) {
    throw new Error("Queued host RPC is missing sessionId");
  }
  if (!queued.rpcRequest) {
    throw new Error("Queued command is missing RPC request metadata");
  }
  harness.hub.recordHostOnlineRpcResponse({
    message: {
      type: "host-rpc.response",
      requestId: queued.rpcRequest.requestId,
      commandType: queued.rpcRequest.command.type,
      ok: false,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
    },
    sessionId,
  });
  removePendingHostRpcRequest(queued.rpcRequest.requestId);
  await sleep(0);
  void auth;
  return new Response(null, { status: 200 });
}
