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
  type RappPendingTurn,
  type RappSessionSnapshot,
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
  snapshot: RappSessionSnapshot;
  activeTurn: ActiveTurn | null;
  closed: boolean;
}

const io = createBridgeIo<OutboundMessage>();
const sessions = new Map<string, Session>();
const consumerEndpointTails = new Map<string, Promise<void>>();
const maintenanceControllers = new Set<AbortController>();
const TURN_STOP_TIMEOUT_MS = 5_000;
let sessionStore = new RappSessionStore();

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
  snapshot: RappSessionSnapshot;
}): Session {
  const existing = sessions.get(args.threadId);
  if (existing !== undefined) {
    existing.closed = true;
    existing.activeTurn?.controller.abort();
  }
  const session: Session = {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    snapshot: args.snapshot,
    activeTurn: null,
    closed: false,
  };
  sessions.set(args.threadId, session);
  notify(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
  });
  emitDeltas(args.threadId, [{ kind: "session.reset" }]);
  return session;
}

function isCurrentTurn(session: Session, providerTurnId: string): boolean {
  return (
    !session.closed &&
    sessions.get(session.threadId) === session &&
    session.activeTurn?.providerTurnId === providerTurnId
  );
}

function turnItemId(session: Session, turnCounter: number, name: string) {
  return {
    providerItemId: `${session.providerThreadId}-t${turnCounter}-${name}`,
  };
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
  let pendingTurn: RappPendingTurn | null = null;
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
    if (session.snapshot.pendingTurn === null) {
      if (submittedPrompt === "") {
        throw new Error("RAPP requires a non-empty prompt");
      }
      const turnCounter = session.snapshot.turnCounter + 1;
      pendingTurn = {
        idempotencyKey:
          args.clientRequestId ?? `${session.providerThreadId}:${turnCounter}`,
        userInput: submittedPrompt,
        conversationHistory: conversationHistory(
          session.snapshot,
          args.instructions,
        ),
      };
      const nextSnapshot: RappSessionSnapshot = {
        ...session.snapshot,
        turnCounter,
        transcript: session.snapshot.transcript.map((entry) => ({ ...entry })),
        pendingTurn,
      };
      session.snapshot = sessionStore.save(nextSnapshot).snapshot;
    } else {
      pendingTurn = session.snapshot.pendingTurn;
    }
    const config = resolveRappClientConfig(args.options);
    await ensureLocalBrainstem(config, args.controller.signal);
    const request = {
      userInput: pendingTurn.userInput,
      sessionId: session.snapshot.remoteSessionId,
      idempotencyKey: pendingTurn.idempotencyKey,
      conversationHistory: pendingTurn.conversationHistory,
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
      response = await callRapp(config, request, args.controller.signal);
      requestedModel = RAPP_BUSINESS_MODEL_ID;
      actualModel = RAPP_BUSINESS_MODEL_ID;
    }
    if (!isCurrentTurn(session, args.providerTurnId)) {
      return;
    }
    const completedSnapshot: RappSessionSnapshot = {
      ...session.snapshot,
      remoteSessionId: response.sessionId,
      transcript: [
        ...session.snapshot.transcript,
        { role: "user", content: pendingTurn.userInput },
        { role: "assistant", content: response.response },
      ],
      pendingTurn: null,
    };
    const saved = sessionStore.save(completedSnapshot);
    session.snapshot = saved.snapshot;

    const deltas: ThreadDelta[] = [];
    if (response.agentLogs.length > 0) {
      const logsKey = turnItemId(
        session,
        session.snapshot.turnCounter,
        "agents",
      );
      const logs = response.agentLogs.join("\n");
      deltas.push(
        {
          kind: "item.open",
          key: logsKey,
          providerTurnId: args.providerTurnId,
          item: {
            type: "tool",
            tool: "rapp_agents",
            server: "rapp",
            args: { spec: RAPP_SPEC },
          },
          presentation: RAPP_AGENT_ACTIVITY_PRESENTATION,
        },
        {
          kind: "item.close",
          key: logsKey,
          providerTurnId: args.providerTurnId,
          status: "completed",
          item: {
            type: "tool",
            tool: "rapp_agents",
            server: "rapp",
            args: { spec: RAPP_SPEC },
            result: logs,
          },
          presentation: RAPP_AGENT_ACTIVITY_PRESENTATION,
        },
      );
    }

    const messageKey = turnItemId(
      session,
      session.snapshot.turnCounter,
      "message",
    );
    deltas.push(
      {
        kind: "item.open",
        key: messageKey,
        providerTurnId: args.providerTurnId,
        item: { type: "agentMessage", text: "" },
        presentation: RAPP_MESSAGE_PRESENTATION,
      },
      {
        kind: "item.textClose",
        key: messageKey,
        providerTurnId: args.providerTurnId,
        channel: "agentMessage",
        text: response.response,
      },
      {
        kind: "extension.state",
        extensionKind: RAPP_SESSION_STATE_KIND,
        payload: {
          spec: RAPP_SPEC,
          grail: config.grail,
          rappid: saved.rappid,
          sessionId: session.snapshot.remoteSessionId,
          turnCount: session.snapshot.turnCounter,
          eggAddress: saved.eggAddress,
          endpoint: config.displayEndpoint,
          selectedModel: args.options.model,
          requestedModel,
          actualModel,
        },
      },
      {
        kind: "turn.boundary",
        status: "completed",
        providerTurnId: args.providerTurnId,
      },
    );
    emitDeltas(session.threadId, deltas);
  } catch (error) {
    if (!isCurrentTurn(session, args.providerTurnId)) {
      return;
    }
    if (args.controller.signal.aborted) {
      try {
        session.snapshot = sessionStore.save({
          ...session.snapshot,
          pendingTurn: null,
        }).snapshot;
      } catch (clearError) {
        emitTurnFailure(
          session,
          args.providerTurnId,
          "failed",
          `Could not clear interrupted RAPP turn: ${clearError instanceof Error ? clearError.message : String(clearError)}`,
        );
        return;
      }
      emitTurnFailure(session, args.providerTurnId, "interrupted");
      return;
    }
    emitTurnFailure(
      session,
      args.providerTurnId,
      "failed",
      error instanceof Error ? error.message : String(error),
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
    args.session.snapshot.pendingTurn === null
      ? args.session.snapshot.turnCounter + 1
      : args.session.snapshot.turnCounter;
  const providerTurnId = `${args.session.providerThreadId}-turn-${turnCounter}-${randomUUID().replaceAll("-", "")}`;
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
      snapshot: saved.snapshot,
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
      snapshot: saved.snapshot,
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
  sessionStore = new RappSessionStore(dataDir);
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
