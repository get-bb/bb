import { setTimeout as sleep } from "node:timers/promises";
import {
  getEnvironment,
  getLatestThreadSequence,
  getThread,
  isThreadQueueAutoSendPaused,
  listQueuedThreadMessages,
  type QueuedThreadMessageRow,
} from "@bb/db";
import {
  queuedMessageWaitingOnSchema,
  turnScope,
  type PromptInput,
  type ThreadEvent,
} from "@bb/domain";
import type {
  MessageDispatchHookDecision,
  PluginHookName,
} from "@get-bb/plugin-sdk";
import {
  groupHostDaemonEvents,
  HOST_DAEMON_PROTOCOL_VERSION,
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  hostDaemonSessionOpenResponseSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
import type { SendMessageRequest } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { requestQueuedMessageDispatch } from "../../src/services/threads/queued-message-dispatch.js";
import {
  createQueuedMessageForThread,
  sendQueuedMessageNow,
} from "../../src/services/threads/queued-messages.js";
import {
  setPluginHookProvider,
  type PluginHookRegistration,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { stopThreadForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import { acceptThreadSendRequest } from "../../src/services/threads/thread-send-request.js";
import {
  onDaemonSocketClose,
  onDaemonSocketOpen,
} from "../../src/ws/daemon-protocol.js";
import { HostOnlineRpcTimeoutError } from "../../src/ws/hub.js";
import { availableModelFixture } from "../helpers/available-models.js";
import { internalAuthHeaders } from "../helpers/commands.js";
import { EMPTY_WORKSPACE_AGENT_CONTEXT } from "../helpers/host-rpc.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

type SendMode = Extract<
  SendMessageRequest["mode"],
  "queue-if-active" | "steer"
>;

type UserStep =
  | { kind: "send"; label: string; mode: SendMode }
  | { kind: "send-now"; label: string }
  | { kind: "add-to-queue"; label: string }
  | { kind: "stop" };

type ScenarioEvent = "drain" | "provider-turn" | "reconnect" | "timeout";

interface Scenario {
  name: string;
  start: "idle" | "running-turn";
  holdPreparation: boolean;
  pluginGatedLabels: string[];
  pluginHeldLabels: string[];
  user: UserStep[];
  events: ScenarioEvent[];
}

interface HeldRpc {
  id: number;
  request: HostDaemonOnlineRpcRequestMessage;
  serverWaiting: boolean;
  sessionId: string;
}

interface DaemonTurn {
  id: string;
  labels: string[];
  startedBy: "request" | "provider";
}

interface UserOutcome {
  afterStop: boolean;
  step: UserStep;
  label: string;
  settled: "pending" | "accepted" | "rejected";
  detail: string;
  refusedStatus: number | null;
}

interface HeldDecision {
  id: number;
  label: string;
  decide: (decision: MessageDispatchHookDecision) => void;
}

interface Action {
  label: string;
  run: () => Promise<void>;
}

interface Choice {
  index: number;
  labels: string[];
}

type RpcReply =
  | { ok: true; result: unknown }
  | { ok: false; errorCode: string; errorMessage: string };

const LABEL_PATTERN = /msg-[A-Za-z0-9]+/g;
const MAX_STEPS = 60;
const UNANSWERED_PATTERN = /^(command_timeout|host_unavailable):/;
const FOLLOW_UP_LABEL = "msg-followup";
const MAX_SCHEDULED_WAIT_MS = 20_000;
const MAX_PLUGIN_WAITS_PER_MESSAGE = 1;
const DISPATCH_REQUEUE_PACING_MS = 1_050;
const LIMITER_PLUGIN_ID = "limiter";

function hasPendingIoRequest(): boolean {
  return process
    .getActiveResourcesInfo()
    .some((resource) => resource.includes("Req"));
}

function labelsIn(text: string): string[] {
  return [...new Set(text.match(LABEL_PATTERN) ?? [])];
}

function labelsOf(input: readonly PromptInput[]): string[] {
  return labelsIn(JSON.stringify(input));
}

function describeUserStep(step: UserStep): string {
  switch (step.kind) {
    case "send":
      return `${step.mode === "steer" ? "steer" : "send"} ${step.label}`;
    case "send-now":
      return `send-now ${step.label}`;
    case "add-to-queue":
      return `add-to-queue ${step.label}`;
    case "stop":
      return "stop";
  }
}

function isLiveCommand(held: HeldRpc): boolean {
  return held.request.command.type !== "host.read_workspace_agent_context";
}

function describeRpc(held: HeldRpc): string {
  const { command } = held.request;
  if (command.type === "turn.submit") {
    return `submit(${command.target.mode} ${labelsOf(command.input).join("+")})#${held.id}`;
  }
  if (command.type === "thread.stop") {
    return `stop(${command.intent})#${held.id}`;
  }
  if (command.type === "host.read_workspace_agent_context") {
    return `prepare#${held.id}`;
  }
  return `${command.type}#${held.id}`;
}

class FakeDaemon {
  readonly held: HeldRpc[] = [];
  readonly turns: DaemonTurn[] = [];
  readonly deliveryOrder: string[] = [];
  readonly violations: string[] = [];
  activeTurn: DaemonTurn | null = null;
  connected = true;
  private nextRpcId = 1;
  private bufferedEvents: ThreadEvent[] = [];
  private readonly timeouts = new Map<string, () => void>();
  readonly socket = {
    close: () => undefined,
    send: (data: string) => this.receive(data),
  };

  constructor(
    private readonly harness: TestAppHarness,
    readonly hostId: string,
    private sessionId: string,
    readonly threadId: string,
    private readonly providerThreadId: string,
    private readonly holdPreparation: boolean,
  ) {
    const hub = harness.hub;
    const request = hub.requestHostOnlineRpc.bind(hub);
    vi.spyOn(hub, "requestHostOnlineRpc").mockImplementation((args) => {
      const response = request(args);
      response.catch(() => undefined);
      return new Promise<HostDaemonOnlineRpcResponseMessage>(
        (resolve, reject) => {
          this.timeouts.set(args.message.requestId, () =>
            reject(new HostOnlineRpcTimeoutError()),
          );
          response.then(resolve, reject);
        },
      );
    });
    hub.registerDaemon(sessionId, hostId, this.socket);
  }

  deliveries(label: string): number {
    return this.deliveryOrder.filter((delivered) => delivered === label).length;
  }

  releasableRpcs(): HeldRpc[] {
    const oldestLiveCommand = this.held.find(isLiveCommand);
    return this.held.filter(
      (held) => !isLiveCommand(held) || held === oldestLiveCommand,
    );
  }

  timeoutableRpcs(): HeldRpc[] {
    if (!this.connected) return [];
    return this.held.filter(
      (held) => held.serverWaiting && isLiveCommand(held),
    );
  }

  fireTimeout(held: HeldRpc): void {
    held.serverWaiting = false;
    this.timeouts.get(held.request.requestId)?.();
  }

  private receive(data: string): void {
    const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
    if (message.type !== "host-rpc.request") return;
    const { command } = message;
    switch (command.type) {
      case "turn.submit":
        if (labelsOf(command.input).length === 0) {
          this.violations.push(
            `turn.submit(${command.target.mode}) carried no message`,
          );
        }
        this.hold(message);
        return;
      case "thread.stop":
        this.hold(message);
        return;
      case "host.read_workspace_agent_context":
        if (this.holdPreparation) {
          this.hold(message);
          return;
        }
        this.respond(message, this.sessionId, {
          ok: true,
          result: EMPTY_WORKSPACE_AGENT_CONTEXT,
        });
        return;
      case "provider.list_models":
        this.respond(message, this.sessionId, {
          ok: true,
          result: {
            models: [
              availableModelFixture({
                model: "gpt-5",
                reasoningLevels: ["low", "medium", "high"],
                defaultReasoningLevel: "medium",
                isDefault: true,
              }),
            ],
            selectedOnlyModels: [],
          },
        });
        return;
      default:
        this.violations.push(`unexpected daemon RPC ${command.type}`);
        this.respond(message, this.sessionId, {
          ok: false,
          errorCode: "fake_daemon_unsupported",
          errorMessage: `The fake daemon does not handle ${command.type}`,
        });
    }
  }

  private hold(request: HostDaemonOnlineRpcRequestMessage): void {
    this.held.push({
      id: this.nextRpcId++,
      request,
      serverWaiting: true,
      sessionId: this.sessionId,
    });
  }

  private respond(
    request: HostDaemonOnlineRpcRequestMessage,
    sessionId: string,
    reply: RpcReply,
  ): void {
    if (!this.connected || sessionId !== this.sessionId) return;
    this.harness.hub.recordHostOnlineRpcResponse({
      message: hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId: request.requestId,
        commandType: request.command.type,
        ...reply,
      }),
      sessionId,
    });
  }

  async release(held: HeldRpc): Promise<void> {
    this.held.splice(this.held.indexOf(held), 1);
    const { command } = held.request;
    if (command.type === "host.read_workspace_agent_context") {
      this.respond(held.request, held.sessionId, {
        ok: true,
        result: EMPTY_WORKSPACE_AGENT_CONTEXT,
      });
      return;
    }
    if (command.type === "thread.stop") {
      const retained = command.intent === "release" && this.activeTurn !== null;
      if (command.intent === "interrupt" && this.activeTurn !== null) {
        await this.endTurn("interrupted");
      }
      this.respond(held.request, held.sessionId, {
        ok: true,
        result: {
          providerCheckpointId: null,
          ...(retained ? { activeTurnRetained: true } : {}),
        },
      });
      return;
    }
    if (command.type !== "turn.submit") return;
    if (command.target.mode === "start" && this.activeTurn !== null) {
      this.respond(held.request, held.sessionId, {
        ok: false,
        errorCode: "competing_turn",
        errorMessage: `Refusing to start a competing turn for thread "${this.threadId}" while another turn is active or starting`,
      });
      return;
    }
    const labels = labelsOf(command.input);
    let turn = this.activeTurn;
    if (turn === null) {
      turn = await this.startTurn("request", labels);
    } else {
      turn.labels.push(...labels);
    }
    this.deliveryOrder.push(...labels);
    await this.post([
      {
        type: "turn/input/accepted",
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope: turnScope(turn.id),
        clientRequestId: command.requestId,
      },
    ]);
    this.respond(held.request, held.sessionId, {
      ok: true,
      result: { trace: { spans: [] } },
    });
  }

  private async startTurn(
    startedBy: DaemonTurn["startedBy"],
    labels: string[],
  ): Promise<DaemonTurn> {
    const turn: DaemonTurn = {
      id: `turn-${this.turns.length + 1}`,
      labels: [...labels],
      startedBy,
    };
    this.turns.push(turn);
    this.activeTurn = turn;
    await this.post([
      {
        type: "turn/started",
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope: turnScope(turn.id),
      },
    ]);
    return turn;
  }

  async endTurn(status: "completed" | "interrupted"): Promise<void> {
    const turn = this.activeTurn;
    if (turn === null) throw new Error("Expected a running daemon turn");
    this.activeTurn = null;
    await this.post([
      {
        type: "turn/completed",
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope: turnScope(turn.id),
        status,
      },
    ]);
  }

  async runProviderTurn(): Promise<void> {
    await this.startTurn("provider", []);
    await this.endTurn("completed");
  }

  disconnect(): void {
    onDaemonSocketClose(this.harness.deps, this.sessionId);
    this.connected = false;
    for (const held of this.held) held.serverWaiting = false;
  }

  async reconnect(): Promise<void> {
    const response = await this.harness.app.request("/internal/session/open", {
      method: "POST",
      headers: internalAuthHeaders(this.harness, { hostId: this.hostId }),
      body: JSON.stringify({
        hostId: this.hostId,
        instanceId: "instance-1",
        hostName: "Test Host",
        hasMachineCredential: false,
        platform: "darwin",
        dataDir: `/tmp/bb-host-data/${this.hostId}`,
        localApiPort: null,
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        activeThreads:
          this.activeTurn === null ? [] : [{ threadId: this.threadId }],
        openThreadWork: [],
        undeliveredEventThreadIds:
          this.bufferedEvents.length === 0 ? [] : [this.threadId],
      }),
    });
    if (!response.ok) {
      throw new Error(`Session open failed: ${await response.text()}`);
    }
    this.sessionId = hostDaemonSessionOpenResponseSchema.parse(
      await response.json(),
    ).sessionId;
    onDaemonSocketOpen(this.harness.deps, {
      hostId: this.hostId,
      sessionId: this.sessionId,
      socket: this.socket,
    });
    this.connected = true;
    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    await this.post(buffered);
  }

  private async post(events: ThreadEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (!this.connected) {
      this.bufferedEvents.push(...events);
      return;
    }
    const response = await this.harness.app.request(
      "/internal/session/events",
      {
        method: "POST",
        headers: internalAuthHeaders(this.harness, { hostId: this.hostId }),
        body: JSON.stringify({
          sessionId: this.sessionId,
          eventGroups: groupHostDaemonEvents(
            events.map((event) => ({ threadId: event.threadId, event })),
          ),
        }),
      },
    );
    if (!response.ok) {
      this.violations.push(
        `daemon events refused (${response.status}): ${await response.text()}`,
      );
    }
  }
}

class LimiterPlugin {
  readonly held: HeldDecision[] = [];
  private readonly waits = new Map<string, number>();
  private readonly registrations: PluginHookRegistration<"message.dispatch">[] =
    [];
  private nextDecisionId = 1;

  constructor(
    private readonly gatedLabels: readonly string[],
    readonly heldLabels: readonly string[],
  ) {}

  install(): void {
    const registration: PluginHookRegistration<"message.dispatch"> = {
      pluginId: LIMITER_PLUGIN_ID,
      handler: (context) => {
        const labels = labelsIn(context.input.text);
        if (labels.some((label) => this.heldLabels.includes(label))) {
          return { action: "wait", reason: "held" };
        }
        const label = labels.find((candidate) =>
          this.gatedLabels.includes(candidate),
        );
        if (label === undefined) return { action: "proceed" };
        return new Promise<MessageDispatchHookDecision>((decide) => {
          this.held.push({ id: this.nextDecisionId++, label, decide });
        });
      },
    };
    const registry: {
      [K in PluginHookName]: PluginHookRegistration<K>[];
    } = { "message.dispatch": this.registrations };
    this.registrations.push(registration);
    setPluginHookProvider({
      listHooks: (hook) => registry[hook],
      invokeHook: async (_registration, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 24 * 60 * 60 * 1000,
    });
  }

  get registered(): boolean {
    return this.registrations.length > 0;
  }

  unregister(): void {
    this.registrations.length = 0;
  }

  heldBack(label: string): boolean {
    return this.heldLabels.includes(label) || this.waits.has(label);
  }

  mayWait(decision: HeldDecision): boolean {
    return (this.waits.get(decision.label) ?? 0) < MAX_PLUGIN_WAITS_PER_MESSAGE;
  }

  answer(decision: HeldDecision, action: "proceed" | "wait"): void {
    this.held.splice(this.held.indexOf(decision), 1);
    if (action === "wait") {
      this.waits.set(decision.label, (this.waits.get(decision.label) ?? 0) + 1);
      decision.decide({ action: "wait", reason: "full" });
      return;
    }
    decision.decide({ action: "proceed" });
  }
}

function waitingOnKind(row: QueuedThreadMessageRow): string | null {
  return row.waitingOn === null
    ? null
    : queuedMessageWaitingOnSchema.parse(JSON.parse(row.waitingOn)).kind;
}

class Run {
  readonly outcomes: UserOutcome[] = [];
  private readonly pending = new Set<Promise<void>>();
  private userIndex = 0;
  private readonly remainingEvents: ScenarioEvent[];
  private disconnected = false;
  private followUpSent = false;
  private stallReported = false;
  private recheckChecked = false;
  readonly limiter: LimiterPlugin;
  private readonly tailViolations: string[] = [];

  constructor(
    private readonly harness: TestAppHarness,
    readonly daemon: FakeDaemon,
    private readonly scenario: Scenario,
    private readonly environmentId: string,
  ) {
    this.remainingEvents = [...scenario.events];
    this.limiter = new LimiterPlugin(
      scenario.pluginGatedLabels,
      scenario.pluginHeldLabels,
    );
    if (
      scenario.pluginGatedLabels.length > 0 ||
      scenario.pluginHeldLabels.length > 0
    ) {
      this.limiter.install();
    }
  }

  private get threadId(): string {
    return this.daemon.threadId;
  }

  private track(
    step: UserStep,
    label: string,
    work: () => Promise<string>,
  ): void {
    const outcome: UserOutcome = {
      afterStop: this.outcomes.some((earlier) => earlier.step.kind === "stop"),
      step,
      label,
      settled: "pending",
      detail: "",
      refusedStatus: null,
    };
    this.outcomes.push(outcome);
    const tracked: Promise<void> = work()
      .then(
        (detail) => {
          outcome.settled = "accepted";
          outcome.detail = detail;
        },
        (error: unknown) => {
          outcome.settled = "rejected";
          outcome.refusedStatus =
            error instanceof ApiError ? error.status : null;
          outcome.detail =
            error instanceof ApiError
              ? `${error.body.code}: ${error.message}`
              : String(error);
        },
      )
      .finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  send(label: string, mode: SendMode): void {
    this.track({ kind: "send", label, mode }, label, async () => {
      const thread = getThread(this.harness.db, this.threadId);
      if (thread === null) throw new Error("Thread vanished");
      const response = await acceptThreadSendRequest(this.harness.deps, {
        thread,
        payload: {
          input: textInput(label),
          mode,
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
      });
      return response.delivery;
    });
  }

  private sendNow(label: string): void {
    this.track({ kind: "send-now", label }, `send-now ${label}`, async () => {
      const row = this.queuedRows().find((queued) =>
        labelsIn(queued.content).includes(label),
      );
      if (row === undefined) return "already sent";
      const response = await sendQueuedMessageNow(this.harness.deps, {
        mode: "auto",
        queuedMessageId: row.id,
        threadId: this.threadId,
      });
      return response.delivery;
    });
  }

  private addToQueue(label: string): void {
    this.track({ kind: "add-to-queue", label }, label, async () => {
      const thread = getThread(this.harness.db, this.threadId);
      if (thread === null) throw new Error("Thread vanished");
      await createQueuedMessageForThread(this.harness.deps, {
        thread,
        payload: { input: textInput(label) },
      });
      return "queued";
    });
  }

  private stop(): void {
    this.track({ kind: "stop" }, "stop", async () => {
      const thread = getThread(this.harness.db, this.threadId);
      const environment = getEnvironment(this.harness.db, this.environmentId);
      if (thread === null || environment === null) {
        throw new Error("Thread or environment vanished");
      }
      await stopThreadForCurrentState(this.harness.deps, thread, {
        id: environment.id,
        hostId: environment.hostId,
      });
      return "stopped";
    });
  }

  disconnect(): void {
    this.disconnected = true;
    this.daemon.disconnect();
  }

  private queuedRows() {
    return listQueuedThreadMessages(this.harness.db, this.threadId);
  }

  private fingerprint(): string {
    return JSON.stringify([
      getThread(this.harness.db, this.threadId)?.status,
      getLatestThreadSequence(this.harness.db, { threadId: this.threadId }),
      this.queuedRows().map((row) => [
        row.id,
        row.state,
        row.waitingOn,
        row.failureReason,
      ]),
      this.daemon.held.map((held) => held.id),
      this.limiter.held.map((decision) => decision.id),
      this.pending.size,
    ]);
  }

  async quiesce(): Promise<void> {
    let last = this.fingerprint();
    let stable = 0;
    for (let tick = 0; tick < 2_000 && stable < 3; tick += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const next = this.fingerprint();
      if (next === last && !hasPendingIoRequest()) {
        stable += 1;
      } else {
        stable = 0;
        last = next;
      }
    }
  }

  enabledActions(): Action[] {
    const actions: Action[] = [];
    const nextUser = this.scenario.user[this.userIndex];
    if (nextUser !== undefined && this.limiter.held.length === 0) {
      actions.push({
        label: describeUserStep(nextUser),
        run: async () => {
          this.userIndex += 1;
          if (nextUser.kind === "send") {
            this.send(nextUser.label, nextUser.mode);
          } else if (nextUser.kind === "send-now") {
            this.sendNow(nextUser.label);
          } else if (nextUser.kind === "add-to-queue") {
            this.addToQueue(nextUser.label);
          } else {
            this.stop();
          }
        },
      });
    }
    for (const held of this.daemon.releasableRpcs()) {
      actions.push({
        label: `release ${describeRpc(held)}`,
        run: () => this.daemon.release(held),
      });
    }
    for (const decision of this.limiter.held) {
      actions.push({
        label: `plugin proceeds ${decision.label}#${decision.id}`,
        run: async () => this.limiter.answer(decision, "proceed"),
      });
      if (this.limiter.mayWait(decision)) {
        actions.push({
          label: `plugin holds ${decision.label}#${decision.id}`,
          run: async () => this.limiter.answer(decision, "wait"),
        });
      }
    }
    const activeTurn = this.daemon.activeTurn;
    if (activeTurn !== null) {
      actions.push({
        label: `complete ${activeTurn.id}`,
        run: () => this.daemon.endTurn("completed"),
      });
    }
    const consume = (event: ScenarioEvent) => {
      this.remainingEvents.splice(this.remainingEvents.indexOf(event), 1);
    };
    if (
      this.remainingEvents.includes("drain") &&
      this.queuedRows().length > 0
    ) {
      actions.push({
        label: "drain wake",
        run: async () => {
          consume("drain");
          requestQueuedMessageDispatch(this.harness.deps, {
            kind: "thread-ready",
            threadId: this.threadId,
          });
        },
      });
    }
    if (this.remainingEvents.includes("provider-turn") && activeTurn === null) {
      actions.push({
        label: "provider turn",
        run: async () => {
          consume("provider-turn");
          await this.daemon.runProviderTurn();
        },
      });
    }
    if (this.remainingEvents.includes("reconnect")) {
      actions.push(
        this.disconnected
          ? {
              label: "daemon reconnect",
              run: async () => {
                consume("reconnect");
                await this.daemon.reconnect();
              },
            }
          : {
              label: "daemon disconnect",
              run: async () => this.disconnect(),
            },
      );
    }
    if (this.remainingEvents.includes("timeout")) {
      for (const held of this.daemon.timeoutableRpcs()) {
        actions.push({
          label: `timeout ${describeRpc(held)}`,
          run: async () => {
            consume("timeout");
            this.daemon.fireTimeout(held);
          },
        });
      }
    }
    return actions;
  }

  async finish(): Promise<boolean> {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      await this.quiesce();
      const held = this.daemon.held[0];
      if (held !== undefined) {
        await this.daemon.release(held);
        continue;
      }
      const decision = this.limiter.held[0];
      if (decision !== undefined) {
        this.limiter.answer(decision, "proceed");
        continue;
      }
      if (this.daemon.activeTurn !== null) {
        await this.daemon.endTurn("completed");
        continue;
      }
      const scheduledAt = this.nextScheduledSend();
      if (scheduledAt !== null) {
        await sleep(Math.max(0, scheduledAt - Date.now()) + 50);
        continue;
      }
      this.reportStalledRows();
      if (!this.recheckChecked && this.limiter.heldLabels.length > 0) {
        this.recheckChecked = true;
        await this.checkPluginRecheckReleasesGatedRows();
        continue;
      }
      if (this.limiter.registered && this.rowsWaitingOn("plugin").length > 0) {
        this.limiter.unregister();
        requestQueuedMessageDispatch(this.harness.deps, {
          kind: "plugin-unregistered",
          pluginId: LIMITER_PLUGIN_ID,
        });
        continue;
      }
      if (!this.followUpSent && this.queueHeldOnlyByManualStopPause()) {
        this.followUpSent = true;
        this.send(FOLLOW_UP_LABEL, "steer");
        continue;
      }
      return true;
    }
    return false;
  }

  private async checkPluginRecheckReleasesGatedRows(): Promise<void> {
    const gatedLabelsOf = () =>
      this.rowsWaitingOn("plugin").flatMap((row) =>
        labelsIn(row.content).filter(
          (label) => !this.limiter.heldLabels.includes(label),
        ),
      );
    if (gatedLabelsOf().length === 0) return;
    await sleep(DISPATCH_REQUEUE_PACING_MS);
    requestQueuedMessageDispatch(this.harness.deps, { kind: "plugin-recheck" });
    await this.quiesce();
    const stillHeld = gatedLabelsOf();
    if (stillHeld.length > 0) {
      this.tailViolations.push(
        `${stillHeld.join(", ")} stayed held after its plugin rechecked`,
      );
    }
  }

  private rowsWaitingOn(kind: string): QueuedThreadMessageRow[] {
    return this.queuedRows().filter((row) => waitingOnKind(row) === kind);
  }

  private reportStalledRows(): void {
    if (this.stallReported) return;
    if (getThread(this.harness.db, this.threadId)?.status !== "idle") return;
    const pausedByStop = this.queueHeldOnlyByManualStopPause();
    const stalled = this.queuedRows().filter(
      (row) =>
        row.sendAt === null && waitingOnKind(row) !== "plugin" && !pausedByStop,
    );
    if (stalled.length === 0) return;
    this.stallReported = true;
    this.tailViolations.push(
      `${stalled.map((row) => labelsIn(row.content).join("+")).join(", ")} sat queued on an idle thread with nothing left to send it`,
    );
  }

  private nextScheduledSend(): number | null {
    const sendAts = this.queuedRows().flatMap((row) =>
      row.sendAt !== null && row.sendAt <= Date.now() + MAX_SCHEDULED_WAIT_MS
        ? [row.sendAt]
        : [],
    );
    return sendAts.length === 0 ? null : Math.min(...sendAts);
  }

  private queueHeldOnlyByManualStopPause(): boolean {
    const rows = this.queuedRows();
    if (
      rows.length === 0 ||
      !isThreadQueueAutoSendPaused(this.harness.db, this.threadId)
    ) {
      return false;
    }
    const queuedAfterStop = new Set(
      this.outcomes
        .filter((outcome) => outcome.afterStop)
        .map((outcome) => outcome.label),
    );
    return rows.every((row) =>
      labelsIn(row.content).every((label) => !queuedAfterStop.has(label)),
    );
  }

  violations(): string[] {
    const violations = [...this.daemon.violations, ...this.tailViolations];
    for (const outcome of this.outcomes) {
      if (outcome.settled === "pending") {
        violations.push(`${outcome.label} never settled`);
        continue;
      }
      if (outcome.step.kind === "stop") {
        if (
          outcome.settled === "rejected" &&
          !UNANSWERED_PATTERN.test(outcome.detail)
        ) {
          violations.push(`stop failed: ${outcome.detail}`);
        }
        continue;
      }
      if (outcome.step.kind === "send-now") {
        if (
          outcome.settled === "rejected" &&
          !UNANSWERED_PATTERN.test(outcome.detail) &&
          (outcome.refusedStatus === null || outcome.refusedStatus >= 500)
        ) {
          violations.push(`${outcome.label} failed: ${outcome.detail}`);
        }
        continue;
      }
      const delivered = this.daemon.deliveries(outcome.label);
      if (outcome.settled === "rejected") {
        if (!UNANSWERED_PATTERN.test(outcome.detail)) {
          violations.push(`${outcome.label} was refused: ${outcome.detail}`);
        } else if (delivered > 0) {
          violations.push(
            `${outcome.label} was refused (${outcome.detail}) yet reached the agent ${delivered} times`,
          );
        }
        continue;
      }
      if (delivered !== 1) {
        violations.push(
          `${outcome.label} (${outcome.detail}) reached the agent ${delivered} times`,
        );
      }
    }
    const queuedInOrder = this.outcomes.filter(
      (outcome) =>
        ((outcome.step.kind === "send" &&
          outcome.step.mode === "queue-if-active") ||
          outcome.step.kind === "add-to-queue") &&
        outcome.detail === "queued" &&
        this.daemon.deliveries(outcome.label) === 1,
    );
    for (const [index, later] of queuedInOrder.entries()) {
      for (const earlier of queuedInOrder.slice(0, index)) {
        if (
          earlier.afterStop === later.afterStop &&
          !this.limiter.heldBack(earlier.label) &&
          this.daemon.deliveryOrder.indexOf(later.label) <
            this.daemon.deliveryOrder.indexOf(earlier.label)
        ) {
          violations.push(
            `queued ${later.label} overtook queued ${earlier.label}`,
          );
        }
      }
    }
    for (const turn of this.daemon.turns) {
      if (turn.startedBy === "request" && turn.labels.length === 0) {
        violations.push(`${turn.id} started without input`);
      }
    }
    const thread = getThread(this.harness.db, this.threadId);
    if (thread?.status !== "idle") {
      violations.push(`thread ended ${thread?.status ?? "missing"}`);
    }
    const queued = this.queuedRows();
    if (queued.length > 0) {
      violations.push(
        `queue still holds ${queued
          .map(
            (row) =>
              `${labelsIn(row.content).join("+")} [${row.state}${row.waitingOn === null ? "" : ` ${row.waitingOn}`}${row.failureReason === null ? "" : ` failed: ${row.failureReason}`}]`,
          )
          .join(", ")}`,
      );
    }
    if (this.daemon.held.length > 0) {
      violations.push(
        `daemon still holds ${this.daemon.held.map(describeRpc).join(", ")}`,
      );
    }
    return violations;
  }
}

function seedRun(harness: TestAppHarness, scenario: Scenario): Run {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-interleavings",
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/interleavings",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/interleavings",
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  const providerThreadId = "provider-interleavings";
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId,
    threadId: thread.id,
  });
  const daemon = new FakeDaemon(
    harness,
    host.id,
    session.id,
    thread.id,
    providerThreadId,
    scenario.holdPreparation,
  );
  return new Run(harness, daemon, scenario, environment.id);
}

async function startScenario(run: Run, scenario: Scenario): Promise<void> {
  if (scenario.start === "idle") return;
  run.send("msg-seed", "steer");
  for (let step = 0; step < 5 && run.daemon.activeTurn === null; step += 1) {
    await run.quiesce();
    const held = run.daemon.held[0];
    if (held !== undefined) await run.daemon.release(held);
  }
  if (run.daemon.activeTurn === null) {
    throw new Error("The seed message did not start a turn");
  }
}

function describeOrdering(choices: readonly Choice[]): string {
  return choices.map((choice) => choice.labels[choice.index]).join(" → ");
}

async function runOrdering(
  scenario: Scenario,
  prefix: readonly Choice[],
): Promise<{ choices: Choice[]; violations: string[] }> {
  return withTestHarness(async (harness) => {
    const run = seedRun(harness, scenario);
    await startScenario(run, scenario);
    const choices: Choice[] = [];
    for (;;) {
      await run.quiesce();
      const actions = run.enabledActions();
      if (actions.length === 0) break;
      if (choices.length === MAX_STEPS) {
        return {
          choices,
          violations: [`ordering did not finish within ${MAX_STEPS} steps`],
        };
      }
      const labels = actions.map((action) => action.label);
      const planned = prefix[choices.length];
      const index = planned?.index ?? 0;
      if (
        planned !== undefined &&
        labels[index] !== planned.labels[planned.index]
      ) {
        return {
          choices,
          violations: [
            `replay diverged: expected ${planned.labels[planned.index]}, found ${labels.join(", ")}`,
          ],
        };
      }
      choices.push({ index, labels });
      await actions[index]!.run();
    }
    const settled = await run.finish();
    await run.quiesce();
    return {
      choices,
      violations: settled
        ? run.violations()
        : [`the tail did not settle within ${MAX_STEPS} steps`],
    };
  });
}

interface FailedOrdering {
  ordering: string;
  violations: string[];
}

async function exploreOrderings(
  scenario: Scenario,
): Promise<{ failures: FailedOrdering[]; orderings: number }> {
  const failures: FailedOrdering[] = [];
  let prefix: Choice[] = [];
  let orderings = 0;
  for (;;) {
    const { choices, violations } = await runOrdering(scenario, prefix);
    orderings += 1;
    if (violations.length > 0) {
      failures.push({ ordering: describeOrdering(choices), violations });
    }
    let backtrack = choices.length - 1;
    while (
      backtrack >= 0 &&
      choices[backtrack]!.index + 1 >= choices[backtrack]!.labels.length
    ) {
      backtrack -= 1;
    }
    if (backtrack < 0) return { failures, orderings };
    const next = choices[backtrack]!;
    prefix = [
      ...choices.slice(0, backtrack),
      { index: next.index + 1, labels: next.labels },
    ];
  }
}

const send = (label: string): UserStep => ({
  kind: "send",
  label,
  mode: "queue-if-active",
});
const steer = (label: string): UserStep => ({
  kind: "send",
  label,
  mode: "steer",
});
const sendNow = (label: string): UserStep => ({ kind: "send-now", label });
const addToQueue = (label: string): UserStep => ({
  kind: "add-to-queue",
  label,
});
const stop: UserStep = { kind: "stop" };

const scenarios: Scenario[] = [
  {
    name: "steers in flight while their turn ends",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: [],
  },
  {
    name: "a new turn in flight while a provider-initiated turn ends",
    start: "idle",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: ["provider-turn"],
  },
  {
    name: "a queued send, a steer and a drain wake while preparation is slow",
    start: "running-turn",
    holdPreparation: true,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), steer("msg-B")],
    events: ["drain"],
  },
  {
    name: "a send-now of a queued message against the turn end while preparation is slow",
    start: "running-turn",
    holdPreparation: true,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), send("msg-B"), sendNow("msg-A")],
    events: [],
  },
  {
    name: "a steer, a queued send and the turn end across a daemon reconnect",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), send("msg-B")],
    events: ["reconnect"],
  },
  {
    name: "a stop against a steer, a queued send and the turn end",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), stop, send("msg-B")],
    events: [],
  },
  {
    name: "a stop and a steer across a daemon reconnect",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [stop, steer("msg-A")],
    events: ["reconnect"],
  },
  {
    name: "an RPC timeout against steers and the turn end",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: ["timeout"],
  },
  {
    name: "a plugin that holds a queued message against the turn end and a drain wake",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: ["msg-A"],
    pluginHeldLabels: [],
    user: [send("msg-A"), send("msg-B")],
    events: ["drain"],
  },
  {
    name: "a message added to the queue after a stop between queued sends",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), stop, addToQueue("msg-B")],
    events: [],
  },
  {
    name: "a plugin recheck for a held message on a thread that also holds a draft",
    start: "idle",
    holdPreparation: false,
    pluginGatedLabels: ["msg-H"],
    pluginHeldLabels: ["msg-D"],
    user: [send("msg-D"), send("msg-H")],
    events: [],
  },
];

afterEach(() => {
  setPluginHookProvider(undefined);
  vi.restoreAllMocks();
});

describe("send, queue and lifecycle interleavings", () => {
  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))(
    "%s",
    async (_name, scenario) => {
      const { failures, orderings } = await exploreOrderings(scenario);
      expect(
        failures.map(
          (failure) =>
            `${failure.ordering} :: ${failure.violations.join("; ")}`,
        ),
        `${failures.length} of ${orderings} orderings failed`,
      ).toEqual([]);
    },
    600_000,
  );
});
