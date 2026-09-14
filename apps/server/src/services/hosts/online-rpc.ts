import { isHostCleanupAllowed } from "./cleanup-context.js";
import { assertMachineLifecycleAdmission } from "../machines/lifecycle.js";
import { getHost, getThread } from "@bb/db";
import { randomUUID } from "node:crypto";
import {
  type HostDaemonOnlineRpcResponseMessage,
  type HostDaemonOnlineRpcResultForCommand,
  type HostDaemonRetryableOnlineRpcCommand,
  parseHostDaemonRpcResultForCommand,
  type HostDaemonRpcCommand,
  type HostDaemonRpcResultForCommand,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  HostOnlineRpcTimeoutError,
  HostOnlineRpcUnavailableError,
} from "../../ws/hub.js";
import { ensureHostSessionReadyForWork } from "./host-lifecycle.js";
import { inactiveHostUnavailableDetails } from "../lib/lifecycle-api-errors.js";

const HOST_DAEMON_REGISTRATION_WAIT_MS = 1_000;

interface CallHostOnlineRpcArgs<TCommand extends HostDaemonRpcCommand> {
  command: TCommand;
  hostId: string;
  timeoutMs: number;
}

interface CallHostRetryableOnlineRpcArgs<
  TCommand extends HostDaemonRetryableOnlineRpcCommand,
> {
  command: TCommand;
  hostId: string;
  timeoutMs: number;
}

export function callHostOnlineRpc<TCommand extends HostDaemonRpcCommand>(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<TCommand>,
): Promise<HostDaemonRpcResultForCommand<TCommand>>;
export async function callHostOnlineRpc(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
): Promise<HostDaemonRpcResultForCommand> {
  assertHostActiveForRead(deps, args);
  return callHostOnlineRpcWithRetry(deps, args, {
    retryOnTransportFailure: false,
    waitForTransportFailure: false,
  });
}

export function callHostOnlineRpcForWork<TCommand extends HostDaemonRpcCommand>(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<TCommand>,
): Promise<HostDaemonRpcResultForCommand<TCommand>>;
export async function callHostOnlineRpcForWork(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
): Promise<HostDaemonRpcResultForCommand> {
  await prepareHostForWork(deps, args, false);
  return callHostOnlineRpcWithRetry(deps, args, {
    retryOnTransportFailure: false,
    waitForTransportFailure: false,
  });
}

export function callHostRetryableOnlineRpc<
  TCommand extends HostDaemonRetryableOnlineRpcCommand,
>(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<TCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>>;
export async function callHostRetryableOnlineRpc(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<HostDaemonRetryableOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand> {
  assertHostActiveForRead(deps, args);
  return callHostOnlineRpcWithRetry(deps, args, {
    retryOnTransportFailure: true,
    waitForTransportFailure: false,
  });
}

export function callHostRetryableOnlineRpcForWork<
  TCommand extends HostDaemonRetryableOnlineRpcCommand,
>(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<TCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>>;
export async function callHostRetryableOnlineRpcForWork(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<HostDaemonRetryableOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand> {
  await prepareHostForWork(deps, args, true);
  return callHostOnlineRpcWithRetry(deps, args, {
    retryOnTransportFailure: true,
    waitForTransportFailure: true,
  });
}

function isCleanupRpc(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
): boolean {
  return (
    getHost(deps.db, args.hostId)?.phase === "removing" &&
    isHostCleanupAllowed(deps, args.hostId) &&
    (args.command.type === "plugin.host.call" ||
      (args.command.type === "environment.hook.run" &&
        args.command.kind === "teardown"))
  );
}

function assertHostActiveForRead(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
): void {
  if (
    isCleanupRpc(deps, args) ||
    args.command.type === "thread.stop" ||
    args.command.type === "environment.hook.cancel" ||
    args.command.type === "plugin.host.cancel" ||
    args.command.type === "plugin.host.dispose"
  ) {
    return;
  }
  const host = getHost(deps.db, args.hostId);
  if (host !== null && host.phase !== "active") {
    const details = inactiveHostUnavailableDetails("disconnected", host);
    throw new ApiError(
      502,
      "host_unavailable",
      details.reason === "suspended"
        ? "Host is suspended"
        : "Host is not connected",
      { details, retryable: false },
    );
  }
}

async function prepareHostForWork(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
  retryOnTransportFailure: boolean,
): Promise<void> {
  if (isCleanupRpc(deps, args)) return;
  await ensureHostSessionReadyForWork(deps, { hostId: args.hostId }).catch(
    async (error) => {
      if (!retryOnTransportFailure || !isHostUnavailableApiError(error)) {
        throw error;
      }
      await waitForRetryableHostRpcTransport(deps, args.hostId);
    },
  );
  assertMachineLifecycleAdmission(deps, args.hostId);
  if (
    (args.command.type === "thread.start" ||
      args.command.type === "turn.submit") &&
    getHost(deps.db, args.hostId)?.machineOperationId !== null &&
    !["active", "starting"].includes(
      getThread(deps.db, args.command.threadId)?.status ?? "",
    )
  ) {
    throw new ApiError(
      409,
      "machine_dispatch_interrupted",
      "This turn was interrupted while waiting for machine preservation; submit a new continuation turn",
    );
  }
}

async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
  options: {
    retryOnTransportFailure: false;
    waitForTransportFailure: false;
  },
): Promise<HostDaemonRpcResultForCommand>;
async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<HostDaemonRetryableOnlineRpcCommand>,
  options: {
    retryOnTransportFailure: true;
    waitForTransportFailure: boolean;
  },
): Promise<HostDaemonOnlineRpcResultForCommand>;
async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
  options: {
    retryOnTransportFailure: boolean;
    waitForTransportFailure: boolean;
  },
): Promise<HostDaemonRpcResultForCommand> {
  const timeoutRetryDeadline =
    options.retryOnTransportFailure && args.timeoutMs > 1
      ? Date.now() + args.timeoutMs
      : null;
  const firstAttemptArgs =
    timeoutRetryDeadline === null
      ? args
      : {
          ...args,
          timeoutMs: Math.max(1, Math.floor(args.timeoutMs / 2)),
        };
  const response = await requestHostOnlineRpcResponse(
    deps,
    firstAttemptArgs,
  ).catch(async (error) => {
    if (!options.retryOnTransportFailure) {
      throwOnlineRpcError(error);
    }
    if (error instanceof HostOnlineRpcUnavailableError) {
      if (!options.waitForTransportFailure) throwOnlineRpcError(error);
      await waitForRetryableHostRpcTransport(deps, args.hostId);
      return requestHostOnlineRpcResponse(deps, args).catch((retryError) => {
        throwOnlineRpcError(retryError);
      });
    }
    if (!(error instanceof HostOnlineRpcTimeoutError)) {
      throwOnlineRpcError(error);
    }
    const retryTimeoutMs =
      timeoutRetryDeadline === null ? 0 : timeoutRetryDeadline - Date.now();
    if (retryTimeoutMs <= 0) {
      throwOnlineRpcError(error);
    }
    return requestHostOnlineRpcResponse(deps, {
      ...args,
      timeoutMs: retryTimeoutMs,
    }).catch((retryError) => {
      throwOnlineRpcError(retryError);
    });
  });

  if (!response.ok) {
    throw new ApiError(502, response.errorCode, response.errorMessage, false);
  }

  if (response.commandType !== args.command.type) {
    throw new ApiError(
      500,
      "command_result_type_mismatch",
      `Host RPC ${response.requestId} completed with unexpected type ${response.commandType}`,
    );
  }

  return parseHostDaemonRpcResultForCommand(args.command, response.result);
}

async function waitForRetryableHostRpcTransport(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  if (deps.hub.hasDaemonForHost(hostId)) {
    await ensureHostSessionReadyForWork(deps, { hostId });
    return;
  }
  await deps.hub.waitForDaemonForHost(hostId, HOST_DAEMON_REGISTRATION_WAIT_MS);
  await ensureHostSessionReadyForWork(deps, { hostId });
}

export function isHostUnavailableApiError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 502 &&
    error.body.code === "host_unavailable"
  );
}

function requestHostOnlineRpcResponse(
  deps: Pick<WorkSessionDeps, "hub">,
  args: CallHostOnlineRpcArgs<HostDaemonRpcCommand>,
): Promise<HostDaemonOnlineRpcResponseMessage> {
  return deps.hub.requestHostOnlineRpc({
    hostId: args.hostId,
    message: {
      type: "host-rpc.request",
      requestId: randomUUID(),
      command: args.command,
    },
    timeoutMs: args.timeoutMs,
  });
}

export function hostCommandTimeoutError(): ApiError {
  return new ApiError(
    504,
    "command_timeout",
    "Timed out waiting for command result",
  );
}

function throwOnlineRpcError(error: unknown): never {
  if (error instanceof HostOnlineRpcTimeoutError) {
    throw hostCommandTimeoutError();
  }

  if (error instanceof HostOnlineRpcUnavailableError) {
    throw new ApiError(502, "host_unavailable", "Host is not connected", false);
  }

  throw error;
}
