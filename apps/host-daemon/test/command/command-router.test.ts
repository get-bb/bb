import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
import { WorkspaceError } from "@bb/host-workspace";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import {
  CommandRouter,
  type CommandRouterOptions,
} from "../../src/command-router.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import {
  createHarness,
  unexpectedProjectAttachmentFetch,
} from "./dispatch-helpers.js";
import { RuntimeManager } from "../../src/runtime-manager.js";

type EnvironmentDestroyCommand = Extract<
  HostDaemonCommand,
  { type: "environment.destroy" }
>;
type EnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision" }
>;
type RouterHarness = ReturnType<typeof createHarness>;
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: Error): void;
  resolve(value: T | PromiseLike<T>): void;
}

interface RunRouterCommandArgs {
  command: HostDaemonCommand;
  requestId: string;
  router: CommandRouter;
}

interface CreateRouterArgs {
  logger?: CommandRouterOptions["logger"];
  runtimeManager?: RuntimeManager;
}

let nextClientRequestIdValue = 1;

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectDeferred: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  if (!resolveDeferred || !rejectDeferred) {
    throw new Error("Deferred promise callbacks were not initialized");
  }
  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function createClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

function createRouter(
  harness: RouterHarness,
  args: CreateRouterArgs = {},
): CommandRouter {
  return new CommandRouter({
    dataDir: "/tmp/bb-router-test-data",
    eventSink: noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    logger: {
      debug: () => undefined,
      warn: () => undefined,
      ...args.logger,
    },
    runtimeManager: args.runtimeManager ?? harness.manager,
    threadStorageRootPath: "/tmp/bb-router-test-thread-storage",
  });
}

function createTurnSubmitCommand(): TurnSubmitCommand {
  return {
    type: "turn.submit",
    environmentId: "env-router",
    threadId: "thread-router",
    requestId: createClientRequestId(),
    input: [textPromptInput("after destroy")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    resumeContext: {
      workspaceContext: {
        workspacePath: "/tmp/env-router",
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-router",
      providerId: "fake",
      providerThreadId: "provider-thread-router",
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: { mode: "start" },
  };
}

function createThreadStartCommand(): ThreadStartCommand {
  return {
    type: "thread.start",
    environmentId: "env-router",
    threadId: "thread-router-start",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
      workspaceProvisionType: "unmanaged",
    },
    projectId: "project-router",
    providerId: "fake",
    requestId: createClientRequestId(),
    input: [textPromptInput("start")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    instructions: "Be a helpful coding agent.",
    dynamicTools: [],
    injectedSkillSources: [],
    instructionMode: "append",
  };
}

function textPromptInput(text: string): TextPromptInput {
  return { type: "text", text, mentions: [] };
}

function createEnvironmentDestroyCommand(): EnvironmentDestroyCommand {
  return {
    type: "environment.destroy",
    environmentId: "env-router",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
      workspaceProvisionType: "unmanaged",
    },
  };
}

function createEnvironmentProvisionCommand(): EnvironmentProvisionCommand {
  return {
    type: "environment.provision",
    environmentId: "env-router",
    initiator: null,
    workspaceProvisionType: "unmanaged",
    path: "/tmp/env-router",
  };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function runRouterCommand({
  command,
  requestId,
  router,
}: RunRouterCommandArgs): Promise<HostDaemonOnlineRpcResponseMessage> {
  const message: HostDaemonOnlineRpcRequestMessage = {
    type: "host-rpc.request",
    requestId,
    command,
  };
  return router.handleOnlineRpcRequest(message);
}

describe("CommandRouter", () => {
  it("does not warn for expected provision cancellation RPC failures", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    const logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    const runtimeManager = new RuntimeManager({
      createRuntime: () => harness.runtime,
      provisionWorkspace: async () => {
        throw new WorkspaceError(
          "provision_cancelled",
          "Workspace provisioning was cancelled",
        );
      },
    });
    const router = createRouter(harness, { logger, runtimeManager });

    const response = await runRouterCommand({
      command: createEnvironmentProvisionCommand(),
      requestId: "provision-cancelled-env-router",
      router,
    });

    expect(response).toMatchObject({
      ok: false,
      errorCode: "provision_cancelled",
      errorMessage: "Workspace provisioning was cancelled",
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("orders turn.submit after an in-flight environment destroy", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const destroyStarted = createDeferred<void>();
    const releaseDestroy = createDeferred<void>();
    harness.workspace.destroy = async () => {
      destroyStarted.resolve();
      await releaseDestroy.promise;
    };

    const router = createRouter(harness);
    const destroyTask = runRouterCommand({
      command: createEnvironmentDestroyCommand(),
      requestId: "destroy-env-router",
      router,
    });
    await destroyStarted.promise;

    const turnTask = runRouterCommand({
      command: createTurnSubmitCommand(),
      requestId: "turn-env-router",
      router,
    });
    await flushAsyncWork();

    expect(harness.runtimeState.ranTurnText).toBeUndefined();

    releaseDestroy.resolve();
    const destroyResponse = await destroyTask;
    expect(destroyResponse.ok).toBe(true);
    const turnResponse = await turnTask;
    expect(turnResponse.ok).toBe(true);
    expect(harness.runtimeState.ranTurnText).toBe("after destroy");
  });

  it("orders thread.stop after an in-flight thread.start handoff", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const startEntered = createDeferred<void>();
    const releaseStart = createDeferred<void>();
    const originalStartThread = harness.runtime.startThread;
    harness.runtime.startThread = async (args) => {
      startEntered.resolve();
      await releaseStart.promise;
      return originalStartThread(args);
    };

    const router = createRouter(harness);
    const startTask = runRouterCommand({
      command: createThreadStartCommand(),
      requestId: "start-env-router",
      router,
    });
    await startEntered.promise;

    let stopResolved = false;
    const stopTask = runRouterCommand({
      command: {
        type: "thread.stop",
        environmentId: "env-router",
        threadId: "thread-router-start",
      },
      requestId: "stop-env-router",
      router,
    }).then((response) => {
      stopResolved = true;
      return response;
    });
    await flushAsyncWork();

    // The stop routes into the in-flight start's provider lane and must not
    // reach the runtime before the start handoff completes.
    expect(harness.runtimeState.stoppedThreadId).toBeUndefined();
    expect(stopResolved).toBe(false);

    releaseStart.resolve();
    const startResponse = await startTask;
    expect(startResponse.ok).toBe(true);
    const stopResponse = await stopTask;

    expect(stopResponse.ok).toBe(true);
    expect(harness.runtimeState.stoppedThreadId).toBe("thread-router-start");
    expect(harness.runtime.hasThread("thread-router-start")).toBe(false);
  });
});
