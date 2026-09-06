import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  BROWSER_CAPTURE_MAX_LIFETIME_MS,
  browserUrlMatches,
  isBrowserTransitionWaitAction,
  decodeBrowserCaptureChunk,
  browserWaitResultSchema,
  realtimeSubscriptionTargetKey as subscriptionKey,
  type RealtimeSubscriptionTarget,
  type ChangedMessage,
  type EnvironmentChangeKind,
  type HostChangeKind,
  type ProjectChangeKind,
  type SystemChangeKind,
  type ThreadChangeKind,
  type ThreadChangeMetadata,
  type ThreadEventType,
  type JsonValue,
} from "@bb/domain";
import type { DbNotifier } from "@bb/db";
import type {
  HostPlatform,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonServerWsMessage,
  HostDaemonSessionCloseReason,
} from "@bb/host-daemon-contract";
import {
  pluginSignalSchema,
  browserActionabilityPolicySchema,
  browserControlRequestMessageSchema,
  browserOpenTabRequestMessageSchema,
  type BrowserClientStateMessage,
  type BrowserControllerRegistration,
  type BrowserControlAction,
  type BrowserControlError,
  type BrowserControlResponseMessage,
  type BrowserOpenTabResponseMessage,
  type BrowserTabDescriptor,
  type BrowserTabOwnerDescriptor,
  type BrowserTabTarget,
  browserCaptureReadRequestMessageSchema,
  browserCaptureCreateMessageSchema,
  browserCaptureRegisteredMessageSchema,
  browserCaptureReleaseMessageSchema,
  browserPluginRequestMessageSchema,
  serverMessageSchema,
  terminalServerMessageSchema,
  threadOpenSignalSchema,
  threadPaneActionSignalSchema,
  type BrowserCaptureReadResponse,
  type BrowserCaptureReadResponseMessage,
  type BrowserCaptureDescriptor,
  type BrowserCaptureDescriptorMessage,
  type BrowserCaptureRegisterMessage,
  type BrowserPageLocator,
  type BrowserPluginResponseMessage,
  type ThreadPaneAction,
  type ThreadOpenFile,
  type ThreadOpenSplit,
  type TerminalServerMessage,
} from "@bb/server-contract";

const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const TERMINAL_SOCKET_DRAIN_POLL_MS = 10;
const THREAD_LIST_EVENTS_APPENDED_COALESCE_MS = 1_000;
const LIST_RELEVANT_THREAD_EVENT_TYPES: ReadonlySet<ThreadEventType> =
  new Set<ThreadEventType>(["client/turn/requested", "turn/completed"]);

/**
 * Broker-side capture budget. The desktop capture store allows one capture up
 * to 256 MiB and 512 MiB aggregate per window; the broker mirrors the
 * aggregate bound per owner client so oversized or accumulating captures are
 * rejected before they can consume remote memory.
 */
const BROWSER_CAPTURE_MAX_ENCODED_BYTES = 256 * 1024 * 1024;
const BROWSER_CAPTURE_AGGREGATE_MAX_BYTES = 512 * 1024 * 1024;
/** Captures older than this are released and reaped without affecting peers. */
const BROWSER_CAPTURE_TTL_MS = 2 * 60_000;

/** Resolve the owner that brokers the given registered tab, if exactly one. */
function ownerForTab(
  registration: BrowserClientRegistration,
  tab: BrowserTabDescriptor,
): string | null {
  const matches = [...registration.owners.values()].filter(
    (owner) =>
      owner.threadId === tab.threadId && owner.projectId === tab.projectId,
  );
  const activeMatches = matches.filter((owner) => owner.active);
  const candidates = activeMatches.length > 0 ? activeMatches : matches;
  return candidates.length === 1 ? (candidates[0]?.ownerId ?? null) : null;
}

function browserControllerKey(args: {
  pluginId: string;
  controllerId: string;
  tabId: string;
}): string {
  return `${args.pluginId}\u0000${args.controllerId}\u0000${args.tabId}`;
}

interface HubSocket {
  close(code?: number, reason?: string): void;
  raw?: { bufferedAmount: number };
  send(data: string): void;
}

interface TerminalSocketSendQueue {
  bytes: number;
  payloads: string[];
  timeout: ReturnType<typeof setTimeout> | null;
}

type ChangedMessageListener = (message: ChangedMessage) => void;

interface PendingThreadListEventsAppended {
  eventTypes: Set<ThreadEventType>;
  merged: boolean;
  timeout: ReturnType<typeof setTimeout>;
}

type ThreadChangedMessage = Extract<ChangedMessage, { entity: "thread" }>;

function isThreadListRelevantChange(
  message: Pick<ThreadChangedMessage, "changes" | "metadata">,
): boolean {
  if (message.changes.some((change) => change !== "events-appended")) {
    return true;
  }
  const metadata = message.metadata;
  if (metadata === undefined) {
    return false;
  }
  return (
    metadata.backgroundActivityChanged === true ||
    metadata.hasPendingInteraction !== undefined ||
    metadata.projectId !== undefined ||
    (metadata.eventTypes?.some((eventType) =>
      LIST_RELEVANT_THREAD_EVENT_TYPES.has(eventType),
    ) ??
      false)
  );
}

function subscriptionKeysForMessage(message: ChangedMessage): string[] {
  switch (message.entity) {
    case "thread":
      return message.id
        ? [
            subscriptionKey({ kind: "thread-list" }),
            subscriptionKey({ kind: "thread-detail", threadId: message.id }),
          ]
        : [subscriptionKey({ kind: "thread-list" })];
    case "project":
      return message.id
        ? [
            subscriptionKey({ kind: "project-list" }),
            subscriptionKey({ kind: "project-detail", projectId: message.id }),
          ]
        : [subscriptionKey({ kind: "project-list" })];
    case "environment":
      return message.id
        ? [
            subscriptionKey({ kind: "environment-list" }),
            subscriptionKey({
              kind: "environment-detail",
              environmentId: message.id,
            }),
          ]
        : [subscriptionKey({ kind: "environment-list" })];
    case "host":
      return message.id
        ? [
            subscriptionKey({ kind: "host-list" }),
            subscriptionKey({ kind: "host-detail", hostId: message.id }),
          ]
        : [subscriptionKey({ kind: "host-list" })];
    case "system":
      return [subscriptionKey({ kind: "system" })];
  }
}

interface ThreadEventWaiter {
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface DaemonRegistrationWaiter {
  resolve: (registered: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostOnlineRpcWaiter {
  reject: (reason?: Error) => void;
  resolve: (message: HostDaemonOnlineRpcResponseMessage) => void;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface BrowserClientRegistration {
  active: boolean;
  canActivateThreadOwner: boolean;
  clientId: string;
  windowId: string;
  socket: HubSocket;
  tabs: Map<string, BrowserTabDescriptor>;
  owners: Map<string, BrowserTabOwnerDescriptor>;
  controllers: Map<string, BrowserControllerRegistration>;
}

/**
 * The thread/project identity the broker resolved for a waiter when it was
 * created. Every waiter is bound to the original owner so a reassigned or
 * replaced owner can never answer another owner's request.
 */
type BrowserOwnerBinding = {
  clientId: string;
  ownerId: string;
  projectId: string | null;
  threadId: string | null;
  windowId: string;
};

interface BrowserControlWaiter {
  /** True only for wait actions that legitimately observe a navigation commit. */
  allowEpochAdvance: boolean;
  /**
   * True only for the close-tab lifecycle action: the source tab disappears
   * as the direct effect of the action itself. Other actions whose source
   * tab disappears must be invalidated.
   */
  allowTabRemoval: boolean;
  /** Owner + lifecycle the broker pinned when the waiter was registered. */
  binding: BrowserOwnerBinding;
  target: BrowserTabTarget;
  action: BrowserControlAction;
  socket: HubSocket;
  resolve(value: JsonValue): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort: () => void;
}

type BrowserOpenTabBinding =
  | {
      kind: "owner";
      owner: BrowserTabOwnerDescriptor;
      clientId: string;
      ownerId: string;
      projectId: string;
      threadId: string;
      windowId: string;
    }
  | {
      kind: "thread";
      clientId: string;
      windowId: string;
      threadId: string;
      projectId: string;
    };

interface BrowserOpenTabWaiter {
  binding: BrowserOpenTabBinding;
  socket: HubSocket;
  resolve(target: BrowserTabTarget): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort: () => void;
}
interface BrowserCaptureChunkWaiter {
  binding: BrowserOwnerBinding;
  captureId: string;
  /** Bounded immutable provenance recorded when the capture was created. */
  captureByteLength: number;
  length: number;
  navigationEpoch: number;
  offset: number;
  resolve(chunk: BrowserCaptureReadResponse): void;
  reject(error: Error): void;
  socket: HubSocket;
  tabId: string;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort: () => void;
}

interface BrowserCaptureCreateWaiter {
  binding: BrowserOwnerBinding;
  expectedFormat: "png" | "jpeg" | null;
  navigationEpoch: number;
  resolve(descriptor: BrowserCaptureDescriptor): void;
  reject(error: Error): void;
  socket: HubSocket;
  tabId: string;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort: () => void;
}
interface BrowserCaptureCreateTombstone {
  socket: HubSocket;
  tabId: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface BrowserPluginRequestWaiter {
  binding: BrowserOwnerBinding;
  controllerId: string;
  pluginId: string;
  registrationId: string;
  resolve(value: JsonValue): void;
  reject(error: Error): void;
  socket: HubSocket;
  target: BrowserTabTarget;
  timeout: ReturnType<typeof setTimeout>;
  unlinkAbort: () => void;
}

/**
 * Immutable descriptor of one created capture, retained by the broker for
 * provenance-limited reads and releases. Reads stay valid across navigation
 * but never across tab/host disposal. Capacity is reclaimed when the owning
 * tab or client is unregistered.
 */
interface BrowserCaptureProvenance {
  absoluteExpiresAt: number;
  byteLength: number;
  captureId: string;
  clientId: string;
  createdAt: number;
  expiresAt: number;
  format: "png" | "jpeg";
  navigationEpoch: number;
  pixelSize: { height: number; width: number };
  tabId: string;
  windowId: string;
}

export class BrowserControlUnavailableError extends Error {
  constructor(message = "The target Browser tab is not connected") {
    super(message);
    this.name = "BrowserControlUnavailableError";
  }
}
export class BrowserControlRemoteError extends Error {
  readonly code: string;
  readonly details: JsonValue | undefined;

  constructor(error: BrowserControlError) {
    super(error.message);
    this.name = error.code;
    this.code = error.code;
    this.details = error.details;
  }
}

export class BrowserControlTargetChangedError extends Error {
  constructor() {
    super(
      "The target Browser tab navigated or changed before the action completed",
    );
    this.name = "BrowserControlTargetChangedError";
  }
}

export interface RecordHostOnlineRpcResponseArgs {
  message: HostDaemonOnlineRpcResponseMessage;
  sessionId: string;
}

type HostOnlineRpcResponseDisposition =
  | { handled: true }
  | { handled: false; reason: "stale" }
  | {
      expectedSessionId: string;
      handled: false;
      reason: "session_mismatch";
    };

export class HostOnlineRpcTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for host RPC response");
    this.name = "HostOnlineRpcTimeoutError";
  }
}

export class HostOnlineRpcUnavailableError extends Error {
  constructor() {
    super("Host daemon is not connected");
    this.name = "HostOnlineRpcUnavailableError";
  }
}

export class NotificationHub implements DbNotifier {
  private readonly clientKeysBySocket = new Map<HubSocket, Set<string>>();
  private readonly clientSocketsByKey = new Map<string, Set<HubSocket>>();
  private readonly browserClientsBySocket = new Map<
    HubSocket,
    BrowserClientRegistration
  >();
  private readonly browserClientsById = new Map<
    string,
    BrowserClientRegistration
  >();
  private readonly browserControlWaiters = new Map<
    string,
    BrowserControlWaiter
  >();
  private readonly browserOpenTabWaiters = new Map<
    string,
    BrowserOpenTabWaiter
  >();
  private readonly browserCaptureChunkWaiters = new Map<
    string,
    BrowserCaptureChunkWaiter
  >();
  private readonly browserCaptureCreateTombstones = new Map<
    string,
    BrowserCaptureCreateTombstone
  >();
  private readonly browserCaptureCreateWaiters = new Map<
    string,
    BrowserCaptureCreateWaiter
  >();
  private readonly browserPluginRequestWaiters = new Map<
    string,
    BrowserPluginRequestWaiter
  >();
  private readonly browserCaptureProvenance = new Map<
    string,
    BrowserCaptureProvenance
  >();
  /** Aggregate encoded capacity currently retained per owner client. */
  private readonly browserCaptureCapacityByClient = new Map<string, number>();
  private browserPluginContributionAuthorizer: (pluginId: string) => boolean =
    () => true;
  private readonly daemonSessions = new Map<
    string,
    {
      hostId: string;
      localApiPort: number | null;
      platform: HostPlatform;
      socket: HubSocket;
    }
  >();
  private readonly daemonSessionLocalApiPortsBySessionId = new Map<
    string,
    number | null
  >();
  private readonly daemonSessionPlatformsBySessionId = new Map<
    string,
    HostPlatform
  >();
  private readonly daemonRegistrationWaiters = new Map<
    string,
    Set<DaemonRegistrationWaiter>
  >();
  private readonly daemonSessionIdsByHost = new Map<string, string>();
  private readonly hostOnlineRpcWaiters = new Map<
    string,
    HostOnlineRpcWaiter
  >();
  private readonly hostProtocolUpdateRetryRequests = new Set<string>();
  private readonly changedMessageListeners = new Set<ChangedMessageListener>();
  private readonly pendingDaemonDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingDaemonActiveWorkDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly terminalClientSocketsById = new Map<
    string,
    Set<HubSocket>
  >();
  private readonly terminalSocketSendQueues = new Map<
    HubSocket,
    TerminalSocketSendQueue
  >();
  private readonly terminalIdsByClientSocket = new Map<
    HubSocket,
    Set<string>
  >();
  private readonly terminalResizeOwnerById = new Map<string, HubSocket>();
  private readonly threadEventWaiters = new Map<
    string,
    Set<ThreadEventWaiter>
  >();
  private readonly pendingThreadListEventsAppendedByThread = new Map<
    string,
    PendingThreadListEventsAppended
  >();

  registerClient(socket: HubSocket): void {
    if (!this.clientKeysBySocket.has(socket)) {
      this.clientKeysBySocket.set(socket, new Set());
    }
  }

  unregisterClient(socket: HubSocket): void {
    this.unregisterTerminalClientSocket(socket);
    this.unregisterBrowserClient(socket);
    const keys = this.clientKeysBySocket.get(socket);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      const sockets = this.clientSocketsByKey.get(key);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.clientSocketsByKey.delete(key);
      }
    }

    this.clientKeysBySocket.delete(socket);
  }

  setBrowserPluginContributionAuthorizer(
    authorizer: (pluginId: string) => boolean,
  ): void {
    this.browserPluginContributionAuthorizer = authorizer;
  }

  cancelBrowserPluginContributions(pluginId: string): void {
    for (const [requestId, waiter] of this.browserPluginRequestWaiters) {
      if (waiter.pluginId !== pluginId) continue;
      this.sendBrowserControlCancel(waiter.socket, requestId, "target-changed");
      this.rejectBrowserPluginRequestWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError(
          "The Browser contribution plugin was reloaded or disabled",
        ),
      );
    }
  }

  updateBrowserClient(
    socket: HubSocket,
    message: BrowserClientStateMessage,
  ): void {
    this.registerClient(socket);
    const existingForId = this.browserClientsById.get(message.clientId);
    const changedSocketForId =
      existingForId !== undefined && existingForId.socket !== socket;
    if (changedSocketForId) {
      this.unregisterBrowserClient(existingForId.socket);
    }
    const previous = this.browserClientsBySocket.get(socket);
    const socketBumped =
      previous !== undefined && previous.clientId !== message.clientId;
    if (socketBumped) {
      this.unregisterBrowserClient(socket);
    }
    const tabs = new Map(
      message.tabs.map((tab) => [
        tab.tabId,
        {
          ...tab,
          clientId: message.clientId,
          windowId: message.windowId,
        },
      ]),
    );
    const owners = new Map(
      message.owners.map((owner) => [
        owner.ownerId,
        {
          ...owner,
          clientId: message.clientId,
          windowId: message.windowId,
        },
      ]),
    );
    const controllers = new Map(
      message.controllers.map((controller) => [
        browserControllerKey(controller),
        controller,
      ]),
    );
    const priorRegistration = this.browserClientsBySocket.get(socket);
    const registration: BrowserClientRegistration = {
      active: message.active,
      canActivateThreadOwner: message.canActivateThreadOwner,
      clientId: message.clientId,
      windowId: message.windowId,
      socket,
      controllers,
      owners,
      tabs,
    };
    this.browserClientsBySocket.set(socket, registration);
    this.browserClientsById.set(message.clientId, registration);

    // A client state push is the broker's lifecycle signal. Every waiter
    // pinned to this client is re-checked against the identity it was
    // registered for: a replaced owner, moved tab, or client reconnect must
    // cancel (and cancel remotely) rather than wait for a stale answer.
    // An in-place navigation (same client, window, owner, tab) is an epoch
    // advance, not a lifecycle change, so waiters that allow the advance
    // survive it; reconnect/owner moves arrive on a new socket or a replaced
    // client identity, which no waiter can survive.
    const lifecycleBump = changedSocketForId || socketBumped;

    for (const [requestId, waiter] of this.browserControlWaiters) {
      if (waiter.socket !== socket) continue;
      const tab = tabs.get(waiter.target.tabId);
      if (tab === undefined) {
        if (!waiter.allowTabRemoval) {
          this.sendBrowserControlCancel(socket, requestId, "target-changed");
          this.rejectBrowserControlWaiter(
            requestId,
            waiter,
            new BrowserControlTargetChangedError(),
          );
        }
        continue;
      }
      if (
        tab.windowId !== waiter.target.windowId ||
        !this.ownerBindingMatches(waiter.binding, registration, owners, tab)
      ) {
        this.sendBrowserControlCancel(socket, requestId, "target-changed");
        this.rejectBrowserControlWaiter(
          requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
        continue;
      }
      if (tab.navigationEpoch !== waiter.target.navigationEpoch) {
        if (!waiter.allowEpochAdvance) {
          this.sendBrowserControlCancel(socket, requestId, "target-changed");
          this.rejectBrowserControlWaiter(
            requestId,
            waiter,
            new BrowserControlTargetChangedError(),
          );
        } else if (tab.navigationEpoch < waiter.target.navigationEpoch) {
          this.sendBrowserControlCancel(socket, requestId, "target-changed");
          this.rejectBrowserControlWaiter(
            requestId,
            waiter,
            new BrowserControlTargetChangedError(),
          );
        }
      }
    }
    for (const [requestId, waiter] of this.browserOpenTabWaiters) {
      if (waiter.socket !== socket) continue;
      if (waiter.binding.kind === "owner") {
        const owner = owners.get(waiter.binding.ownerId);
        if (
          owner === undefined ||
          owner.clientId !== waiter.binding.clientId ||
          owner.windowId !== waiter.binding.windowId ||
          owner.ownerId !== waiter.binding.ownerId ||
          owner.threadId !== waiter.binding.threadId ||
          owner.projectId !== waiter.binding.projectId
        ) {
          this.sendBrowserControlCancel(socket, requestId, "target-changed");
          this.rejectBrowserOpenTabWaiter(
            requestId,
            waiter,
            new BrowserControlUnavailableError(
              "The selected Browser panel owner is no longer available",
            ),
          );
        }
        continue;
      }
      if (lifecycleBump) {
        this.sendBrowserControlCancel(socket, requestId, "target-changed");
        this.rejectBrowserOpenTabWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(
            "The Browser client reconnected before the tab was created",
          ),
        );
      }
    }
    for (const [requestId, waiter] of this.browserCaptureChunkWaiters) {
      if (waiter.socket !== socket) continue;
      const tab = tabs.get(waiter.tabId);
      if (
        tab === undefined ||
        tab.windowId !== message.windowId ||
        !this.ownerBindingMatches(waiter.binding, registration, owners, tab) ||
        (waiter.navigationEpoch === tab.navigationEpoch && lifecycleBump)
      ) {
        this.sendBrowserControlCancel(socket, requestId, "target-changed");
        this.rejectBrowserCaptureChunkWaiter(
          requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
      }
    }
    for (const [requestId, waiter] of this.browserCaptureCreateWaiters) {
      if (waiter.socket !== socket) continue;
      const tab = tabs.get(waiter.tabId);
      if (
        tab === undefined ||
        tab.windowId !== message.windowId ||
        !this.ownerBindingMatches(waiter.binding, registration, owners, tab)
      ) {
        this.sendBrowserControlCancel(socket, requestId, "target-changed");
        this.rejectBrowserCaptureCreateWaiter(
          requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
      }
    }
    for (const [requestId, waiter] of this.browserPluginRequestWaiters) {
      if (waiter.socket !== socket) continue;
      const tab = tabs.get(waiter.target.tabId);
      const controller = controllers.get(
        browserControllerKey({
          pluginId: waiter.pluginId,
          controllerId: waiter.controllerId,
          tabId: waiter.target.tabId,
        }),
      );
      if (
        tab === undefined ||
        tab.windowId !== waiter.target.windowId ||
        tab.navigationEpoch !== waiter.target.navigationEpoch ||
        controller?.registrationId !== waiter.registrationId ||
        !this.ownerBindingMatches(waiter.binding, registration, owners, tab)
      ) {
        this.sendBrowserControlCancel(socket, requestId, "target-changed");
        this.rejectBrowserPluginRequestWaiter(
          requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
      }
    }
    this.reapCaptureProvenanceForRegistration(
      registration,
      priorRegistration,
      tabs,
    );
  }

  listBrowserTabs(): BrowserTabDescriptor[] {
    return [...this.browserClientsById.values()]
      .flatMap((registration) => [...registration.tabs.values()])
      .sort((a, b) =>
        [a.clientId, a.windowId, a.tabId]
          .join("\u0000")
          .localeCompare([b.clientId, b.windowId, b.tabId].join("\u0000")),
      );
  }

  listBrowserTabOwners(): BrowserTabOwnerDescriptor[] {
    return [...this.browserClientsById.values()]
      .flatMap((registration) => [...registration.owners.values()])
      .sort((a, b) =>
        [a.clientId, a.windowId, a.ownerId]
          .join("\u0000")
          .localeCompare([b.clientId, b.windowId, b.ownerId].join("\u0000")),
      );
  }

  openBrowserTab(args: {
    url: string;
    clientId?: string;
    windowId?: string;
    ownerId?: string;
    threadId?: string;
    projectId?: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<BrowserTabTarget> {
    const matches = this.listBrowserTabOwners().filter(
      (owner) =>
        (args.clientId === undefined || owner.clientId === args.clientId) &&
        (args.windowId === undefined || owner.windowId === args.windowId) &&
        (args.ownerId === undefined || owner.ownerId === args.ownerId) &&
        (args.threadId === undefined || owner.threadId === args.threadId) &&
        (args.projectId === undefined || owner.projectId === args.projectId),
    );
    const activeMatches = matches.filter((owner) => owner.active);
    const candidates = activeMatches.length > 0 ? activeMatches : matches;
    let binding: BrowserOpenTabBinding;
    let registration: BrowserClientRegistration | undefined;
    if (candidates.length > 1) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "Multiple visible BB Browser panel owners match; specify client, window, or owner",
        ),
      );
    }
    const owner = candidates[0];
    if (owner !== undefined) {
      registration = this.browserClientsById.get(owner.clientId);
      if (
        registration === undefined ||
        registration.windowId !== owner.windowId ||
        registration.owners.get(owner.ownerId) !== owner
      ) {
        return Promise.reject(new BrowserControlUnavailableError());
      }
      binding = {
        kind: "owner",
        owner,
        clientId: owner.clientId,
        ownerId: owner.ownerId,
        projectId: owner.projectId ?? "",
        threadId: owner.threadId ?? "",
        windowId: owner.windowId,
      };
    } else {
      if (
        args.ownerId !== undefined ||
        args.threadId === undefined ||
        args.projectId === undefined
      ) {
        return Promise.reject(
          new BrowserControlUnavailableError(
            "No visible BB Browser panel owner matches this request",
          ),
        );
      }
      const activationCandidates = [...this.browserClientsById.values()].filter(
        (candidate) =>
          candidate.active &&
          candidate.canActivateThreadOwner &&
          (args.clientId === undefined ||
            candidate.clientId === args.clientId) &&
          (args.windowId === undefined || candidate.windowId === args.windowId),
      );
      if (activationCandidates.length === 0) {
        return Promise.reject(
          new BrowserControlUnavailableError(
            "No active visible BB app can open a Browser for this thread",
          ),
        );
      }
      if (activationCandidates.length > 1) {
        return Promise.reject(
          new BrowserControlUnavailableError(
            "Multiple active BB app windows can open this thread; specify client and window",
          ),
        );
      }
      registration = activationCandidates[0];
      if (registration === undefined) {
        return Promise.reject(new BrowserControlUnavailableError());
      }
      binding = {
        kind: "thread",
        clientId: registration.clientId,
        windowId: registration.windowId,
        threadId: args.threadId,
        projectId: args.projectId,
      };
    }
    if (args.signal?.aborted === true) {
      return Promise.reject(
        new DOMException("Browser tab creation was cancelled", "AbortError"),
      );
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const waiter = this.browserOpenTabWaiters.get(requestId);
        if (waiter === undefined) return;
        this.sendBrowserControlCancel(waiter.socket, requestId, "cancelled");
        this.rejectBrowserOpenTabWaiter(
          requestId,
          waiter,
          new DOMException("Browser tab creation was cancelled", "AbortError"),
        );
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      const waiter: BrowserOpenTabWaiter = {
        binding,
        socket: registration.socket,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const current = this.browserOpenTabWaiters.get(requestId);
          if (current === undefined) return;
          this.sendBrowserControlCancel(current.socket, requestId, "timeout");
          this.rejectBrowserOpenTabWaiter(
            requestId,
            current,
            new Error("Timed out waiting for Browser tab creation"),
          );
        }, args.timeoutMs),
        unlinkAbort: () => args.signal?.removeEventListener("abort", abort),
      };
      this.browserOpenTabWaiters.set(requestId, waiter);
      const request =
        binding.kind === "owner"
          ? {
              type: "browser-open-tab-request" as const,
              mode: "owner" as const,
              requestId,
              clientId: binding.clientId,
              windowId: binding.windowId,
              ownerId: binding.ownerId,
              url: args.url,
            }
          : {
              type: "browser-open-tab-request" as const,
              mode: "thread" as const,
              requestId,
              clientId: binding.clientId,
              windowId: binding.windowId,
              threadId: binding.threadId,
              projectId: binding.projectId,
              url: args.url,
            };
      try {
        registration.socket.send(
          JSON.stringify(browserOpenTabRequestMessageSchema.parse(request)),
        );
      } catch {
        this.rejectBrowserOpenTabWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(),
        );
      }
    });
  }

  runBrowserControl(args: {
    target: BrowserTabTarget;
    action: BrowserControlAction;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<JsonValue> {
    const registration = this.browserClientsById.get(args.target.clientId);
    const tab = registration?.tabs.get(args.target.tabId);
    if (
      registration === undefined ||
      tab === undefined ||
      registration.windowId !== args.target.windowId ||
      tab.navigationEpoch !== args.target.navigationEpoch
    ) {
      return Promise.reject(new BrowserControlUnavailableError());
    }
    if (args.signal?.aborted === true) {
      return Promise.reject(
        new DOMException("Browser action was cancelled", "AbortError"),
      );
    }
    const actionabilityPolicy = browserActionabilityPolicySchema.parse({
      timeoutMs: args.timeoutMs,
      pollIntervalMs: Math.min(
        250,
        Math.max(16, Math.floor(args.timeoutMs / 20)),
      ),
      stableFrameCount: 2,
    });
    const ownerId = ownerForTab(registration, tab);
    if (ownerId === null) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "No Browser panel owner controls this tab",
        ),
      );
    }
    const binding = {
      clientId: args.target.clientId,
      ownerId,
      projectId: tab.projectId,
      threadId: tab.threadId,
      windowId: args.target.windowId,
    };
    const requestId = randomUUID();
    if (args.action.kind === "capture") {
      return this.createBrowserCapture({
        clientId: args.target.clientId,
        windowId: args.target.windowId,
        tabId: args.target.tabId,
        mode: args.action.mode,
        format: args.action.format,
        quality: args.action.quality,
        locator: args.action.locator,
        expectedNavigationEpoch: args.target.navigationEpoch,
        timeoutMs: args.timeoutMs,
        signal: args.signal,
      });
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        const waiter = this.browserControlWaiters.get(requestId);
        if (waiter === undefined) return;
        this.sendBrowserControlCancel(waiter.socket, requestId, "cancelled");
        this.rejectBrowserControlWaiter(
          requestId,
          waiter,
          new DOMException("Browser action was cancelled", "AbortError"),
        );
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      const waitTransition =
        args.action.kind === "wait" &&
        isBrowserTransitionWaitAction(args.action);
      const isCloseTabAction = args.action.kind === "close-tab";
      const waiter: BrowserControlWaiter = {
        allowEpochAdvance: waitTransition,
        allowTabRemoval: isCloseTabAction,
        binding,
        action: args.action,
        target: args.target,
        socket: registration.socket,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const current = this.browserControlWaiters.get(requestId);
          if (current === undefined) return;
          this.sendBrowserControlCancel(current.socket, requestId, "timeout");
          this.rejectBrowserControlWaiter(
            requestId,
            current,
            new Error("Timed out waiting for Browser action"),
          );
        }, args.timeoutMs),
        unlinkAbort: () => args.signal?.removeEventListener("abort", abort),
      };
      this.browserControlWaiters.set(requestId, waiter);
      try {
        registration.socket.send(
          JSON.stringify(
            browserControlRequestMessageSchema.parse({
              type: "browser-control-request",
              requestId,
              target: args.target,
              action: args.action,
              actionabilityPolicy,
            }),
          ),
        );
      } catch {
        this.rejectBrowserControlWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(),
        );
      }
    });
  }

  recordBrowserControlResponse(
    socket: HubSocket,
    message: BrowserControlResponseMessage,
  ): boolean {
    const waiter = this.browserControlWaiters.get(message.requestId);
    if (waiter === undefined || waiter.socket !== socket) return false;
    const registration = this.browserClientsById.get(waiter.target.clientId);
    const currentTab = registration?.tabs.get(waiter.target.tabId);
    const tabLifecycleRemoval =
      currentTab === undefined && waiter.allowTabRemoval;
    if (
      registration === undefined ||
      registration.socket !== socket ||
      (!tabLifecycleRemoval && currentTab === undefined) ||
      (!waiter.allowEpochAdvance &&
        currentTab !== undefined &&
        currentTab.windowId !== waiter.target.windowId) ||
      !this.ownerBindingMatches(waiter.binding, registration)
    ) {
      // The owner or tab the waiter was registered for no longer exists, or
      // the request was for a target the current owner does not bind. A late
      // or forged answer must not resurrect the waiter.
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserControlWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    const observedTarget =
      message.ok && message.observedTarget !== undefined
        ? message.observedTarget
        : message.target;
    if (
      message.target.clientId !== waiter.target.clientId ||
      message.target.windowId !== waiter.target.windowId ||
      message.target.tabId !== waiter.target.tabId ||
      message.target.navigationEpoch !== waiter.target.navigationEpoch ||
      observedTarget.clientId !== waiter.target.clientId ||
      observedTarget.windowId !== waiter.target.windowId ||
      observedTarget.tabId !== waiter.target.tabId
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserControlWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    if (message.ok && !waiter.allowEpochAdvance) {
      if (observedTarget.navigationEpoch !== waiter.target.navigationEpoch) {
        this.sendBrowserControlCancel(
          socket,
          message.requestId,
          "target-changed",
        );
        this.rejectBrowserControlWaiter(
          message.requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
        return false;
      }
    } else if (observedTarget.navigationEpoch < waiter.target.navigationEpoch) {
      // A regression below the registered epoch is never a valid result.
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserControlWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    if (
      waiter.allowEpochAdvance &&
      message.ok &&
      observedTarget.navigationEpoch > waiter.target.navigationEpoch
    ) {
      const publishedRegistration = this.browserClientsById.get(
        waiter.target.clientId,
      );
      const publishedTab = publishedRegistration?.tabs.get(waiter.target.tabId);
      // The wait resolved at an epoch the broker has not yet been told about,
      // or a newer navigation already superseded it. Only a published
      // advance resolves an advance-allowed wait.
      if (
        publishedRegistration === undefined ||
        publishedTab === undefined ||
        publishedTab.navigationEpoch !== observedTarget.navigationEpoch
      ) {
        this.sendBrowserControlCancel(
          socket,
          message.requestId,
          "target-changed",
        );
        this.rejectBrowserControlWaiter(
          message.requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
        return false;
      }
    }
    if (message.ok && waiter.action.kind === "wait") {
      const parsed = browserWaitResultSchema.safeParse(message.value);
      const result = parsed.success ? parsed.data : undefined;
      const criteria = waiter.action.criteria;
      const matchesTarget = (
        actual: BrowserTabTarget,
        expected: BrowserTabTarget,
      ): boolean =>
        actual.clientId === expected.clientId &&
        actual.windowId === expected.windowId &&
        actual.tabId === expected.tabId &&
        actual.navigationEpoch === expected.navigationEpoch;
      const matchesWaitCriteria = (): boolean => {
        if (result === undefined || result.kind !== criteria.kind) return false;
        switch (criteria.kind) {
          case "url":
            return (
              result.kind === "url" &&
              browserUrlMatches(result.url, criteria.url, criteria.match)
            );
          case "request":
            return (
              result.kind === "request" &&
              browserUrlMatches(result.url, criteria.url, criteria.match) &&
              (criteria.method === undefined ||
                result.method === criteria.method)
            );
          case "response":
            return (
              result.kind === "response" &&
              browserUrlMatches(result.url, criteria.url, criteria.match) &&
              (criteria.method === undefined ||
                result.method === criteria.method) &&
              (criteria.status === undefined ||
                result.status === criteria.status)
            );
          case "download-blocked":
            return (
              result.kind === "download-blocked" && result.blocked === true
            );
          case "navigation":
            return (
              result.kind === "navigation" &&
              result.phase === criteria.phase &&
              result.sameDocument === criteria.sameDocument
            );
          case "load-state":
            return (
              result.kind === "load-state" && result.state === criteria.state
            );
          default:
            return true;
        }
      };
      if (
        result === undefined ||
        !matchesTarget(result.target, waiter.target) ||
        !matchesTarget(result.originalTarget ?? result.target, waiter.target) ||
        !matchesTarget(
          result.observedTarget ?? result.target,
          observedTarget,
        ) ||
        !matchesWaitCriteria()
      ) {
        this.sendBrowserControlCancel(
          socket,
          message.requestId,
          "target-changed",
        );
        this.rejectBrowserControlWaiter(
          message.requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
        return false;
      }
    }
    this.deleteBrowserControlWaiter(message.requestId, waiter);
    if (message.ok) waiter.resolve(message.value ?? null);
    else {
      const error = message.error ?? {
        code: "BrowserControlError",
        message: "Browser action failed",
      };
      waiter.reject(new BrowserControlRemoteError(error));
    }
    return true;
  }

  recordBrowserOpenTabResponse(
    socket: HubSocket,
    message: BrowserOpenTabResponseMessage,
  ): boolean {
    const waiter = this.browserOpenTabWaiters.get(message.requestId);
    if (waiter === undefined || waiter.socket !== socket) return false;
    const binding = waiter.binding;
    if (
      message.clientId !== binding.clientId ||
      message.windowId !== binding.windowId ||
      (binding.kind === "owner" && message.ownerId !== binding.ownerId)
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserOpenTabWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    const expectedOwnerId =
      binding.kind === "owner" ? binding.ownerId : message.ownerId;
    if (message.ok && message.target !== undefined) {
      const registration = this.browserClientsById.get(message.clientId);
      const owner = registration?.owners.get(message.ownerId);
      const tab = registration?.tabs.get(message.target.tabId);
      const expectedThreadId = binding.threadId;
      const expectedProjectId = binding.projectId;
      if (
        registration === undefined ||
        registration.socket !== socket ||
        registration.windowId !== message.windowId ||
        owner === undefined ||
        message.ownerId !== expectedOwnerId ||
        owner.ownerId !== expectedOwnerId ||
        owner.threadId !== expectedThreadId ||
        owner.projectId !== expectedProjectId ||
        tab === undefined ||
        tab.threadId !== expectedThreadId ||
        tab.projectId !== expectedProjectId ||
        tab.navigationEpoch !== message.target.navigationEpoch ||
        message.target.clientId !== message.clientId ||
        message.target.windowId !== message.windowId
      ) {
        this.sendBrowserControlCancel(
          socket,
          message.requestId,
          "target-changed",
        );
        this.rejectBrowserOpenTabWaiter(
          message.requestId,
          waiter,
          new BrowserControlTargetChangedError(),
        );
        return false;
      }
    }
    this.deleteBrowserOpenTabWaiter(message.requestId, waiter);
    if (message.ok && message.target !== undefined) {
      waiter.resolve(message.target);
    } else {
      const error = new Error(
        message.error?.message ?? "Browser tab creation failed",
      );
      error.name = message.error?.code ?? "BrowserOpenTabError";
      waiter.reject(error);
    }
    return true;
  }

  recordBrowserCaptureRegister(
    socket: HubSocket,
    message: BrowserCaptureRegisterMessage,
  ): boolean {
    const registration = this.browserClientsBySocket.get(socket);
    const tab = registration?.tabs.get(message.tabId);
    const fail = (code: string, error: string): boolean => {
      try {
        socket.send(
          JSON.stringify(
            browserCaptureRegisteredMessageSchema.parse({
              type: "browser-capture-registered",
              requestId: message.requestId,
              ok: false,
              error: { code, message: error },
            }),
          ),
        );
      } catch {}
      return false;
    };
    if (
      registration === undefined ||
      tab === undefined ||
      tab.navigationEpoch !== message.expectedNavigationEpoch
    )
      return fail(
        "BrowserCaptureTargetChanged",
        "Browser page changed before capture registration",
      );
    const retained =
      this.browserCaptureCapacityByClient.get(registration.clientId) ?? 0;
    if (retained + message.byteLength > BROWSER_CAPTURE_AGGREGATE_MAX_BYTES) {
      return fail(
        "BrowserCaptureCapacityExceeded",
        "The Browser capture aggregate capacity is exhausted",
      );
    }
    const createdAt = Date.now();
    const expiresAt = createdAt + BROWSER_CAPTURE_TTL_MS;
    const provenance: BrowserCaptureProvenance = {
      absoluteExpiresAt: createdAt + BROWSER_CAPTURE_MAX_LIFETIME_MS,
      byteLength: message.byteLength,
      captureId: message.captureId,
      clientId: registration.clientId,
      createdAt,
      expiresAt,
      format: message.mimeType === "image/png" ? "png" : "jpeg",
      navigationEpoch: message.expectedNavigationEpoch,
      pixelSize: message.pixelSize,
      tabId: message.tabId,
      windowId: registration.windowId,
    };
    if (this.browserCaptureProvenance.has(message.captureId)) {
      return fail(
        "BrowserCaptureExists",
        "Browser capture ID is already registered",
      );
    }
    this.browserCaptureProvenance.set(message.captureId, provenance);
    this.browserCaptureCapacityByClient.set(
      registration.clientId,
      retained + message.byteLength,
    );
    this.scheduleCaptureReap(provenance);
    try {
      socket.send(
        JSON.stringify(
          browserCaptureRegisteredMessageSchema.parse({
            type: "browser-capture-registered",
            requestId: message.requestId,
            captureId: message.captureId,
            ok: true,
            expiresAt,
          }),
        ),
      );
    } catch {
      this.removeBrowserCaptureProvenance(message.captureId, provenance);
      return false;
    }
    return true;
  }

  readBrowserCapture(args: {
    captureId: string;
    clientId: string;
    windowId: string;
    tabId: string;
    offset: number;
    length: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<BrowserCaptureReadResponse> {
    const registration = this.browserClientsById.get(args.clientId);
    const tab = registration?.tabs.get(args.tabId);
    const provenance = this.browserCaptureProvenance.get(args.captureId);
    if (
      registration === undefined ||
      registration.windowId !== args.windowId ||
      tab === undefined ||
      provenance === undefined ||
      provenance.clientId !== args.clientId ||
      provenance.windowId !== args.windowId ||
      provenance.tabId !== args.tabId
    ) {
      return Promise.reject(
        new Error("The Browser capture is not available for this tab"),
      );
    }
    if (args.offset + args.length > provenance.byteLength) {
      return Promise.reject(
        new Error("The Browser capture read exceeds the capture bounds"),
      );
    }
    if (args.signal?.aborted === true) {
      return Promise.reject(
        new DOMException("Browser capture read was cancelled", "AbortError"),
      );
    }
    const ownerId = ownerForTab(registration, tab);
    if (ownerId === null) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "No Browser panel owner controls this tab",
        ),
      );
    }
    const binding = {
      clientId: args.clientId,
      ownerId,
      projectId: tab.projectId,
      threadId: tab.threadId,
      windowId: args.windowId,
    };
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const waiter = this.browserCaptureChunkWaiters.get(requestId);
        if (waiter === undefined) return;
        this.sendBrowserControlCancel(waiter.socket, requestId, "cancelled");
        this.rejectBrowserCaptureChunkWaiter(
          requestId,
          waiter,
          new DOMException("Browser capture read was cancelled", "AbortError"),
        );
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      const waiter: BrowserCaptureChunkWaiter = {
        binding,
        captureByteLength: provenance.byteLength,
        captureId: args.captureId,
        length: args.length,
        navigationEpoch: provenance.navigationEpoch,
        offset: args.offset,
        socket: registration.socket,
        tabId: args.tabId,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const current = this.browserCaptureChunkWaiters.get(requestId);
          if (current === undefined) return;
          this.sendBrowserControlCancel(current.socket, requestId, "timeout");
          this.rejectBrowserCaptureChunkWaiter(
            requestId,
            current,
            new Error("Timed out reading Browser capture"),
          );
        }, args.timeoutMs),
        unlinkAbort: () => args.signal?.removeEventListener("abort", abort),
      };
      this.browserCaptureChunkWaiters.set(requestId, waiter);
      try {
        registration.socket.send(
          JSON.stringify(
            browserCaptureReadRequestMessageSchema.parse({
              type: "browser-capture-read",
              requestId,
              tabId: args.tabId,
              captureId: args.captureId,
              offset: args.offset,
              length: args.length,
            }),
          ),
        );
      } catch {
        this.rejectBrowserCaptureChunkWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(),
        );
      }
    });
  }

  releaseBrowserCaptureFromClient(
    socket: HubSocket,
    args: { captureId: string; tabId: string },
  ): void {
    const registration = this.browserClientsBySocket.get(socket);
    if (registration === undefined) return;
    this.releaseBrowserCapture({
      captureId: args.captureId,
      clientId: registration.clientId,
      windowId: registration.windowId,
      tabId: args.tabId,
    });
  }

  releaseBrowserCapture(args: {
    captureId: string;
    clientId: string;
    windowId: string;
    tabId: string;
  }): void {
    const registration = this.browserClientsById.get(args.clientId);
    const provenance = this.browserCaptureProvenance.get(args.captureId);
    if (
      registration === undefined ||
      registration.windowId !== args.windowId ||
      provenance === undefined ||
      provenance.clientId !== args.clientId ||
      provenance.windowId !== args.windowId ||
      provenance.tabId !== args.tabId
    ) {
      return;
    }
    this.removeBrowserCaptureProvenance(args.captureId, provenance);
    try {
      registration.socket.send(
        JSON.stringify(
          browserCaptureReleaseMessageSchema.parse({
            type: "browser-capture-release",
            requestId: randomUUID(),
            tabId: args.tabId,
            captureId: args.captureId,
          }),
        ),
      );
    } catch {}
  }

  createBrowserCapture(args: {
    clientId: string;
    windowId: string;
    tabId: string;
    mode: "viewport" | "full-page" | "element";
    format?: "png" | "jpeg";
    quality?: number;
    locator?: BrowserPageLocator;
    expectedNavigationEpoch: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<BrowserCaptureDescriptor> {
    const registration = this.browserClientsById.get(args.clientId);
    const tab = registration?.tabs.get(args.tabId);
    if (
      registration === undefined ||
      registration.windowId !== args.windowId ||
      tab === undefined ||
      tab.navigationEpoch !== args.expectedNavigationEpoch
    ) {
      return Promise.reject(new BrowserControlUnavailableError());
    }
    if (args.signal?.aborted === true) {
      return Promise.reject(
        new DOMException("Browser capture was cancelled", "AbortError"),
      );
    }
    const ownerId = ownerForTab(registration, tab);
    if (ownerId === null) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "No Browser panel owner controls this tab",
        ),
      );
    }
    const binding = {
      clientId: args.clientId,
      ownerId,
      projectId: tab.projectId,
      threadId: tab.threadId,
      windowId: args.windowId,
    };
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      let abortedBySignal = false;
      const abort = () => {
        const waiter = this.browserCaptureCreateWaiters.get(requestId);
        if (waiter === undefined) return;
        abortedBySignal = true;
        this.sendBrowserControlCancel(waiter.socket, requestId, "cancelled");
        this.rejectBrowserCaptureCreateWaiter(
          requestId,
          waiter,
          new DOMException("Browser capture was cancelled", "AbortError"),
        );
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      const waiter: BrowserCaptureCreateWaiter = {
        binding,
        expectedFormat: args.format ?? null,
        navigationEpoch: tab.navigationEpoch,
        socket: registration.socket,
        tabId: args.tabId,
        resolve: (descriptor) => {
          // A cancelled create must never surface a descriptor: release the
          // late capture so capacity is reclaimed and no ghost persists.
          if (abortedBySignal) {
            const releaseSocket = this.browserClientsById.get(args.clientId);
            try {
              releaseSocket?.socket.send(
                JSON.stringify(
                  browserCaptureReleaseMessageSchema.parse({
                    type: "browser-capture-release",
                    requestId: randomUUID(),
                    tabId: args.tabId,
                    captureId: descriptor.captureId,
                  }),
                ),
              );
            } catch {}
            return;
          }
          resolve(descriptor);
        },
        reject,
        timeout: setTimeout(() => {
          const current = this.browserCaptureCreateWaiters.get(requestId);
          if (current === undefined) return;
          this.sendBrowserControlCancel(current.socket, requestId, "timeout");
          this.rejectBrowserCaptureCreateWaiter(
            requestId,
            current,
            new Error("Timed out creating Browser capture"),
          );
        }, args.timeoutMs),
        unlinkAbort: () => args.signal?.removeEventListener("abort", abort),
      };
      this.browserCaptureCreateWaiters.set(requestId, waiter);
      try {
        registration.socket.send(
          JSON.stringify(
            browserCaptureCreateMessageSchema.parse({
              type: "browser-capture-create",
              requestId,
              tabId: args.tabId,
              mode: args.mode,
              format: args.format,
              quality: args.quality,
              locator: args.locator,
              expectedNavigationEpoch: tab.navigationEpoch,
            }),
          ),
        );
      } catch {
        this.rejectBrowserCaptureCreateWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(),
        );
      }
    });
  }

  recordBrowserCaptureCreated(
    socket: HubSocket,
    message: BrowserCaptureDescriptorMessage,
  ): boolean {
    const waiter = this.browserCaptureCreateWaiters.get(message.requestId);
    if (waiter === undefined || waiter.socket !== socket) {
      const tombstone = this.browserCaptureCreateTombstones.get(
        message.requestId,
      );
      if (
        message.ok &&
        tombstone !== undefined &&
        tombstone.socket === socket
      ) {
        this.browserCaptureCreateTombstones.delete(message.requestId);
        clearTimeout(tombstone.timeout);
        this.releaseUntrackedBrowserCapture(
          socket,
          tombstone.tabId,
          message.captureId,
        );
      }
      return false;
    }
    if (!message.ok) {
      this.rejectBrowserCaptureCreateWaiter(
        message.requestId,
        waiter,
        new BrowserControlRemoteError(message.error),
      );
      return true;
    }
    const registration = this.browserClientsBySocket.get(socket);
    const tab = registration?.tabs.get(waiter.tabId);
    if (
      message.byteLength <= 0 ||
      message.byteLength > BROWSER_CAPTURE_MAX_ENCODED_BYTES ||
      message.pixelSize.width <= 0 ||
      message.pixelSize.height <= 0 ||
      (waiter.expectedFormat !== null &&
        message.format !== waiter.expectedFormat)
    ) {
      this.sendBrowserControlCancel(socket, message.requestId, "cancelled");
      this.releaseUntrackedBrowserCapture(
        socket,
        waiter.tabId,
        message.captureId,
      );
      this.rejectBrowserCaptureCreateWaiter(
        message.requestId,
        waiter,
        new Error("The Browser capture descriptor is invalid or oversized"),
      );
      return true;
    }
    if (
      tab === undefined ||
      registration === undefined ||
      !this.ownerBindingMatches(waiter.binding, registration) ||
      tab.windowId !== waiter.binding.windowId ||
      tab.navigationEpoch !== waiter.navigationEpoch ||
      message.navigationEpoch !== waiter.navigationEpoch
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.releaseUntrackedBrowserCapture(
        socket,
        waiter.tabId,
        message.captureId,
      );
      this.rejectBrowserCaptureCreateWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return true;
    }
    if (this.browserCaptureProvenance.has(message.captureId)) {
      this.sendBrowserControlCancel(socket, message.requestId, "cancelled");
      this.releaseUntrackedBrowserCapture(
        socket,
        waiter.tabId,
        message.captureId,
      );
      this.rejectBrowserCaptureCreateWaiter(
        message.requestId,
        waiter,
        new Error("The Browser capture ID is already in use"),
      );
      return true;
    }
    const retained =
      this.browserCaptureCapacityByClient.get(registration.clientId) ?? 0;
    if (retained + message.byteLength > BROWSER_CAPTURE_AGGREGATE_MAX_BYTES) {
      this.sendBrowserControlCancel(socket, message.requestId, "cancelled");
      this.releaseUntrackedBrowserCapture(
        socket,
        waiter.tabId,
        message.captureId,
      );
      this.rejectBrowserCaptureCreateWaiter(
        message.requestId,
        waiter,
        new Error(
          "The Browser capture aggregate capacity for this window is exhausted",
        ),
      );
      return true;
    }
    const createdAt = Date.now();
    const expiresAt = createdAt + BROWSER_CAPTURE_TTL_MS;
    const descriptor: BrowserCaptureDescriptor = {
      captureId: message.captureId,
      mimeType: message.format === "png" ? "image/png" : "image/jpeg",
      pixelSize: message.pixelSize,
      byteLength: message.byteLength,
      target: {
        clientId: registration.clientId,
        windowId: registration.windowId,
        tabId: waiter.tabId,
        navigationEpoch: message.navigationEpoch,
      },
      expiresAt,
    };
    const provenance: BrowserCaptureProvenance = {
      absoluteExpiresAt: createdAt + BROWSER_CAPTURE_MAX_LIFETIME_MS,
      byteLength: message.byteLength,
      captureId: message.captureId,
      clientId: registration.clientId,
      createdAt,
      expiresAt,
      format: message.format,
      navigationEpoch: message.navigationEpoch,
      pixelSize: message.pixelSize,
      tabId: waiter.tabId,
      windowId: registration.windowId,
    };
    this.browserCaptureProvenance.set(message.captureId, provenance);
    this.browserCaptureCapacityByClient.set(
      registration.clientId,
      retained + message.byteLength,
    );
    this.scheduleCaptureReap(provenance);
    this.browserCaptureCreateWaiters.delete(message.requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    waiter.resolve(descriptor);
    return true;
  }

  requestBrowserPluginContribution(args: {
    pluginId: string;
    target: BrowserTabTarget;
    controllerId: string;
    input: JsonValue;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<JsonValue> {
    if (!this.browserPluginContributionAuthorizer(args.pluginId)) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "The requested Browser plugin is not enabled or not running",
        ),
      );
    }
    const registration = this.browserClientsById.get(args.target.clientId);
    const tab = registration?.tabs.get(args.target.tabId);
    const controller = registration?.controllers.get(
      browserControllerKey({
        pluginId: args.pluginId,
        controllerId: args.controllerId,
        tabId: args.target.tabId,
      }),
    );
    if (
      registration === undefined ||
      tab === undefined ||
      controller === undefined ||
      registration.windowId !== args.target.windowId ||
      tab.navigationEpoch !== args.target.navigationEpoch
    ) {
      return Promise.reject(new BrowserControlUnavailableError());
    }
    if (args.signal?.aborted === true) {
      return Promise.reject(
        new DOMException("Browser contribution was cancelled", "AbortError"),
      );
    }
    const ownerId = ownerForTab(registration, tab);
    if (ownerId === null) {
      return Promise.reject(
        new BrowserControlUnavailableError(
          "No Browser panel owner controls this tab",
        ),
      );
    }
    const binding = {
      clientId: args.target.clientId,
      ownerId,
      projectId: tab.projectId,
      threadId: tab.threadId,
      windowId: args.target.windowId,
    };
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const waiter = this.browserPluginRequestWaiters.get(requestId);
        if (waiter === undefined) return;
        this.sendBrowserControlCancel(waiter.socket, requestId, "cancelled");
        this.rejectBrowserPluginRequestWaiter(
          requestId,
          waiter,
          new DOMException("Browser contribution was cancelled", "AbortError"),
        );
      };
      args.signal?.addEventListener("abort", abort, { once: true });
      const waiter: BrowserPluginRequestWaiter = {
        binding,
        controllerId: args.controllerId,
        pluginId: args.pluginId,
        registrationId: controller.registrationId,
        socket: registration.socket,
        target: args.target,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const current = this.browserPluginRequestWaiters.get(requestId);
          if (current === undefined) return;
          this.sendBrowserControlCancel(current.socket, requestId, "timeout");
          this.rejectBrowserPluginRequestWaiter(
            requestId,
            current,
            new Error("Timed out waiting for Browser contribution"),
          );
        }, args.timeoutMs),
        unlinkAbort: () => args.signal?.removeEventListener("abort", abort),
      };
      this.browserPluginRequestWaiters.set(requestId, waiter);
      try {
        registration.socket.send(
          JSON.stringify(
            browserPluginRequestMessageSchema.parse({
              type: "browser-plugin-request",
              requestId,
              pluginId: args.pluginId,
              target: args.target,
              controllerId: args.controllerId,
              registrationId: controller.registrationId,
              input: args.input,
            }),
          ),
        );
      } catch {
        this.rejectBrowserPluginRequestWaiter(
          requestId,
          waiter,
          new BrowserControlUnavailableError(),
        );
      }
    });
  }

  recordBrowserCaptureChunk(
    socket: HubSocket,
    message: BrowserCaptureReadResponseMessage,
  ): boolean {
    const waiter = this.browserCaptureChunkWaiters.get(message.requestId);
    if (waiter === undefined || waiter.socket !== socket) return false;
    const registration = this.browserClientsById.get(waiter.binding.clientId);
    const tab = registration?.tabs.get(waiter.tabId);
    if (
      registration === undefined ||
      registration.socket !== socket ||
      tab === undefined ||
      tab.windowId !== waiter.binding.windowId ||
      !this.ownerBindingMatches(waiter.binding, registration) ||
      message.captureId !== waiter.captureId ||
      message.tabId !== waiter.tabId ||
      message.offset !== waiter.offset
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserCaptureChunkWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    if (!message.ok) {
      this.rejectBrowserCaptureChunkWaiter(
        message.requestId,
        waiter,
        new BrowserControlRemoteError(message.error),
      );
      return true;
    }
    try {
      decodeBrowserCaptureChunk(
        {
          captureId: message.captureId,
          offset: message.offset,
          base64: message.base64,
          eof: message.eof,
        },
        {
          captureId: waiter.captureId,
          offset: waiter.offset,
          length: waiter.length,
        },
        waiter.captureByteLength,
      );
    } catch (error) {
      this.sendBrowserControlCancel(socket, message.requestId, "cancelled");
      this.rejectBrowserCaptureChunkWaiter(
        message.requestId,
        waiter,
        error instanceof Error
          ? error
          : new Error("Invalid Browser capture chunk"),
      );
      return false;
    }
    const provenance = this.browserCaptureProvenance.get(waiter.captureId);
    if (
      provenance === undefined ||
      provenance.clientId !== waiter.binding.clientId ||
      provenance.windowId !== waiter.binding.windowId ||
      provenance.tabId !== waiter.tabId ||
      provenance.byteLength !== waiter.captureByteLength
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserCaptureChunkWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    this.refreshBrowserCaptureLease(provenance);
    this.browserCaptureChunkWaiters.delete(message.requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    waiter.resolve({
      captureId: message.captureId,
      offset: message.offset,
      base64: message.base64,
      eof: message.eof,
    });
    return true;
  }

  recordBrowserPluginResponse(
    socket: HubSocket,
    message: BrowserPluginResponseMessage,
  ): boolean {
    const waiter = this.browserPluginRequestWaiters.get(message.requestId);
    if (waiter === undefined || waiter.socket !== socket) return false;
    const registration = this.browserClientsById.get(waiter.target.clientId);
    const tab = registration?.tabs.get(waiter.target.tabId);
    const controller = registration?.controllers.get(
      browserControllerKey({
        pluginId: waiter.pluginId,
        controllerId: waiter.controllerId,
        tabId: waiter.target.tabId,
      }),
    );
    if (
      !this.browserPluginContributionAuthorizer(waiter.pluginId) ||
      message.pluginId !== waiter.pluginId ||
      message.controllerId !== waiter.controllerId ||
      message.registrationId !== waiter.registrationId ||
      registration === undefined ||
      registration.socket !== socket ||
      tab === undefined ||
      tab.windowId !== waiter.target.windowId ||
      tab.navigationEpoch !== waiter.target.navigationEpoch ||
      controller?.registrationId !== waiter.registrationId ||
      !this.ownerBindingMatches(waiter.binding, registration)
    ) {
      this.sendBrowserControlCancel(
        socket,
        message.requestId,
        "target-changed",
      );
      this.rejectBrowserPluginRequestWaiter(
        message.requestId,
        waiter,
        new BrowserControlTargetChangedError(),
      );
      return false;
    }
    this.browserPluginRequestWaiters.delete(message.requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    if (message.ok) {
      waiter.resolve(message.value ?? null);
    } else {
      const error = message.error ?? {
        code: "BrowserPluginError",
        message: "Browser contribution failed",
      };
      waiter.reject(new BrowserControlRemoteError(error));
    }
    return true;
  }

  private rejectBrowserCaptureChunkWaiter(
    requestId: string,
    waiter: BrowserCaptureChunkWaiter,
    error: Error,
  ): void {
    if (this.browserCaptureChunkWaiters.get(requestId) !== waiter) return;
    this.browserCaptureChunkWaiters.delete(requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    waiter.reject(error);
  }

  private rejectBrowserCaptureCreateWaiter(
    requestId: string,
    waiter: BrowserCaptureCreateWaiter,
    error: Error,
  ): void {
    if (this.browserCaptureCreateWaiters.get(requestId) !== waiter) return;
    this.browserCaptureCreateWaiters.delete(requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    const previous = this.browserCaptureCreateTombstones.get(requestId);
    if (previous !== undefined) clearTimeout(previous.timeout);
    this.browserCaptureCreateTombstones.set(requestId, {
      socket: waiter.socket,
      tabId: waiter.tabId,
      timeout: setTimeout(() => {
        this.browserCaptureCreateTombstones.delete(requestId);
      }, BROWSER_CAPTURE_TTL_MS),
    });
    waiter.reject(error);
  }

  private rejectBrowserPluginRequestWaiter(
    requestId: string,
    waiter: BrowserPluginRequestWaiter,
    error: Error,
  ): void {
    if (this.browserPluginRequestWaiters.get(requestId) !== waiter) return;
    this.browserPluginRequestWaiters.delete(requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
    waiter.reject(error);
  }

  private unregisterBrowserClient(socket: HubSocket): void {
    const registration = this.browserClientsBySocket.get(socket);
    if (registration === undefined) return;
    this.browserClientsBySocket.delete(socket);
    if (this.browserClientsById.get(registration.clientId) === registration) {
      this.browserClientsById.delete(registration.clientId);
    }
    for (const [requestId, waiter] of this.browserControlWaiters) {
      if (waiter.socket !== socket) continue;
      this.sendBrowserControlCancel(socket, requestId, "client-disconnected");
      this.rejectBrowserControlWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError("The Browser client disconnected"),
      );
    }
    for (const [requestId, waiter] of this.browserOpenTabWaiters) {
      if (waiter.socket !== socket) continue;
      this.sendBrowserControlCancel(socket, requestId, "client-disconnected");
      this.rejectBrowserOpenTabWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError("The Browser client disconnected"),
      );
    }
    for (const [requestId, waiter] of this.browserCaptureChunkWaiters) {
      if (waiter.socket !== socket) continue;
      this.sendBrowserControlCancel(socket, requestId, "client-disconnected");
      this.rejectBrowserCaptureChunkWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError("The Browser client disconnected"),
      );
    }
    for (const [requestId, waiter] of this.browserCaptureCreateWaiters) {
      if (waiter.socket !== socket) continue;
      this.sendBrowserControlCancel(socket, requestId, "client-disconnected");
      this.rejectBrowserCaptureCreateWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError("The Browser client disconnected"),
      );
    }
    for (const [requestId, waiter] of this.browserPluginRequestWaiters) {
      if (waiter.socket !== socket) continue;
      this.sendBrowserControlCancel(socket, requestId, "client-disconnected");
      this.rejectBrowserPluginRequestWaiter(
        requestId,
        waiter,
        new BrowserControlUnavailableError("The Browser client disconnected"),
      );
    }
  }

  private sendBrowserControlCancel(
    socket: HubSocket,
    requestId: string,
    reason: "cancelled" | "timeout" | "client-disconnected" | "target-changed",
  ): void {
    try {
      socket.send(
        JSON.stringify({ type: "browser-control-cancel", requestId, reason }),
      );
    } catch {
      // The waiter is rejected locally below; a disconnected client needs no message.
    }
  }

  private ownerBindingMatches(
    binding: BrowserOwnerBinding,
    registration: BrowserClientRegistration,
    owners?: Map<string, BrowserTabOwnerDescriptor>,
    tab?: BrowserTabDescriptor,
  ): boolean {
    if (
      binding.clientId !== registration.clientId ||
      binding.windowId !== registration.windowId
    ) {
      return false;
    }
    if (owners === undefined || tab === undefined) return true;
    const owner = owners.get(binding.ownerId);
    if (
      owner === undefined ||
      owner.ownerId !== binding.ownerId ||
      owner.clientId !== registration.clientId ||
      owner.windowId !== registration.windowId ||
      owner.threadId !== binding.threadId ||
      owner.projectId !== binding.projectId
    ) {
      return false;
    }
    const resolvedOwnerId = ownerForTab(registration, tab);
    return resolvedOwnerId !== null && resolvedOwnerId === binding.ownerId;
  }

  private removeBrowserCaptureProvenance(
    captureId: string,
    provenance: BrowserCaptureProvenance,
  ): void {
    if (this.browserCaptureProvenance.get(captureId) !== provenance) return;
    this.browserCaptureProvenance.delete(captureId);
    const capacity = this.browserCaptureCapacityByClient.get(
      provenance.clientId,
    );
    if (capacity === undefined) return;
    const next = capacity - provenance.byteLength;
    if (next <= 0)
      this.browserCaptureCapacityByClient.delete(provenance.clientId);
    else this.browserCaptureCapacityByClient.set(provenance.clientId, next);
  }

  private reapCaptureProvenanceForRegistration(
    registration: BrowserClientRegistration,
    priorRegistration: BrowserClientRegistration | undefined,
    tabs: Map<string, BrowserTabDescriptor>,
  ): void {
    if (this.browserCaptureProvenance.size === 0) return;
    for (const [captureId, provenance] of [...this.browserCaptureProvenance]) {
      if (provenance.clientId !== registration.clientId) continue;
      const tabStillPresent = tabs.get(provenance.tabId);
      if (
        tabStillPresent === undefined ||
        tabStillPresent.windowId !== registration.windowId
      ) {
        this.removeBrowserCaptureProvenance(captureId, provenance);
        this.releaseUntrackedBrowserCapture(
          registration.socket,
          provenance.tabId,
          captureId,
        );
      }
    }
    if (priorRegistration !== undefined) {
      for (const [captureId, provenance] of [
        ...this.browserCaptureProvenance,
      ]) {
        if (provenance.clientId !== priorRegistration.clientId) continue;
        const tabStillPresent = tabs.get(provenance.tabId);
        if (
          tabStillPresent === undefined ||
          tabStillPresent.windowId !== registration.windowId
        ) {
          this.removeBrowserCaptureProvenance(captureId, provenance);
          this.releaseUntrackedBrowserCapture(
            registration.socket,
            provenance.tabId,
            captureId,
          );
        }
      }
    }
  }

  private releaseUntrackedBrowserCapture(
    socket: HubSocket,
    tabId: string,
    captureId: string,
  ): void {
    try {
      socket.send(
        JSON.stringify(
          browserCaptureReleaseMessageSchema.parse({
            type: "browser-capture-release",
            requestId: randomUUID(),
            tabId,
            captureId,
          }),
        ),
      );
    } catch {}
  }

  private refreshBrowserCaptureLease(
    provenance: BrowserCaptureProvenance,
  ): void {
    provenance.expiresAt = Math.min(
      Date.now() + BROWSER_CAPTURE_TTL_MS,
      provenance.absoluteExpiresAt,
    );
  }

  private scheduleCaptureReap(provenance: BrowserCaptureProvenance): void {
    setTimeout(
      () => {
        const current = this.browserCaptureProvenance.get(provenance.captureId);
        if (current !== provenance) return;
        if (Date.now() < provenance.expiresAt) {
          this.scheduleCaptureReap(provenance);
          return;
        }
        this.removeBrowserCaptureProvenance(provenance.captureId, provenance);
        const registration = this.browserClientsById.get(provenance.clientId);
        if (registration === undefined) return;
        this.releaseUntrackedBrowserCapture(
          registration.socket,
          provenance.tabId,
          provenance.captureId,
        );
      },
      Math.max(0, provenance.expiresAt - Date.now()),
    );
  }

  private rejectBrowserOpenTabWaiter(
    requestId: string,
    waiter: BrowserOpenTabWaiter,
    error: Error,
  ): void {
    this.deleteBrowserOpenTabWaiter(requestId, waiter);
    waiter.reject(error);
  }

  private deleteBrowserOpenTabWaiter(
    requestId: string,
    waiter: BrowserOpenTabWaiter,
  ): void {
    if (this.browserOpenTabWaiters.get(requestId) !== waiter) return;
    this.browserOpenTabWaiters.delete(requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
  }

  private rejectBrowserControlWaiter(
    requestId: string,
    waiter: BrowserControlWaiter,
    error: Error,
  ): void {
    this.deleteBrowserControlWaiter(requestId, waiter);
    waiter.reject(error);
  }

  private deleteBrowserControlWaiter(
    requestId: string,
    waiter: BrowserControlWaiter,
  ): void {
    if (this.browserControlWaiters.get(requestId) !== waiter) return;
    this.browserControlWaiters.delete(requestId);
    clearTimeout(waiter.timeout);
    waiter.unlinkAbort();
  }

  onChangedMessage(listener: ChangedMessageListener): () => void {
    this.changedMessageListeners.add(listener);
    return () => {
      this.changedMessageListeners.delete(listener);
    };
  }

  registerTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets =
      this.terminalClientSocketsById.get(terminalId) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.terminalClientSocketsById.set(terminalId, sockets);

    const terminalIds =
      this.terminalIdsByClientSocket.get(socket) ?? new Set<string>();
    terminalIds.add(terminalId);
    this.terminalIdsByClientSocket.set(socket, terminalIds);
  }

  claimTerminalResizeOwnership(terminalId: string, socket: HubSocket): void {
    this.terminalResizeOwnerById.set(terminalId, socket);
  }

  isTerminalResizeOwner(terminalId: string, socket: HubSocket): boolean {
    return this.terminalResizeOwnerById.get(terminalId) === socket;
  }

  unregisterTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
    }
    this.releaseTerminalResizeOwnership(terminalId, socket, sockets);

    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }
    terminalIds.delete(terminalId);
    if (terminalIds.size === 0) {
      this.terminalIdsByClientSocket.delete(socket);
      this.clearTerminalSocketSendQueue(socket);
    }
  }

  unregisterTerminalClientSocket(socket: HubSocket): void {
    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }

    for (const terminalId of terminalIds) {
      const sockets = this.terminalClientSocketsById.get(terminalId);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
      this.releaseTerminalResizeOwnership(terminalId, socket, sockets);
    }

    this.terminalIdsByClientSocket.delete(socket);
    this.clearTerminalSocketSendQueue(socket);
  }

  private releaseTerminalResizeOwnership(
    terminalId: string,
    socket: HubSocket,
    sockets: Set<HubSocket> | undefined,
  ): void {
    if (this.terminalResizeOwnerById.get(terminalId) !== socket) {
      return;
    }
    let replacement: HubSocket | undefined;
    for (const candidate of sockets ?? []) {
      replacement = candidate;
    }
    if (replacement === undefined) {
      this.terminalResizeOwnerById.delete(terminalId);
    } else {
      this.terminalResizeOwnerById.set(terminalId, replacement);
    }
  }

  sendTerminalSocketMessage(
    socket: HubSocket,
    message: TerminalServerMessage,
  ): void {
    this.sendOrQueueTerminalPayload(
      socket,
      JSON.stringify(terminalServerMessageSchema.parse(message)),
    );
  }

  sendTerminalClientMessage(
    terminalId: string,
    message: TerminalServerMessage,
  ): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (!sockets) {
      return;
    }

    const payload = JSON.stringify(terminalServerMessageSchema.parse(message));
    for (const socket of [...sockets]) {
      this.sendOrQueueTerminalPayload(socket, payload);
    }
  }

  private sendOrQueueTerminalPayload(socket: HubSocket, payload: string): void {
    const existingQueue = this.terminalSocketSendQueues.get(socket);
    if (
      !existingQueue &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      try {
        socket.send(payload);
        return;
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
    }

    const queue = existingQueue ?? {
      bytes: 0,
      payloads: [],
      timeout: null,
    };
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (queue.bytes + payloadBytes > TERMINAL_SOCKET_MAX_QUEUE_BYTES) {
      this.dropTerminalSocket(socket, "terminal-backpressure");
      return;
    }
    queue.payloads.push(payload);
    queue.bytes += payloadBytes;
    this.terminalSocketSendQueues.set(socket, queue);
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private scheduleTerminalSocketDrain(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (queue.timeout !== null) {
      return;
    }
    queue.timeout = setTimeout(() => {
      queue.timeout = null;
      this.flushTerminalSocketQueue(socket, queue);
    }, TERMINAL_SOCKET_DRAIN_POLL_MS);
  }

  private flushTerminalSocketQueue(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (this.terminalSocketSendQueues.get(socket) !== queue) {
      return;
    }
    while (
      queue.payloads.length > 0 &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      const payload = queue.payloads[0];
      if (payload === undefined) {
        break;
      }
      try {
        socket.send(payload);
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
      queue.payloads.shift();
      queue.bytes -= Buffer.byteLength(payload, "utf8");
    }
    if (queue.payloads.length === 0) {
      this.clearTerminalSocketSendQueue(socket);
      return;
    }
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private dropTerminalSocket(socket: HubSocket, reason: string): void {
    this.unregisterTerminalClientSocket(socket);
    try {
      socket.close(1013, reason);
    } catch {}
  }

  private clearTerminalSocketSendQueue(socket: HubSocket): void {
    const queue = this.terminalSocketSendQueues.get(socket);
    if (!queue) {
      return;
    }
    if (queue.timeout !== null) {
      clearTimeout(queue.timeout);
    }
    this.terminalSocketSendQueues.delete(socket);
  }

  subscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    this.registerClient(socket);
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.add(key);

    const sockets = this.clientSocketsByKey.get(key) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.clientSocketsByKey.set(key, sockets);
  }

  unsubscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.delete(key);

    const sockets = this.clientSocketsByKey.get(key);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.clientSocketsByKey.delete(key);
    }
  }

  recordDaemonSessionPlatform(sessionId: string, platform: HostPlatform): void {
    this.daemonSessionPlatformsBySessionId.set(sessionId, platform);
  }

  recordDaemonSessionLocalApiPort(
    sessionId: string,
    localApiPort: number | null,
  ): void {
    this.daemonSessionLocalApiPortsBySessionId.set(sessionId, localApiPort);
  }

  registerDaemon(sessionId: string, hostId: string, socket: HubSocket): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const existingSessionId = this.daemonSessionIdsByHost.get(hostId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.cancelPendingDaemonDisconnect(existingSessionId);
      this.unregisterDaemon(existingSessionId);
    }
    this.daemonSessions.set(sessionId, {
      hostId,
      localApiPort:
        this.daemonSessionLocalApiPortsBySessionId.get(sessionId) ?? null,
      platform:
        this.daemonSessionPlatformsBySessionId.get(sessionId) ?? "unknown",
      socket,
    });
    this.daemonSessionIdsByHost.set(hostId, sessionId);
    this.resolveDaemonRegistrationWaiters(hostId);
    this.notifyHost(hostId, ["host-connected"]);
  }

  unregisterDaemon(sessionId: string): void {
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    this.daemonSessions.delete(sessionId);
    this.daemonSessionLocalApiPortsBySessionId.delete(sessionId);
    this.daemonSessionPlatformsBySessionId.delete(sessionId);
    this.rejectHostOnlineRpcWaitersForSession(sessionId);
    if (this.daemonSessionIdsByHost.get(entry.hostId) === sessionId) {
      this.daemonSessionIdsByHost.delete(entry.hostId);
    }
  }

  hasDaemonForHost(hostId: string): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    return sessionId !== undefined && this.daemonSessions.has(sessionId);
  }

  getDaemonSessionIdForHost(hostId: string): string | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId || !this.daemonSessions.has(sessionId)) {
      return null;
    }
    return sessionId;
  }

  getDaemonPlatformForHost(hostId: string): HostPlatform | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return null;
    }
    return this.daemonSessions.get(sessionId)?.platform ?? null;
  }

  listDaemonLocalApiPorts(): number[] {
    const ports = new Set<number>();
    for (const session of this.daemonSessions.values()) {
      if (session.localApiPort !== null) {
        ports.add(session.localApiPort);
      }
    }
    return [...ports].sort((left, right) => left - right);
  }

  async waitForDaemonForHost(
    hostId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.hasDaemonForHost(hostId)) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const waiter: DaemonRegistrationWaiter = {
        resolve,
        timeout: setTimeout(() => {
          this.deleteDaemonRegistrationWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.daemonRegistrationWaiters.get(hostId) ??
        new Set<DaemonRegistrationWaiter>();
      waiters.add(waiter);
      this.daemonRegistrationWaiters.set(hostId, waiters);
    });
  }

  closeDaemonSession(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    const entry = this.daemonSessions.get(sessionId);
    if (entry) {
      entry.socket.send(JSON.stringify({ type: "session-close", reason }));
    }
    this.closeDaemonSessionSocket(sessionId, reason);
  }

  closeDaemonSessionSocket(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.socket.close(1000, reason);
    this.unregisterDaemon(sessionId);
  }

  scheduleDaemonDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonDisconnects.set(sessionId, timeout);
  }

  scheduleDaemonActiveWorkDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonActiveWorkDisconnects.set(sessionId, timeout);
  }

  private cancelPendingDaemonDisconnectGrace(sessionId: string): void {
    const timeout = this.pendingDaemonDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonDisconnects.delete(sessionId);
  }

  private cancelPendingDaemonActiveWorkDisconnect(sessionId: string): void {
    const timeout = this.pendingDaemonActiveWorkDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
  }

  cancelPendingDaemonDisconnect(sessionId: string): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
  }

  requestHostOnlineRpc(args: {
    hostId: string;
    message: HostDaemonOnlineRpcRequestMessage;
    timeoutMs: number;
  }): Promise<HostDaemonOnlineRpcResponseMessage> {
    const sessionId = this.daemonSessionIdsByHost.get(args.hostId);
    if (!sessionId) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }

    return new Promise<HostDaemonOnlineRpcResponseMessage>(
      (resolve, reject) => {
        const waiter: HostOnlineRpcWaiter = {
          reject,
          resolve,
          sessionId,
          timeout: setTimeout(() => {
            this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
            reject(new HostOnlineRpcTimeoutError());
          }, args.timeoutMs),
        };
        this.hostOnlineRpcWaiters.set(args.message.requestId, waiter);
        try {
          session.socket.send(JSON.stringify(args.message));
        } catch (error) {
          this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  }

  recordHostOnlineRpcResponse(
    args: RecordHostOnlineRpcResponseArgs,
  ): HostOnlineRpcResponseDisposition {
    const waiter = this.hostOnlineRpcWaiters.get(args.message.requestId);
    if (!waiter) {
      return { handled: false, reason: "stale" };
    }
    if (waiter.sessionId !== args.sessionId) {
      return {
        expectedSessionId: waiter.sessionId,
        handled: false,
        reason: "session_mismatch",
      };
    }
    this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
    waiter.resolve(args.message);
    return { handled: true };
  }

  registerThreadEventWaiter(
    threadId: string,
    timeoutMs: number,
  ): { promise: Promise<boolean>; cancel: () => void } {
    let waiter: ThreadEventWaiter;
    const promise = new Promise<boolean>((resolve) => {
      waiter = {
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteThreadEventWaiter(threadId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.threadEventWaiters.get(threadId) ?? new Set<ThreadEventWaiter>();
      waiters.add(waiter);
      this.threadEventWaiters.set(threadId, waiters);
    });
    const cancel = () => {
      this.deleteThreadEventWaiter(threadId, waiter!);
    };
    return { promise, cancel };
  }

  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void {
    const message: ThreadChangedMessage = {
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(metadata ? { metadata } : {}),
      changes,
    };
    if (isThreadListRelevantChange(message)) {
      this.notifyClients(message);
    } else {
      this.notifyThreadEventsAppendedCoalesced(threadId, message);
    }

    const threadEventWaiters = this.threadEventWaiters.get(threadId);
    if (threadEventWaiters) {
      for (const waiter of threadEventWaiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(true);
      }
      this.threadEventWaiters.delete(threadId);
    }
  }

  notifyThreadOpen(
    thread: { projectId: string; threadId: string },
    request: { split: ThreadOpenSplit; file: ThreadOpenFile | null },
  ): number {
    const payload = JSON.stringify(
      threadOpenSignalSchema.parse({
        type: "thread-open",
        projectId: thread.projectId,
        threadId: thread.threadId,
        split: request.split,
        file: request.file,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(payload);
      delivered += 1;
    }
    return delivered;
  }

  notifyThreadPaneAction(
    thread: { projectId: string; threadId: string },
    action: ThreadPaneAction,
  ): number {
    const payload = JSON.stringify(
      threadPaneActionSignalSchema.parse({
        type: "thread-pane-action",
        projectId: thread.projectId,
        threadId: thread.threadId,
        action,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(payload);
      delivered += 1;
    }
    return delivered;
  }

  notifyPluginSignal(
    pluginId: string,
    channel: string,
    payload: unknown,
  ): number {
    const message = JSON.stringify(
      pluginSignalSchema.parse({
        type: "plugin-signal",
        pluginId,
        channel,
        payload,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(message);
      delivered += 1;
    }
    return delivered;
  }

  notifyProject(projectId: string, changes: ProjectChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "project",
      id: projectId,
      changes,
    });
  }

  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "environment",
      id: environmentId,
      changes,
    });
  }

  notifyHost(hostId: string, changes: HostChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "host",
      id: hostId,
      changes,
    });
  }

  requestHostProtocolUpdateRetry(hostId: string): void {
    this.hostProtocolUpdateRetryRequests.add(hostId);
  }

  takeHostProtocolUpdateRetry(hostId: string): boolean {
    if (!this.hostProtocolUpdateRetryRequests.has(hostId)) {
      return false;
    }
    this.hostProtocolUpdateRetryRequests.delete(hostId);
    return true;
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "system",
      changes,
    });
  }

  private deleteThreadEventWaiter(
    threadId: string,
    waiter: ThreadEventWaiter,
  ): void {
    const waiters = this.threadEventWaiters.get(threadId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.threadEventWaiters.delete(threadId);
    }
  }

  private deleteHostOnlineRpcWaiter(
    requestId: string,
    waiter: HostOnlineRpcWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    if (this.hostOnlineRpcWaiters.get(requestId) === waiter) {
      this.hostOnlineRpcWaiters.delete(requestId);
    }
  }

  private rejectHostOnlineRpcWaitersForSession(sessionId: string): void {
    for (const [requestId, waiter] of this.hostOnlineRpcWaiters) {
      if (waiter.sessionId !== sessionId) {
        continue;
      }
      this.deleteHostOnlineRpcWaiter(requestId, waiter);
      waiter.reject(new HostOnlineRpcUnavailableError());
    }
  }

  private deleteDaemonRegistrationWaiter(
    hostId: string,
    waiter: DaemonRegistrationWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.daemonRegistrationWaiters.delete(hostId);
    }
  }

  private resolveDaemonRegistrationWaiters(hostId: string): void {
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.daemonRegistrationWaiters.delete(hostId);
  }

  private notifyThreadEventsAppendedCoalesced(
    threadId: string,
    message: ThreadChangedMessage,
  ): void {
    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    const detailSockets = this.clientSocketsByKey.get(
      subscriptionKey({ kind: "thread-detail", threadId }),
    );
    if (detailSockets) {
      this.notifyClientsByKeySet(detailSockets, payload);
    }
    this.notifyChangedMessageListeners(message);

    const eventTypes = message.metadata?.eventTypes ?? [];
    const pending = this.pendingThreadListEventsAppendedByThread.get(threadId);
    if (pending) {
      for (const eventType of eventTypes) {
        pending.eventTypes.add(eventType);
      }
      pending.merged = true;
      return;
    }

    this.notifyThreadListOnlySockets(threadId, payload);
    const timeout = setTimeout(() => {
      this.flushPendingThreadListEventsAppended(threadId);
    }, THREAD_LIST_EVENTS_APPENDED_COALESCE_MS);
    timeout.unref?.();
    this.pendingThreadListEventsAppendedByThread.set(threadId, {
      eventTypes: new Set(eventTypes),
      merged: false,
      timeout,
    });
  }

  private flushPendingThreadListEventsAppended(threadId: string): void {
    const pending = this.pendingThreadListEventsAppendedByThread.get(threadId);
    if (!pending) {
      return;
    }
    this.pendingThreadListEventsAppendedByThread.delete(threadId);
    if (!pending.merged) {
      return;
    }
    const message: ThreadChangedMessage = {
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(pending.eventTypes.size > 0
        ? { metadata: { eventTypes: [...pending.eventTypes] } }
        : {}),
      changes: ["events-appended"],
    };
    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    this.notifyThreadListOnlySockets(
      threadId,
      JSON.stringify(parseResult.data),
    );
  }

  private notifyThreadListOnlySockets(threadId: string, payload: string): void {
    const listSockets = this.clientSocketsByKey.get(
      subscriptionKey({ kind: "thread-list" }),
    );
    if (!listSockets) {
      return;
    }
    const detailKey = subscriptionKey({ kind: "thread-detail", threadId });
    for (const socket of listSockets) {
      if (this.clientKeysBySocket.get(socket)?.has(detailKey)) {
        continue;
      }
      socket.send(payload);
    }
  }

  private notifyClients(message: ChangedMessage): void {
    const sockets = new Set<HubSocket>();
    for (const key of subscriptionKeysForMessage(message)) {
      const specificSockets = this.clientSocketsByKey.get(key);
      if (!specificSockets) {
        continue;
      }
      for (const socket of specificSockets) {
        sockets.add(socket);
      }
    }

    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    this.notifyClientsByKeySet(sockets, payload);
    this.notifyChangedMessageListeners(message);
  }

  private notifyClientsByKeySet(
    sockets: Iterable<HubSocket>,
    payload: string,
  ): void {
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  private notifyChangedMessageListeners(message: ChangedMessage): void {
    for (const listener of this.changedMessageListeners) {
      listener(message);
    }
  }

  sendDaemonMessage(
    hostId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return false;
    }
    return this.sendDaemonSessionMessage(sessionId, message);
  }

  sendDaemonSessionMessage(
    sessionId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.socket.send(JSON.stringify(message));
    return true;
  }
}
