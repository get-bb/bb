import {
  type ClientTurnRequestId,
  type PromptInput,
  type ThreadDelta,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  BRIDGE_REQUEST_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  createBridgeIo,
  experimental_defineProviderBridge,
  initializeParamsSchema,
  modelListParamsSchema,
  runBridgeRequest,
  threadResumeParamsSchema,
  threadStartParamsSchema,
  threadStopParamsSchema,
  turnStartParamsSchema,
  turnSteerParamsSchema,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import {
  ensureLocalBrainstem,
  stopManagedBrainstems,
} from "./brainstem-process.js";
import {
  callRapp,
  fixedBusinessModelList,
  listRappModels,
  RAPP_MAX_RESPONSE_BYTES,
  resolveRappClientConfig,
  setRappModel,
  type RappClientConfig,
  type RappChatResponse,
} from "./rapp-client.js";
import {
  RAPP_AGENT_ACTIVITY_PRESENTATION,
  RAPP_BUSINESS_MODEL_ID,
  RAPP_MESSAGE_PRESENTATION,
  RAPP_MODEL_ID,
  RAPP_SESSION_STATE_KIND,
  RAPP_SPEC,
  rappCatalogOptionsSchema,
  rappProviderOptionsSchema,
  type RappCatalogOptions,
  type RappProviderOptions,
} from "./vocabulary.js";
import {
  RappSessionStore,
  type RappDeliveryDraft,
  type RappPendingTurn,
  type RappSessionSnapshot,
  type SavedRappSession,
} from "./session-store.js";

type JsonRpcId = string | number;
type OutboundMessage = { jsonrpc: "2.0" } & Record<string, unknown>;
type RequestHandler = (id: JsonRpcId, params: unknown) => void | Promise<void>;

interface ActiveTurn {
  providerTurnId: string;
  controller: AbortController;
  promise: Promise<void>;
}

interface Session {
  threadId: string;
  providerThreadId: string;
  saved: SavedRappSession;
  deliveryEmittedInProcess: boolean;
  activeTurn: ActiveTurn | null;
  closed: boolean;
}

type RappBridgeDurabilityFault =
  | "after-completion-commit"
  | "after-delivery-emission";

const io = createBridgeIo<OutboundMessage>();
const sessions = new Map<string, Session>();
const consumerEndpointTails = new Map<string, Promise<void>>();
const maintenanceControllers = new Set<AbortController>();
const TURN_STOP_TIMEOUT_MS = 5_000;
const UNKNOWN_COMPLETION_MESSAGE = [
  "A prior RAPP completion is unknown.",
  "The endpoint may have completed the request, but legacy Brainstem does not honor idempotency keys, so bb will not replay it.",
  "Explicitly interrupt/stop this thread to discard the retained pending turn, then send a new message.",
].join(" ");
let sessionStore = new RappSessionStore();
let durabilityFault:
  | { stage: RappBridgeDurabilityFault; trigger: () => void }
  | null = null;

function notify(method: string, params: Record<string, unknown>): void {
  io.send({ jsonrpc: "2.0", method, params });
}

function emitDeltas(threadId: string, deltas: ThreadDelta[]): void {
  notify(THREAD_DELTA_NOTIFICATION_METHOD, { threadId, deltas });
}

function invalidParams(id: JsonRpcId, method: string, issues: unknown): void {
  io.send({
    jsonrpc: "2.0",
    id,
    error: {
      code: BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      message: `Invalid params for ${method}`,
      data: issues,
    },
  });
}

function parseProviderOptions(
  id: JsonRpcId,
  method: string,
  value: unknown,
): RappProviderOptions | null {
  const parsed = rappProviderOptionsSchema.safeParse(value);
  if (!parsed.success) {
    invalidParams(id, method, parsed.error.issues);
    return null;
  }
  try {
    resolveRappClientConfig(parsed.data);
  } catch (error) {
    invalidParams(
      id,
      method,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
  return parsed.data;
}

function parseCatalogOptions(
  id: JsonRpcId,
  method: string,
  value: unknown,
): RappCatalogOptions | null {
  const parsed = rappCatalogOptionsSchema.safeParse(value);
  if (!parsed.success) {
    invalidParams(id, method, parsed.error.issues);
    return null;
  }
  return parsed.data;
}

async function runConsumerEndpointExclusive<T>(
  config: RappClientConfig,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  const key = config.endpoint.toString();
  const previous = consumerEndpointTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  consumerEndpointTails.set(key, tail);
  try {
    await waitForPromiseOrAbort(
      previous.catch(() => undefined),
      signal,
    );
    if (signal.aborted) {
      throw signal.reason;
    }
    return await run();
  } finally {
    release();
    if (consumerEndpointTails.get(key) === tail) {
      consumerEndpointTails.delete(key);
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("RAPP request was interrupted");
}

function waitForPromiseOrAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (result: { value: T } | { error: unknown }): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if ("error" in result) {
        reject(result.error);
      } else {
        resolve(result.value);
      }
    };
    const onAbort = (): void => finish({ error: abortReason(signal) });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    promise.then(
      (value) => finish({ value }),
      (error: unknown) => finish({ error }),
    );
  });
}

async function waitForTurnSettlement(promise: Promise<void>): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), TURN_STOP_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

function renderPrompt(input: readonly PromptInput[]): string {
  return input
    .map((item) => {
      if (item.type === "text") {
        return item.text;
      }
      if (item.type === "image") {
        return `[Remote image: ${item.url}]`;
      }
      if (item.type === "localImage") {
        return `[Local image: ${item.path}]`;
      }
      const name = item.name === undefined ? item.path : item.name;
      return `[Local file: ${name} at ${item.path}]`;
    })
    .join("\n\n")
    .trim();
}

function conversationHistory(
  snapshot: RappSessionSnapshot,
  instructions: string | undefined,
) {
  const trimmed = instructions?.trim() ?? "";
  return [
    ...(trimmed === ""
      ? []
      : [
          {
            role: "user" as const,
            content: `BB thread instructions:\n${trimmed}`,
          },
        ]),
    ...snapshot.transcript.slice(-40),
  ];
}

function openSession(args: {
  threadId: string;
  providerThreadId: string;
  saved: SavedRappSession;
}): Session {
  const existing = sessions.get(args.threadId);
  if (existing !== undefined) {
    existing.closed = true;
    existing.activeTurn?.controller.abort();
  }
  const session: Session = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    saved: args.saved,
    deliveryEmittedInProcess: false,
    activeTurn: null,
    closed: false,
  };
  sessions.set(args.threadId, session);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  });
  if (session.saved.pendingDelivery !== null) {
    if (!deliverPending(session)) {
      throw new Error(
        "RAPP delivery replay was interrupted before acknowledgement",
      );
    }
  }
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
  return session;
}

function isOpenSession(session: Session): boolean {
  return !session.closed && sessions.get(session.threadId) === session;
}

function isCurrentTurn(session: Session, providerTurnId: string): boolean {
  return (
    isOpenSession(session) &&
    session.activeTurn?.providerTurnId === providerTurnId
  );
}

function turnItemProviderId(
  session: Session,
  turnCounter: number,
  name: string,
): string {
  return `${session.providerThreadId}-t${turnCounter}-${name}`;
}

function runDurabilityFault(stage: RappBridgeDurabilityFault): void {
  if (durabilityFault?.stage !== stage) {
    return;
  }
  const trigger = durabilityFault.trigger;
  durabilityFault = null;
  trigger();
}

function deliveryDeltas(saved: SavedRappSession): ThreadDelta[] {
  const delivery = saved.pendingDelivery;
  if (delivery === null) {
    return [];
  }
  const deltas: ThreadDelta[] = [];
  if (delivery.agentItemId !== null) {
    const logs = delivery.agentLogs.join("\n");
    deltas.push({
      kind: "item.close",
      key: { providerItemId: delivery.agentItemId },
      providerTurnId: delivery.providerTurnId,
      status: "completed",
      item: {
        type: "tool",
        tool: "rapp_agents",
        server: "rapp",
        args: { spec: RAPP_SPEC },
        result: logs,
      },
      presentation: RAPP_AGENT_ACTIVITY_PRESENTATION,
    });
  }
  deltas.push(
    {
      kind: "item.close",
      key: { providerItemId: delivery.messageItemId },
      providerTurnId: delivery.providerTurnId,
      status: "completed",
      item: { type: "agentMessage", text: delivery.response },
      presentation: RAPP_MESSAGE_PRESENTATION,
    },
    {
      kind: "extension.state",
      extensionKind: RAPP_SESSION_STATE_KIND,
      payload: {
        spec: RAPP_SPEC,
        grail: delivery.grail,
        rappid: saved.rappid,
        sessionId: saved.snapshot.remoteSessionId,
        turnCount: saved.snapshot.turnCounter,
        eggAddress: delivery.eggAddress,
        endpoint: delivery.endpoint,
        selectedModel: delivery.selectedModel,
        requestedModel: delivery.requestedModel,
        actualModel: delivery.actualModel,
      },
    },
    {
      kind: "turn.boundary",
      status: "completed",
      providerTurnId: delivery.providerTurnId,
    },
  );
  return deltas;
}

function deliverPending(session: Session): boolean {
  const deliveryAddress = session.saved.deliveryAddress;
  if (session.saved.pendingDelivery === null || deliveryAddress === null) {
    throw new Error("RAPP delivery journal state is incomplete");
  }
  emitDeltas(session.threadId, deliveryDeltas(session.saved));
  runDurabilityFault("after-delivery-emission");
  if (!isOpenSession(session)) {
    return false;
  }
  session.saved = sessionStore.markDeliveryEmitted(
    session.providerThreadId,
    deliveryAddress,
  );
  session.deliveryEmittedInProcess = true;
  return true;
}

function acknowledgeDeliveryBeforeNextTurn(session: Session): void {
  if (session.saved.pendingDelivery === null) {
    return;
  }
  if (!session.deliveryEmittedInProcess && !deliverPending(session)) {
    throw new Error(
      "RAPP delivery replay was interrupted before acknowledgement",
    );
  }
  const deliveryAddress = session.saved.deliveryAddress;
  if (deliveryAddress === null) {
    throw new Error("RAPP delivery journal state is incomplete");
  }
  session.saved = sessionStore.acknowledgeDelivery(
    session.providerThreadId,
    deliveryAddress,
  );
  session.deliveryEmittedInProcess = false;
}

function emitTurnFailure(
  session: Session,
  providerTurnId: string,
  status: "failed" | "interrupted",
  error?: string,
): void {
  emitDeltas(session.threadId, [
    {
      kind: "turn.boundary",
      status,
      providerTurnId,
      ...(error === undefined ? {} : { error: { message: error } }),
    },
  ]);
}

async function executeTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  options: RappProviderOptions;
  instructions: string | undefined;
  clientRequestId?: ClientTurnRequestId;
  providerTurnId: string;
  controller: AbortController;
}): Promise<void> {
  const { session } = args;
  const submittedPrompt = renderPrompt(args.input);
  let chatMayHaveStarted = false;
  let completionCommitted = false;
  emitDeltas(session.threadId, [
    {
      kind: "turn.open",
      providerTurnId: args.providerTurnId,
    },
    ...(args.clientRequestId === undefined
      ? []
      : [
          {
            kind: "input.accepted" as const,
            clientRequestId: args.clientRequestId,
            providerTurnId: args.providerTurnId,
          },
        ]),
  ]);
  try {
    if (session.saved.snapshot.pendingTurn !== null) {
      throw new Error(UNKNOWN_COMPLETION_MESSAGE);
    }
    if (submittedPrompt === "") {
      throw new Error("RAPP requires a non-empty prompt");
    }
    const turnCounter = session.saved.snapshot.turnCounter + 1;
    const config = resolveRappClientConfig(args.options);
    const pendingTurn: RappPendingTurn = {
      idempotencyKey:
        args.clientRequestId ?? `${session.providerThreadId}:${turnCounter}`,
      userInput: submittedPrompt,
      conversationHistory: conversationHistory(
        session.saved.snapshot,
        args.instructions,
      ),
    };
    const nextSnapshot: RappSessionSnapshot = {
      ...session.saved.snapshot,
      turnCounter,
      transcript: session.saved.snapshot.transcript.map((entry) => ({
        ...entry,
      })),
      pendingTurn: null,
    };
    sessionStore.assertCanCommitCompletion(
      nextSnapshot,
      pendingTurn.userInput,
      RAPP_MAX_RESPONSE_BYTES,
    );
    await ensureLocalBrainstem(config, args.controller.signal);
    const request = {
      userInput: pendingTurn.userInput,
      sessionId: session.saved.snapshot.remoteSessionId,
      idempotencyKey: pendingTurn.idempotencyKey,
      conversationHistory: pendingTurn.conversationHistory,
    };
    const persistPendingTurn = (): void => {
      if (args.controller.signal.aborted) {
        throw abortReason(args.controller.signal);
      }
      if (!isCurrentTurn(session, args.providerTurnId)) {
        throw new Error("RAPP turn is no longer active");
      }
      session.saved = sessionStore.save(
        { ...nextSnapshot, pendingTurn },
        null,
      );
      chatMayHaveStarted = true;
    };
    let response: RappChatResponse;
    let requestedModel: string | null;
    let actualModel: string | null;
    if (config.grail === "consumer") {
      const result = await runConsumerEndpointExclusive(
        config,
        args.controller.signal,
        async () => {
          const selectedModel =
            args.options.model === RAPP_MODEL_ID
              ? null
              : await setRappModel(
                  config,
                  args.options.model,
                  args.controller.signal,
                );
          persistPendingTurn();
          const consumerResponse = await callRapp(
            config,
            request,
            args.controller.signal,
          );
          if (selectedModel !== null) {
            if (consumerResponse.requestedModel === null) {
              throw new Error(
                `RAPP Brainstem did not report requested_model for selected model ${selectedModel}`,
              );
            }
            if (consumerResponse.requestedModel !== selectedModel) {
              throw new Error(
                `RAPP Brainstem requested model ${consumerResponse.requestedModel} after bb selected ${selectedModel}`,
              );
            }
          }
          return {
            response: consumerResponse,
            requestedModel: consumerResponse.requestedModel,
            actualModel: consumerResponse.actualModel,
          };
        },
      );
      response = result.response;
      requestedModel = result.requestedModel;
      actualModel = result.actualModel;
    } else {
      persistPendingTurn();
      response = await callRapp(config, request, args.controller.signal);
      requestedModel = null;
      actualModel = null;
    }
    if (!isCurrentTurn(session, args.providerTurnId)) {
      return;
    }
    const completedSnapshot: RappSessionSnapshot = {
      ...session.saved.snapshot,
      remoteSessionId: response.sessionId,
      transcript: [
        ...session.saved.snapshot.transcript,
        { role: "user", content: pendingTurn.userInput },
        { role: "assistant", content: response.response },
      ],
      pendingTurn: null,
    };
    const delivery: RappDeliveryDraft = {
      providerTurnId: args.providerTurnId,
      agentItemId:
        response.agentLogs.length === 0
          ? null
          : turnItemProviderId(session, turnCounter, "agents"),
      messageItemId: turnItemProviderId(session, turnCounter, "message"),
      response: response.response,
      agentLogs: [...response.agentLogs],
      grail: config.grail,
      endpoint: config.displayEndpoint,
      selectedModel: args.options.model,
      requestedModel,
      actualModel,
    };
    session.saved = sessionStore.save(completedSnapshot, delivery);
    completionCommitted = true;
    runDurabilityFault("after-completion-commit");
    if (!isCurrentTurn(session, args.providerTurnId)) {
      return;
    }
    deliverPending(session);
  } catch (error) {
    if (!isCurrentTurn(session, args.providerTurnId)) {
      return;
    }
    if (completionCommitted) {
      return;
    }
    if (args.controller.signal.aborted) {
      try {
        if (session.saved.snapshot.pendingTurn !== null) {
          session.saved = sessionStore.save(
            {
              ...session.saved.snapshot,
              pendingTurn: null,
            },
            null,
          );
        }
      } catch (clearError) {
        const message =
          clearError instanceof Error
            ? clearError.message
            : String(clearError);
        emitTurnFailure(
          session,
          args.providerTurnId,
          "failed",
          `Could not clear interrupted RAPP turn: ${message}`,
        );
        return;
      }
      emitTurnFailure(session, args.providerTurnId, "interrupted");
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    emitTurnFailure(
      session,
      args.providerTurnId,
      "failed",
      chatMayHaveStarted
        ? `${message} ${UNKNOWN_COMPLETION_MESSAGE}`
        : message,
    );
  }
}

function startTurn(args: {
  session: Session;
  input: readonly PromptInput[];
  options: RappProviderOptions;
  instructions: string | undefined;
  clientRequestId?: ClientTurnRequestId;
}): void {
  const turnCounter =
    args.session.saved.snapshot.pendingTurn === null
      ? args.session.saved.snapshot.turnCounter + 1
      : args.session.saved.snapshot.turnCounter;
  const providerTurnId =
    args.session.saved.snapshot.pendingTurn === null
      ? [
          args.session.providerThreadId,
          "turn",
          String(turnCounter),
          randomUUID().replaceAll("-", ""),
        ].join("-")
      : [
          args.session.providerThreadId,
          "blocked",
          String(turnCounter),
          randomUUID().replaceAll("-", ""),
        ].join("-");
  const controller = new AbortController();
  const promise = Promise.resolve()
    .then(() =>
      executeTurn({
        ...args,
        providerTurnId,
        controller,
      }),
    )
    .catch((error: unknown) => {
      if (isCurrentTurn(args.session, providerTurnId)) {
        emitTurnFailure(
          args.session,
          providerTurnId,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      }
    })
    .finally(() => {
      if (args.session.activeTurn?.providerTurnId === providerTurnId) {
        args.session.activeTurn = null;
      }
    });
  args.session.activeTurn = { providerTurnId, controller, promise };
}

const handlers: Record<string, RequestHandler> = {
  [BRIDGE_REQUEST_METHODS.initialize]: (id, params) => {
    const parsed = initializeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.initialize, parsed.error.issues);
      return;
    }
    io.sendResult(id, {
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: {
        grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
        sessionRestore: true,
        threadArchive: false,
        threadRename: false,
        threadGoalClear: false,
        fork: "none",
        approvalEnforcedBy: "provider",
        steerMode: "queue",
      },
    });
  },

  [BRIDGE_REQUEST_METHODS.modelList]: async (id, params) => {
    const parsed = modelListParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.modelList, parsed.error.issues);
      return;
    }
    const options = parseCatalogOptions(
      id,
      BRIDGE_REQUEST_METHODS.modelList,
      Reflect.get(parsed.data, "providerOptions"),
    );
    if (options === null) {
      return;
    }
    if (options.grail === "business") {
      io.sendResult(id, fixedBusinessModelList());
      return;
    }
    const config = resolveRappClientConfig(options);
    const controller = new AbortController();
    maintenanceControllers.add(controller);
    try {
      await ensureLocalBrainstem(config, controller.signal);
      const result = await runConsumerEndpointExclusive(
        config,
        controller.signal,
        () => listRappModels(config, controller.signal),
      );
      io.sendResult(id, result);
    } finally {
      maintenanceControllers.delete(controller);
    }
  },

  [BRIDGE_REQUEST_METHODS.threadStart]: (id, params) => {
    const parsed = threadStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadStart,
        parsed.error.issues,
      );
      return;
    }
    const options = parseProviderOptions(
      id,
      BRIDGE_REQUEST_METHODS.threadStart,
      parsed.data.options.providerOptions,
    );
    if (options === null) {
      return;
    }
    const providerThreadId = `rapp_${randomUUID().replaceAll("-", "")}`;
    const saved = sessionStore.create(providerThreadId);
    const session = openSession({
      threadId: parsed.data.threadId,
      providerThreadId,
      saved,
    });
    io.sendResult(id, { providerThreadId, sessionRestorable: true });
    if (parsed.data.input !== undefined && parsed.data.input.length > 0) {
      startTurn({
        session,
        input: parsed.data.input,
        options,
        instructions: parsed.data.options.instructions,
      });
    }
  },

  [BRIDGE_REQUEST_METHODS.threadResume]: (id, params) => {
    const parsed = threadResumeParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(
        id,
        BRIDGE_REQUEST_METHODS.threadResume,
        parsed.error.issues,
      );
      return;
    }
    const options = parseProviderOptions(
      id,
      BRIDGE_REQUEST_METHODS.threadResume,
      parsed.data.options.providerOptions,
    );
    if (options === null) {
      return;
    }
    const saved = sessionStore.load(parsed.data.providerThreadId);
    if (saved === null) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        `Unknown RAPP session: ${parsed.data.providerThreadId}`,
      );
      return;
    }
    openSession({
      threadId: parsed.data.threadId,
      providerThreadId: parsed.data.providerThreadId,
      saved,
    });
    io.sendResult(id, {
      providerThreadId: parsed.data.providerThreadId,
      sessionRestorable: true,
    });
  },

  [BRIDGE_REQUEST_METHODS.turnStart]: (id, params) => {
    const parsed = turnStartParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnStart, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (session === undefined) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        `No RAPP session for thread ${parsed.data.threadId}`,
      );
      return;
    }
    if (session.providerThreadId !== parsed.data.providerThreadId) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        "RAPP provider thread identity mismatch",
      );
      return;
    }
    if (session.activeTurn !== null) {
      io.sendError(
        id,
        BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
        "RAPP already has an active turn for this thread",
      );
      return;
    }
    const options = parseProviderOptions(
      id,
      BRIDGE_REQUEST_METHODS.turnStart,
      parsed.data.options.providerOptions,
    );
    if (options === null) {
      return;
    }
    if (session.saved.pendingDelivery !== null) {
      try {
        acknowledgeDeliveryBeforeNextTurn(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.sendError(
          id,
          BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
          `Could not replay the prior completed RAPP turn: ${message}`,
        );
        return;
      }
    }
    io.sendResult(id, {});
    startTurn({
      session,
      input: parsed.data.input,
      options,
      instructions: parsed.data.options.instructions,
      clientRequestId: parsed.data.clientRequestId,
    });
  },

  [BRIDGE_REQUEST_METHODS.turnSteer]: (id, params) => {
    const parsed = turnSteerParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.turnSteer, parsed.error.issues);
      return;
    }
    io.sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN,
      `RAPP's synchronous wire cannot steer turn ${parsed.data.expectedTurnId}`,
    );
  },

  [BRIDGE_REQUEST_METHODS.threadStop]: async (id, params) => {
    const parsed = threadStopParamsSchema.safeParse(params);
    if (!parsed.success) {
      invalidParams(id, BRIDGE_REQUEST_METHODS.threadStop, parsed.error.issues);
      return;
    }
    const session = sessions.get(parsed.data.threadId);
    if (
      session === undefined ||
      session.providerThreadId !== parsed.data.providerThreadId
    ) {
      io.sendResult(id, {});
      return;
    }
    if (parsed.data.intent === "interrupt") {
      const activeTurn = session.activeTurn;
      let canClearPending = activeTurn === null;
      if (
        activeTurn !== null &&
        parsed.data.activeTurnId === activeTurn.providerTurnId
      ) {
        activeTurn.controller.abort();
        const settled = await waitForTurnSettlement(activeTurn.promise);
        if (!settled && isCurrentTurn(session, activeTurn.providerTurnId)) {
          session.activeTurn = null;
          emitTurnFailure(session, activeTurn.providerTurnId, "interrupted");
        }
        canClearPending = true;
      } else if (activeTurn !== null && parsed.data.activeTurnId === null) {
        canClearPending = await waitForTurnSettlement(activeTurn.promise);
      }
      if (canClearPending && session.saved.snapshot.pendingTurn !== null) {
        try {
          session.saved = sessionStore.save(
            {
              ...session.saved.snapshot,
              pendingTurn: null,
            },
            null,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          io.sendError(
            id,
            BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
            `Could not discard the retained RAPP turn: ${message}`,
          );
          return;
        }
      }
      io.sendResult(id, {});
      return;
    }
    if (session.activeTurn !== null) {
      const settled = await waitForTurnSettlement(session.activeTurn.promise);
      if (!settled) {
        io.sendError(
          id,
          BRIDGE_JSON_RPC_ERRORS.BRIDGE_ERROR,
          "RAPP turn did not settle before session release",
        );
        return;
      }
    }
    session.closed = true;
    if (sessions.get(parsed.data.threadId) === session) {
      sessions.delete(parsed.data.threadId);
    }
    io.sendResult(id, {});
  },
};

export function handleLine(line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (
    typeof message !== "object" ||
    message === null ||
    Array.isArray(message)
  ) {
    return;
  }
  const id: unknown = Reflect.get(message, "id");
  const method: unknown = Reflect.get(message, "method");
  const params: unknown = Reflect.get(message, "params");
  if (typeof method !== "string") {
    return;
  }
  if (typeof id !== "string" && typeof id !== "number") {
    return;
  }
  const handler = handlers[method];
  if (handler === undefined) {
    io.sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Method not found: ${method}`,
    );
    return;
  }
  runBridgeRequest({
    request: { id, method, params },
    sendError: io.sendError,
    handleRequest: async (request) => handler(request.id, request.params),
  });
}

export function experimental_resetRappBridgeForTests(dataDir?: string): void {
  shutdownBridge();
  durabilityFault = null;
  sessionStore = new RappSessionStore(dataDir);
}

export function experimental_setRappBridgeDurabilityFaultForTests(
  stage: RappBridgeDurabilityFault,
  trigger: () => void,
): void {
  durabilityFault = { stage, trigger };
}

function shutdownBridge(): void {
  for (const controller of maintenanceControllers) {
    controller.abort();
  }
  maintenanceControllers.clear();
  for (const session of sessions.values()) {
    session.closed = true;
    session.activeTurn?.controller.abort();
  }
  sessions.clear();
  consumerEndpointTails.clear();
  void stopManagedBrainstems();
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  start(context) {
    experimental_resetRappBridgeForTests(context.dataDir);
  },
  onClose() {
    shutdownBridge();
  },
  onSigterm() {
    shutdownBridge();
  },
  onSigint() {
    shutdownBridge();
  },
});
