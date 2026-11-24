import type {
  BbNavigate,
  BbPluginApi,
  ExperimentalPanelController,
  ExperimentalPluginActionContext,
  PluginBrowserBbSdk,
  MessageDispatchHookContext,
  PluginAgentConfigurationContext,
  PluginThreadEventPayloads,
} from "@get-bb/plugin-sdk";
import { testSettingsHref, testThreadHref } from "./navigation-hrefs.js";

type HostResponse = Awaited<
  ReturnType<BbPluginApi["sdk"]["hosts"]["list"]>
>[number];
type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
type QueueEntry = PluginThreadEventPayloads["message.queued"]["entry"];
type TurnFailedEvent = PluginThreadEventPayloads["turn.failed"];
type PluginAgentConfigurationContextOverrides = {
  pluginMetadata?: PluginAgentConfigurationContext["pluginMetadata"];
  thread?: Partial<PluginAgentConfigurationContext["thread"]>;
  project?: Partial<PluginAgentConfigurationContext["project"]>;
  environment?: Partial<PluginAgentConfigurationContext["environment"]>;
  host?: Partial<PluginAgentConfigurationContext["host"]>;
  provider?: Omit<
    Partial<PluginAgentConfigurationContext["provider"]>,
    "capabilities"
  > & {
    capabilities?: Partial<
      PluginAgentConfigurationContext["provider"]["capabilities"]
    >;
  };
  origin?: Partial<PluginAgentConfigurationContext["origin"]>;
};
type MessageDispatchHookContextOverrides = Omit<
  Partial<MessageDispatchHookContext>,
  | "thread"
  | "project"
  | "environment"
  | "host"
  | "input"
  | "requestedExecution"
  | "executionSources"
  | "queuedMessages"
> & {
  thread?: Partial<MessageDispatchHookContext["thread"]>;
  project?: Partial<MessageDispatchHookContext["project"]>;
  environment?: Partial<
    NonNullable<MessageDispatchHookContext["environment"]>
  > | null;
  host?: Partial<NonNullable<MessageDispatchHookContext["host"]>> | null;
  input?: Partial<MessageDispatchHookContext["input"]>;
  requestedExecution?: Partial<
    MessageDispatchHookContext["requestedExecution"]
  >;
  executionSources?: Partial<MessageDispatchHookContext["executionSources"]>;
  queuedMessages?: Partial<
    MessageDispatchHookContext["queuedMessages"][number]
  >[];
};

/**
 * A complete, deterministic host response for faking `bb.sdk.hosts.list()`
 * and environment-provider contexts. Override only the fields the test cares
 * about. If the contract grows a required field, this builder fails
 * typecheck — update the default here.
 */
export function makeHostResponse(
  overrides: Partial<HostResponse> = {},
): HostResponse {
  return {
    id: "host-1",
    name: "Test host",
    type: "persistent",
    status: "connected",
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    route: null,
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic `ThreadResponse` for thread lifecycle event
 * payloads (`harness.emitThreadEvent`). Defaults are the minimal idle
 * thread; override the fields the test cares about. If the contract grows a
 * required field, this builder fails typecheck — update the default here.
 */
export function makeThreadResponse(
  overrides: Partial<ThreadResponse> = {},
): ThreadResponse {
  return {
    id: "thread-1",
    projectId: "project-1",
    environmentId: null,
    providerId: "test-provider",
    title: null,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    parentNotifications: "auto",
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
    runtime: { displayStatus: "idle" },
    activeBackgroundAgentCount: 0,
    canRestoreEnvironment: false,
    canEditMessages: true,
    canSpawnChild: true,
    queuedMessageCount: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic context for conditional agent configuration.
 * Defaults describe a standard project on an unmanaged local environment;
 * override the fields the test cares about. If the contract grows a required
 * field, this builder fails typecheck — update the default here.
 */
export function makePluginAgentConfigurationContext(
  overrides: PluginAgentConfigurationContextOverrides = {},
): PluginAgentConfigurationContext {
  const context: PluginAgentConfigurationContext = {
    pluginMetadata: {},
    thread: {
      id: "thread-test",
      title: null,
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "project-test",
      kind: "standard",
      name: "Test project",
      gitRemoteUrl: null,
    },
    environment: {
      id: "environment-test",
      name: null,
      path: "/tmp/test",
      branchName: null,
      workspaceProvisionType: null,
    },
    host: { id: "host-test", name: "Test host" },
    provider: {
      id: "test-provider",
      model: "test-model",
      capabilities: { supportsNativeUserQuestion: false },
    },
    origin: { kind: null, pluginId: null },
  };
  return {
    pluginMetadata: overrides.pluginMetadata ?? context.pluginMetadata,
    thread: { ...context.thread, ...overrides.thread },
    project: { ...context.project, ...overrides.project },
    environment: { ...context.environment, ...overrides.environment },
    host: { ...context.host, ...overrides.host },
    provider: {
      ...context.provider,
      ...overrides.provider,
      capabilities: {
        ...context.provider.capabilities,
        ...overrides.provider?.capabilities,
      },
    },
    origin: { ...context.origin, ...overrides.origin },
  };
}

/**
 * A complete, deterministic context for the `message.dispatch` hook. Defaults
 * describe a first inline dispatch before an environment or host is selected;
 * override the fields the test cares about. If the contract grows a required
 * field, this builder fails typecheck — update the default here.
 */
export function makeMessageDispatchHookContext(
  overrides: MessageDispatchHookContextOverrides = {},
): MessageDispatchHookContext {
  const context: MessageDispatchHookContext = {
    thread: makeThreadResponse({ status: "pending" }),
    project: {
      id: "project-1",
      kind: "standard",
      name: "Test project",
      gitRemoteUrl: null,
      createdAt: 0,
      updatedAt: 0,
    },
    environment: null,
    host: null,
    input: { blocks: [], text: "Test message" },
    requestedExecution: {
      providerId: "test-provider",
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    executionSources: {
      providerId: null,
      model: null,
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: null,
    },
    attempt: "start-turn",
    initiator: "user",
    senderThreadId: null,
    queuedMessages: [],
    experimental_submission: null,
    origin: null,
    originPluginId: null,
    parentThreadId: null,
    environmentIntent: null,
  };
  const environmentDefaults: NonNullable<
    MessageDispatchHookContext["environment"]
  > = {
    id: "environment-1",
    name: null,
    projectId: "project-1",
    hostId: "host-1",
    path: "/tmp/test",
    additionalPaths: [],
    isGitRepo: true,
    isWorktree: false,
    branchName: "main",
    baseBranch: null,
    defaultBranch: "main",
    mergeBaseBranch: null,
    environmentProviderId: null,
    environmentProviderSelection: null,
    environmentProviderInstanceKey: null,
    lifecycle: { phase: "active", retireAt: null, teardown: null },
    hostLifecycle: "active",
    managed: false,
    heldBy: null,
    workspaceProvisionType: null,
    status: "ready",
    statusMessage: null,
    createdAt: 0,
    updatedAt: 0,
  };
  const hostDefaults = makeHostResponse();
  const project = { ...context.project, ...overrides.project };
  const host =
    overrides.host === undefined
      ? context.host
      : overrides.host === null
        ? null
        : { ...hostDefaults, ...overrides.host };
  const environment =
    overrides.environment === undefined
      ? context.environment
      : overrides.environment === null
        ? null
        : {
            ...environmentDefaults,
            projectId: project.id,
            hostId: host?.id ?? environmentDefaults.hostId,
            ...overrides.environment,
          };
  const thread = {
    ...context.thread,
    projectId: project.id,
    environmentId: environment?.id ?? null,
    ...overrides.thread,
  };
  return {
    ...context,
    ...overrides,
    thread,
    project,
    environment,
    host,
    input: { ...context.input, ...overrides.input },
    requestedExecution: {
      ...context.requestedExecution,
      ...overrides.requestedExecution,
    },
    executionSources: {
      ...context.executionSources,
      ...overrides.executionSources,
    },
    queuedMessages: (overrides.queuedMessages ?? context.queuedMessages).map(
      (message) => makeQueueEntry({ threadId: thread.id, ...message }),
    ),
  };
}

/**
 * A complete, deterministic queued row for the `message.*` event payloads
 * and for faking `sdk.threads.queuedMessages.list`. Defaults are a live inline
 * row on this plugin's wait; override what the test is about. If the
 * contract grows a required field, this builder fails typecheck — update the
 * default here.
 */
export function makeQueueEntry(
  overrides: Partial<QueueEntry> = {},
): QueueEntry {
  return {
    id: "queued_1",
    origin: null,
    originPluginId: null,
    initiator: "user",
    senderThreadId: null,
    threadId: "thread-1",
    content: [{ type: "text", text: "Queued turn", mentions: [] }],
    model: "test-model",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    sendAt: null,
    state: "waiting",
    waitingOn: {
      kind: "plugin",
      pluginId: "test-plugin",
      reason: "Waiting",
    },
    failureReason: null,
    payload: { kind: "inline" },
    systemNotice: null,
    editable: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/**
 * A complete, deterministic `turn.failed` payload. Defaults are a first attempt
 * that failed inside a provider turn with neither structured error info nor
 * rate limits — the shape a retry policy must handle before it handles the
 * interesting ones. If the contract grows a required field, this builder fails
 * typecheck — update the default here.
 */
export function makeTurnFailedEvent(
  overrides: Partial<TurnFailedEvent> = {},
): TurnFailedEvent {
  return {
    threadId: "thread-1",
    requestId: "creq_2222222222",
    turnId: "turn-1",
    errorInfo: null,
    inputAccepted: true,
    rateLimits: null,
    attemptNumber: 1,
    originPluginId: null,
    ...overrides,
  };
}

/**
 * A side panel controller for tests that call a command, thread action or
 * message action directly: every call declines and `getTabs()` reports a
 * closed, empty panel, except the methods in `overrides`.
 */
export function makePanelController(
  overrides: Partial<ExperimentalPanelController> = {},
): ExperimentalPanelController {
  return {
    openTab: () => false,
    toggleTab: () => false,
    close: () => false,
    getTabs: () => ({ open: false, selectedKey: null, tabs: [] }),
    selectTab: () => false,
    closeTab: () => false,
    ...overrides,
  };
}

/** One call recorded by {@link makeActionContext}'s default members. */
export interface ExperimentalActionContextCall {
  /** `"threadRequests.requestArchive"`, `"threadRequests.requestDelete"`, `"navigate.<method>"` or `"sdk.<area>.<method>"`. */
  member: string;
  args: unknown[];
}

/** A complete callback context plus the log of its default members' calls. */
export interface ExperimentalActionContextFixture extends ExperimentalPluginActionContext {
  /** Calls to the members `overrides` did not replace, in order. */
  readonly calls: ExperimentalActionContextCall[];
}

/**
 * A complete callback context for tests that call a command, thread action,
 * message action or composer callback directly, so a test lists only the
 * members it uses and keeps compiling when bb adds one. Defaults record each
 * call in `calls`: `threadRequests` methods resolve, `composer` is null,
 * `navigate` methods return false except the href builders, which return
 * `/threads/<id>` and settings paths, `panel` is
 * {@link makePanelController}'s, and `sdk` methods reject because a test that reads data should stub it. Spread the
 * result and add a context's own fields, such as a command's `threadId` or a
 * thread action's `thread`.
 */
export function makeActionContext(
  overrides: Partial<ExperimentalPluginActionContext> = {},
): ExperimentalActionContextFixture {
  const calls: ExperimentalActionContextCall[] = [];
  const record = (member: string, args: unknown[]) => {
    calls.push({ member, args });
  };
  const hrefs: Pick<
    BbNavigate,
    "experimental_threadHref" | "experimental_settingsHref"
  > = {
    experimental_threadHref: (threadId, options) => {
      record("navigate.experimental_threadHref", [threadId, options]);
      return testThreadHref(threadId, options);
    },
    experimental_settingsHref: (target) => {
      record("navigate.experimental_settingsHref", [target]);
      return testSettingsHref(target, "test-plugin");
    },
  };
  const navigate = new Proxy(hrefs as BbNavigate, {
    get: (target, method) =>
      Reflect.get(target, method) ??
      ((...args: unknown[]) => {
        record(`navigate.${String(method)}`, args);
        return false;
      }),
  });
  const sdk = new Proxy({} as PluginBrowserBbSdk, {
    get: (_target, area) =>
      new Proxy(
        {},
        {
          get:
            (_area, method) =>
            (...args: unknown[]) => {
              const member = `sdk.${String(area)}.${String(method)}`;
              record(member, args);
              return Promise.reject(
                new Error(
                  `${member} is not stubbed; pass sdk in the overrides`,
                ),
              );
            },
        },
      ),
  });
  return {
    sdk: overrides.sdk ?? sdk,
    navigate: overrides.navigate ?? navigate,
    panel: overrides.panel ?? makePanelController(),
    composer: overrides.composer ?? null,
    threadRequests: overrides.threadRequests ?? {
      async requestArchive(threadIds) {
        record("threadRequests.requestArchive", [threadIds]);
      },
      async requestDelete(threadIds) {
        record("threadRequests.requestDelete", [threadIds]);
      },
    },
    calls,
  };
}
