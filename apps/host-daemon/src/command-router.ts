import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonOnlineRpcResultForCommand,
  HostDaemonOnlineRpcCommand,
  HostDaemonCommandResultForCommand,
  HostDaemonRpcCommand,
  HostDaemonRpcResultForCommand,
  HostDaemonCommandEnvironmentLane,
} from "@bb/host-daemon-contract";
import { performance } from "node:perf_hooks";
import {
  hostDaemonEnvironmentLaneForCommand,
  hostDaemonOnlineRpcResponseMessageSchema,
  isHostDaemonCommand,
  parseHostDaemonCommandResultForCommand,
  parseHostDaemonOnlineRpcResultForCommand,
  shouldFlushEventsBeforeReportingCommandResult,
} from "@bb/host-daemon-contract";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
  getErrorCode,
  type CommandDispatchOptions,
} from "./command-dispatch.js";
import { isExpectedOnlineRpcFailureError } from "./command-dispatch-support.js";
import { roundDurationMs } from "./event-loop-stall-monitor.js";
import type { HostDaemonLogger } from "./logger.js";
import { RuntimeManager } from "./runtime-manager.js";
import type { PluginHostManager } from "./plugin-host-manager.js";

type CommandRouterLogger = Pick<HostDaemonLogger, "debug" | "warn">;

type EnvironmentLaneMode = HostDaemonCommandEnvironmentLane;

interface ReadWriteLaneState {
  /** All admitted read and write work. Writes wait on this tail. */
  tail: Promise<void>;
  /** Last admitted write. Reads wait on this tail, then join `tail`. */
  writeTail: Promise<void>;
}

interface ReadWriteLaneArgs<T> {
  key: string;
  lanes: Map<string, ReadWriteLaneState>;
  mode: EnvironmentLaneMode;
  work: () => Promise<T>;
}

interface SerialLaneArgs<T> {
  key: string;
  lanes: Map<string, Promise<void>>;
  work: () => Promise<T>;
}

interface ReadWriteLaneIdleArgs {
  key: string;
  lanes: Map<string, ReadWriteLaneState>;
  state: ReadWriteLaneState;
  tail: Promise<void>;
}

type CommandRouterTask = Promise<HostDaemonCommandResultForCommand>;

export interface CommandRouterOptions {
  dataDir: CommandDispatchOptions["dataDir"];
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  fetchSkillTree?: CommandDispatchOptions["fetchSkillTree"];
  fetchPluginHostArtifact?: CommandDispatchOptions["fetchPluginHostArtifact"];
  runtimeManager: RuntimeManager;
  terminalManager?: CommandDispatchOptions["terminalManager"];
  eventSink: CommandDispatchOptions["eventSink"];
  listModels: CommandDispatchOptions["listModels"];
  providerHealth: CommandDispatchOptions["providerHealth"];
  providerUsage: CommandDispatchOptions["providerUsage"];
  providerInstallationStatus: CommandDispatchOptions["providerInstallationStatus"];
  providerInstallationRun: CommandDispatchOptions["providerInstallationRun"];
  resolveInteractiveRequest?: CommandDispatchOptions["resolveInteractiveRequest"];
  pluginHostManager?: PluginHostManager;
  ensureConnectTunnelIdentity?: CommandDispatchOptions["ensureConnectTunnelIdentity"];
  threadStorageRootPath: string;
  logger: CommandRouterLogger;
}

const HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS = 1_000;

function elapsedMs(startedAtMs: number): number {
  return performance.now() - startedAtMs;
}

export class CommandRouter {
  private readonly logger;
  private readonly environmentLanes = new Map<string, ReadWriteLaneState>();
  // Per-thread barrier keyed by threadId. A turn submission
  // (turn.submit/thread.start) waits for an in-flight thread.unarchive of the
  // same thread so it cannot resume a still-archived provider session.
  private readonly threadUnarchiveBarriers = new Map<string, Promise<void>>();
  // Thread lanes serialize the commands that drive one thread's provider
  // session within an environment (start, turn, stop, archive, interactive
  // resolution, plan cancel, goal clear), keyed per (environment, thread).
  // One bridge process serves every thread of a provider and dispatches
  // concurrently, so commands on different threads never wait on each other.
  private readonly threadLaneTails = new Map<string, Promise<void>>();
  private readonly threadTurnLaneTails = new Map<string, Promise<void>>();

  constructor(private readonly options: CommandRouterOptions) {
    this.logger = options.logger;
  }

  async handleOnlineRpcRequest(
    message: HostDaemonOnlineRpcRequestMessage,
  ): Promise<HostDaemonOnlineRpcResponseMessage> {
    const handlerStartedAtMs = performance.now();
    try {
      const result = await this.executeHostRpcCommand(message.command);
      this.logOnlineRpc({
        commandType: message.command.type,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: true,
      });
      return hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: true,
        result,
      });
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (!isExpectedOnlineRpcFailureError(error)) {
        this.logger.warn(
          {
            type: message.command.type,
            err: error,
          },
          "online host RPC failed",
        );
      }
      this.logOnlineRpc({
        commandType: message.command.type,
        errorCode,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: false,
      });
      return {
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: false,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private executeHostRpcCommand(
    command: HostDaemonRpcCommand,
  ): Promise<HostDaemonRpcResultForCommand> {
    if (isHostDaemonCommand(command)) {
      return this.executeLiveDaemonCommand(command);
    }
    return this.executeOnlineRpcCommand(command);
  }

  private executeOnlineRpcCommand(
    command: HostDaemonOnlineRpcCommand,
  ): Promise<HostDaemonOnlineRpcResultForCommand> {
    if (command.type === "plugin.host.call") {
      if (!this.options.pluginHostManager) {
        return Promise.reject(new Error("host plugin runtime is unavailable"));
      }
      return this.options.pluginHostManager.call(command);
    }
    if (command.type === "plugin.host.cancel") {
      if (!this.options.pluginHostManager) {
        return Promise.reject(new Error("host plugin runtime is unavailable"));
      }
      const result = this.options.pluginHostManager.cancel(command);
      return Promise.resolve(result);
    }
    if (command.type === "plugin.host.dispose") {
      if (!this.options.pluginHostManager) {
        return Promise.reject(new Error("host plugin runtime is unavailable"));
      }
      return this.options.pluginHostManager.dispose(command);
    }
    const environmentLaneMode = hostDaemonEnvironmentLaneForCommand(command);
    const result =
      environmentLaneMode && "environmentId" in command
        ? this.runInEnvironmentLane(
            command.environmentId,
            environmentLaneMode,
            () =>
              dispatchOnlineRpcCommand(command, this.createDispatchOptions()),
          )
        : dispatchOnlineRpcCommand(command, this.createDispatchOptions());
    return result.then((value) =>
      parseHostDaemonOnlineRpcResultForCommand(command, value),
    );
  }

  private executeLiveDaemonCommand(
    command: HostDaemonCommand,
  ): Promise<HostDaemonCommandResultForCommand> {
    const environmentLaneMode = hostDaemonEnvironmentLaneForCommand(command);
    const threadLaneKey = this.resolveThreadLaneKey(command);
    const task = this.runAfterThreadUnarchiveBarrier(command, () =>
      this.runInThreadTurnLane(command, () =>
        this.runInExecutionLanes(
          command,
          environmentLaneMode,
          threadLaneKey,
          () => this.executeLiveDaemonCommandBody(command),
        ),
      ),
    );
    this.registerThreadUnarchiveBarrier(command, task);
    return task;
  }

  private async executeLiveDaemonCommandBody(
    command: HostDaemonCommand,
  ): Promise<HostDaemonCommandResultForCommand> {
    const result = await dispatchCommand(command, this.createDispatchOptions());
    // Commands that emit thread events before completing preserve the previous
    // event-before-result ordering under live RPC.
    if (shouldFlushEventsBeforeReportingCommandResult(command)) {
      await this.options.eventSink.flush();
    }
    return parseHostDaemonCommandResultForCommand(command, result);
  }

  private runInEnvironmentLane<T>(
    environmentId: string,
    mode: EnvironmentLaneMode,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.runInReadWriteLane({
      key: environmentId,
      lanes: this.environmentLanes,
      mode,
      work,
    });
  }

  private runInExecutionLanes<T>(
    command: HostDaemonCommand,
    environmentLaneMode: EnvironmentLaneMode | null,
    threadLaneKey: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    const threadWork =
      threadLaneKey === null
        ? work
        : () =>
            this.runInSerialLane({
              key: threadLaneKey,
              lanes: this.threadLaneTails,
              work,
            });
    if (!environmentLaneMode) {
      return threadWork();
    }
    if (!("environmentId" in command) || !command.environmentId) {
      throw new Error(`Command ${command.type} is missing environmentId`);
    }
    return this.runInEnvironmentLane(
      command.environmentId,
      environmentLaneMode,
      threadWork,
    );
  }

  private runInThreadTurnLane<T>(
    command: HostDaemonCommand,
    work: () => Promise<T>,
  ): Promise<T> {
    if (command.type !== "thread.start" && command.type !== "turn.submit") {
      return work();
    }
    return this.runInSerialLane({
      key: command.threadId,
      lanes: this.threadTurnLaneTails,
      work,
    });
  }

  private createDispatchOptions(): CommandDispatchOptions {
    return {
      fetchProjectAttachment: this.options.fetchProjectAttachment,
      fetchSkillTree: this.options.fetchSkillTree,
      fetchPluginHostArtifact: this.options.fetchPluginHostArtifact,
      runtimeManager: this.options.runtimeManager,
      terminalManager: this.options.terminalManager,
      dataDir: this.options.dataDir,
      eventSink: this.options.eventSink,
      listModels: this.options.listModels,
      providerHealth: this.options.providerHealth,
      providerUsage: this.options.providerUsage,
      providerInstallationStatus: this.options.providerInstallationStatus,
      providerInstallationRun: this.options.providerInstallationRun,
      resolveInteractiveRequest: this.options.resolveInteractiveRequest,
      ensureConnectTunnelIdentity: this.options.ensureConnectTunnelIdentity,
      threadStorageRootPath: this.options.threadStorageRootPath,
      logger: this.options.logger,
    };
  }

  private logOnlineRpc(args: {
    commandType: HostDaemonRpcCommand["type"];
    errorCode?: string;
    handlerMs: number;
    ok: boolean;
  }): void {
    const shouldLog =
      args.handlerMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS || !args.ok;
    if (!shouldLog) {
      return;
    }

    this.logger.debug?.(
      {
        commandType: args.commandType,
        ...(args.errorCode ? { errorCode: args.errorCode } : {}),
        handlerMs: roundDurationMs(args.handlerMs),
        ok: args.ok,
      },
      "Online host RPC",
    );
  }

  private getOrCreateReadWriteLane(
    key: string,
    lanes: Map<string, ReadWriteLaneState>,
  ): ReadWriteLaneState {
    const existing = lanes.get(key);
    if (existing) {
      return existing;
    }
    const resolved = Promise.resolve();
    const state: ReadWriteLaneState = {
      tail: resolved,
      writeTail: resolved,
    };
    lanes.set(key, state);
    return state;
  }

  /**
   * Order a turn submission after any in-flight unarchive for the same thread.
   * thread.unarchive runs on the provider maintenance runtime while turn.submit
   * resumes the thread runtime, so the two are otherwise unordered and a turn
   * can reach the provider before the session is unarchived.
   */
  private async runAfterThreadUnarchiveBarrier<T>(
    command: HostDaemonCommand,
    work: () => Promise<T>,
  ): Promise<T> {
    if (command.type === "turn.submit" || command.type === "thread.start") {
      const barrier = this.threadUnarchiveBarriers.get(command.threadId);
      if (barrier) {
        await barrier;
      }
    }
    return work();
  }

  private registerThreadUnarchiveBarrier(
    command: HostDaemonCommand,
    task: CommandRouterTask,
  ): void {
    if (command.type !== "thread.unarchive") {
      return;
    }
    const { threadId } = command;
    const barrier = task.then(
      () => undefined,
      () => undefined,
    );
    this.threadUnarchiveBarriers.set(threadId, barrier);
    void barrier.then(() => {
      if (this.threadUnarchiveBarriers.get(threadId) === barrier) {
        this.threadUnarchiveBarriers.delete(threadId);
      }
    });
  }

  private runInSerialLane<T>({
    key,
    lanes,
    work,
  }: SerialLaneArgs<T>): Promise<T> {
    const previousTail = lanes.get(key) ?? Promise.resolve();
    const next = previousTail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    lanes.set(key, done);
    void done.then(() => {
      if (lanes.get(key) === done) {
        lanes.delete(key);
      }
    });
    return next;
  }

  private runInReadWriteLane<T>({
    key,
    lanes,
    mode,
    work,
  }: ReadWriteLaneArgs<T>): Promise<T> {
    const state = this.getOrCreateReadWriteLane(key, lanes);
    if (mode === "read") {
      const previousWrite = state.writeTail;
      const next = previousWrite.catch(() => undefined).then(work);
      const done = next.then(
        () => undefined,
        () => undefined,
      );
      const previousTail = state.tail;
      // Reads only wait for earlier writes, so adjacent reads can run together.
      // They still join the full tail so later writes wait for every active read.
      const tail = Promise.all([
        previousTail.catch(() => undefined),
        done,
      ]).then(() => undefined);
      state.tail = tail;
      this.deleteReadWriteLaneWhenIdle({ key, lanes, state, tail });
      return next;
    }

    const next = state.tail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    state.tail = done;
    state.writeTail = done;
    this.deleteReadWriteLaneWhenIdle({ key, lanes, state, tail: done });
    return next;
  }

  private deleteReadWriteLaneWhenIdle({
    key,
    lanes,
    state,
    tail,
  }: ReadWriteLaneIdleArgs): void {
    void tail.then(() => {
      if (lanes.get(key) === state && state.tail === tail) {
        lanes.delete(key);
      }
    });
  }

  /**
   * The lane a thread-scoped command runs in, or null for commands that
   * drive no thread's provider session. A thread.stop for a thread the
   * runtime does not know yet (its thread.start still in flight) lands on
   * the same key as that start, so it is ordered after the handoff without
   * any registry of in-flight constructions.
   */
  private resolveThreadLaneKey(command: HostDaemonCommand): string | null {
    switch (command.type) {
      case "thread.start":
      case "turn.submit":
      case "thread.archive":
      case "interactive.resolve":
      case "thread.stop":
      case "thread.plan.cancel":
      case "thread.goal.clear":
        return `${command.environmentId}\0thread:${command.threadId}`;
      default:
        return null;
    }
  }
}
