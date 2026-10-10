import {
  decodeAvailableCommands,
  decodeConfigOptions,
  decodeContentBlock,
  decodeContentBlocks,
  decodeLegacyModels,
  decodeLegacyModes,
  decodePlanEntries,
  decodeToolCallContent,
  decodeToolCallContentItem,
  decodeToolCallLocations,
  decodeUsageCost,
  decodeUsageCounts,
  decodeWorkError,
  isJsonObject,
  readMeta,
  readString,
} from "./decode.js";
import type {
  AcpAvailableCommand,
  AcpConfigOption,
  AcpJsonObject,
  AcpMessageEntity,
  AcpMessageRole,
  AcpPlanEntity,
  AcpSessionEvent,
  AcpSessionInfo,
  AcpSessionSnapshot,
  AcpSessionUsage,
  AcpSessionWork,
  AcpToolCallEntity,
  AcpToolCallField,
  AcpWorkError,
} from "./session-types.js";

export type AcpProtocolGeneration = 1 | 2;

export interface AcpSessionModelOptions {
  generation: AcpProtocolGeneration;
}

export interface AcpSessionSetup {
  configOptions?: unknown;
  modes?: unknown;
  models?: unknown;
}

export type AcpPromptOutcome = { stopReason: string } | { error: AcpWorkError };

export interface AcpSessionModel {
  snapshot(): AcpSessionSnapshot;
  applySessionUpdate(update: unknown): AcpSessionEvent[];
  applySessionSetup(setup: AcpSessionSetup): AcpSessionEvent[];
  applyConfigOptions(configOptions: unknown): AcpSessionEvent[];
  applyConfigOptionValue(
    optionId: string,
    value: string | boolean,
  ): AcpSessionEvent[];
  beginReplay(): void;
  endReplay(): void;
  promptSubmitted(): AcpSessionEvent[];
  promptSettled(outcome: AcpPromptOutcome): AcpSessionEvent[];
  actionRequested(key: string): AcpSessionEvent[];
  actionResolved(key: string): AcpSessionEvent[];
  agentWorkSettled(stopReason: string): AcpSessionEvent[];
  hasUnfinishedToolCalls(): boolean;
  closeUnfinishedToolCalls(status: string): AcpSessionEvent[];
}

const DEFAULT_PLAN_ID = "default";
const TERMINAL_TOOL_CALL_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
]);
const MESSAGE_CHUNK_ROLES: Readonly<Record<string, AcpMessageRole>> = {
  user_message_chunk: "user",
  agent_message_chunk: "agent",
  agent_thought_chunk: "thought",
};
const MESSAGE_UPSERT_ROLES: Readonly<Record<string, AcpMessageRole>> = {
  user_message: "user",
  agent_message: "agent",
  agent_thought: "thought",
};
const TOOL_CALL_STRING_FIELDS = ["title", "name", "kind", "status"] as const;

export function isTerminalToolCallStatus(status: string): boolean {
  return TERMINAL_TOOL_CALL_STATUSES.has(status);
}

export function createAcpSessionModel(
  options: AcpSessionModelOptions,
): AcpSessionModel {
  const nullClears = options.generation === 2;
  const agentReportsState = options.generation === 2;

  let work: AcpSessionWork = {
    state: "idle",
    initiator: null,
    stopReason: null,
    error: null,
  };
  let promptsInFlight = 0;
  let agentWorking = false;
  const pendingActions = new Set<string>();

  const messages = new Map<string, AcpMessageEntity>();
  const toolCalls = new Map<string, AcpToolCallEntity>();
  const plans = new Map<string, AcpPlanEntity>();
  let agentConfigOptions: AcpConfigOption[] = [];
  let legacyMode: AcpConfigOption | null = null;
  let legacyModel: AcpConfigOption | null = null;
  let commands: AcpAvailableCommand[] = [];
  let info: AcpSessionInfo = { title: null, updatedAt: null };
  let usage: AcpSessionUsage | null = null;

  let replaying = false;
  let currentMessage: AcpMessageEntity | null = null;
  let synthesizedMessageCount = 0;

  let legacyModeRepeatsThoughtLevels = false;

  function noteLegacyModeOverlap(): void {
    const mode = legacyMode;
    if (
      legacyModeRepeatsThoughtLevels ||
      mode === null ||
      mode.type !== "select" ||
      mode.values.length === 0
    ) {
      return;
    }
    legacyModeRepeatsThoughtLevels = agentConfigOptions.some(
      (option) =>
        option.category === "thought_level" &&
        option.type === "select" &&
        mode.values.every((modeValue) =>
          option.values.some((level) => level.value === modeValue.value),
        ),
    );
  }

  function effectiveConfigOptions(): AcpConfigOption[] {
    const hasCategory = (category: string) =>
      agentConfigOptions.some((option) => option.category === category);
    return [
      ...agentConfigOptions,
      ...(legacyModel && !hasCategory("model") ? [legacyModel] : []),
      ...(legacyMode && !hasCategory("mode") && !legacyModeRepeatsThoughtLevels
        ? [legacyMode]
        : []),
    ];
  }

  function configOptionsEvent(): AcpSessionEvent {
    return {
      type: "configOptions",
      replay: replaying,
      configOptions: effectiveConfigOptions(),
    };
  }

  function setWork(next: AcpSessionWork): AcpSessionEvent[] {
    if (
      next.state === work.state &&
      next.initiator === work.initiator &&
      next.stopReason === work.stopReason &&
      next.error === work.error
    ) {
      return [];
    }
    const previous = work;
    work = next;
    if (next.state === "idle") {
      currentMessage = null;
    }
    return [{ type: "work", replay: replaying, previous, work: next }];
  }

  function deriveWork(
    settlement: { stopReason: string; error: AcpWorkError | null } | null,
  ): AcpSessionEvent[] {
    if (promptsInFlight === 0 && !agentWorking) {
      return setWork({
        state: "idle",
        initiator: null,
        stopReason: settlement?.stopReason ?? work.stopReason,
        error: settlement ? settlement.error : work.error,
      });
    }
    return setWork({
      state: pendingActions.size > 0 ? "requires_action" : "running",
      initiator: promptsInFlight > 0 ? "client" : "agent",
      stopReason: null,
      error: null,
    });
  }

  function noteAgentActivity(): AcpSessionEvent[] {
    if (agentReportsState || replaying) {
      return [];
    }
    if (promptsInFlight > 0 || agentWorking) {
      return [];
    }
    agentWorking = true;
    return deriveWork(null);
  }

  function unhandled(
    reason: "unknown-variant" | "malformed",
    sessionUpdate: string | null,
    raw: unknown,
  ): AcpSessionEvent[] {
    return [
      { type: "unhandled", replay: replaying, reason, sessionUpdate, raw },
    ];
  }

  function toolCallEvent(
    toolCall: AcpToolCallEntity,
    created: boolean,
    updated: AcpToolCallField[],
  ): AcpSessionEvent {
    return {
      type: "toolCall",
      replay: replaying,
      created,
      updated,
      toolCall: {
        ...toolCall,
        content: [...toolCall.content],
        locations: [...toolCall.locations],
      },
    };
  }

  function resolveMessage(
    role: AcpMessageRole,
    messageId: string | undefined,
  ): AcpMessageEntity {
    if (messageId !== undefined) {
      const existing = messages.get(messageId);
      if (existing) {
        return existing;
      }
      const created: AcpMessageEntity = {
        messageId,
        role,
        content: [],
        idSource: "agent",
      };
      messages.set(messageId, created);
      return created;
    }
    if (
      currentMessage &&
      currentMessage.role === role &&
      currentMessage.idSource === "synthesized"
    ) {
      return currentMessage;
    }
    synthesizedMessageCount += 1;
    const created: AcpMessageEntity = {
      messageId: `bb-message-${synthesizedMessageCount}`,
      role,
      content: [],
      idSource: "synthesized",
    };
    messages.set(created.messageId, created);
    return created;
  }

  function applyMessageChunk(
    role: AcpMessageRole,
    sessionUpdate: string,
    update: AcpJsonObject,
  ): AcpSessionEvent[] {
    const block = decodeContentBlock(update["content"]);
    if (!block) {
      return unhandled("malformed", sessionUpdate, update);
    }
    const activity = noteAgentActivity();
    const message = resolveMessage(role, readString(update, "messageId"));
    message.content.push(block);
    currentMessage = message;
    return [
      ...activity,
      {
        type: "message",
        replay: replaying,
        change: "appended",
        messageId: message.messageId,
        role: message.role,
        idSource: message.idSource,
        appended: [block],
      },
    ];
  }

  function applyMessageUpsert(
    role: AcpMessageRole,
    sessionUpdate: string,
    update: AcpJsonObject,
  ): AcpSessionEvent[] {
    const messageId = readString(update, "messageId");
    if (messageId === undefined) {
      return unhandled("malformed", sessionUpdate, update);
    }
    const activity = noteAgentActivity();
    const message = resolveMessage(role, messageId);
    if ("content" in update) {
      message.content =
        update["content"] === null
          ? []
          : (decodeContentBlocks(update["content"]) ?? message.content);
    }
    currentMessage = message;
    return [
      ...activity,
      {
        type: "message",
        replay: replaying,
        change: "replaced",
        messageId: message.messageId,
        role: message.role,
        idSource: message.idSource,
        content: [...message.content],
      },
    ];
  }

  function applyToolCallPatch(
    sessionUpdate: string,
    update: AcpJsonObject,
  ): AcpSessionEvent[] {
    const toolCallId = readString(update, "toolCallId");
    if (toolCallId === undefined) {
      return unhandled("malformed", sessionUpdate, update);
    }
    const existing = toolCalls.get(toolCallId);
    const toolCall: AcpToolCallEntity = existing ?? {
      toolCallId,
      title: "",
      status: "pending",
      content: [],
      locations: [],
    };
    const updated: AcpToolCallField[] = [];

    for (const field of TOOL_CALL_STRING_FIELDS) {
      if (!(field in update)) {
        continue;
      }
      const value = update[field];
      if (typeof value === "string") {
        toolCall[field] = value;
        updated.push(field);
        continue;
      }
      if (value === null && nullClears) {
        if (field === "title") {
          toolCall.title = "";
        } else if (field === "status") {
          toolCall.status = "pending";
        } else {
          delete toolCall[field];
        }
        updated.push(field);
      }
    }

    if ("content" in update) {
      const content = decodeToolCallContent(update["content"]);
      if (content) {
        toolCall.content = content;
        updated.push("content");
      } else if (update["content"] === null && nullClears) {
        toolCall.content = [];
        updated.push("content");
      }
    }
    if ("locations" in update) {
      const locations = decodeToolCallLocations(update["locations"]);
      if (locations) {
        toolCall.locations = locations;
        updated.push("locations");
      } else if (update["locations"] === null && nullClears) {
        toolCall.locations = [];
        updated.push("locations");
      }
    }
    for (const field of ["rawInput", "rawOutput"] as const) {
      if (!(field in update)) {
        continue;
      }
      const value = update[field];
      if (value === null || value === undefined) {
        if (nullClears && value === null && field in toolCall) {
          delete toolCall[field];
          updated.push(field);
        }
        continue;
      }
      toolCall[field] = value;
      updated.push(field);
    }
    const meta = readMeta(update);
    if (meta) {
      toolCall.meta = { ...toolCall.meta, ...meta };
      updated.push("meta");
    }

    const created = existing === undefined;
    if (created) {
      toolCalls.set(toolCallId, toolCall);
      currentMessage = null;
    }
    const activity =
      created || !isTerminalToolCallStatus(toolCall.status)
        ? noteAgentActivity()
        : [];
    return [...activity, toolCallEvent(toolCall, created, updated)];
  }

  function applyToolCallContentChunk(
    sessionUpdate: string,
    update: AcpJsonObject,
  ): AcpSessionEvent[] {
    const toolCallId = readString(update, "toolCallId");
    const item = decodeToolCallContentItem(update["content"]);
    if (toolCallId === undefined || !item) {
      return unhandled("malformed", sessionUpdate, update);
    }
    const existing = toolCalls.get(toolCallId);
    const toolCall: AcpToolCallEntity = existing ?? {
      toolCallId,
      title: "",
      status: "pending",
      content: [],
      locations: [],
    };
    toolCall.content.push(item);
    const created = existing === undefined;
    if (created) {
      toolCalls.set(toolCallId, toolCall);
      currentMessage = null;
    }
    return [
      ...noteAgentActivity(),
      toolCallEvent(toolCall, created, ["content"]),
    ];
  }

  function applyPlan(
    sessionUpdate: string,
    planId: string,
    rawEntries: unknown,
    raw: AcpJsonObject,
  ): AcpSessionEvent[] {
    const entries = decodePlanEntries(rawEntries);
    if (!entries) {
      return unhandled("malformed", sessionUpdate, raw);
    }
    const plan: AcpPlanEntity = { planId, entries };
    plans.set(planId, plan);
    return [{ type: "plan", replay: replaying, plan }];
  }

  function applyStateUpdate(
    sessionUpdate: string,
    update: AcpJsonObject,
  ): AcpSessionEvent[] {
    const state = readString(update, "state");
    if (state === "running" || state === "requires_action") {
      return setWork({
        state,
        initiator: work.initiator ?? "agent",
        stopReason: null,
        error: null,
      });
    }
    if (state === "idle") {
      return setWork({
        state: "idle",
        initiator: null,
        stopReason: readString(update, "stopReason") ?? null,
        error: decodeWorkError(update["error"]),
      });
    }
    return unhandled("malformed", sessionUpdate, update);
  }

  function applySessionUpdate(update: unknown): AcpSessionEvent[] {
    if (!isJsonObject(update)) {
      return unhandled("malformed", null, update);
    }
    const sessionUpdate = readString(update, "sessionUpdate");
    if (sessionUpdate === undefined) {
      return unhandled("malformed", null, update);
    }

    const chunkRole = MESSAGE_CHUNK_ROLES[sessionUpdate];
    if (chunkRole !== undefined) {
      return applyMessageChunk(chunkRole, sessionUpdate, update);
    }
    const upsertRole = MESSAGE_UPSERT_ROLES[sessionUpdate];
    if (upsertRole !== undefined) {
      return applyMessageUpsert(upsertRole, sessionUpdate, update);
    }

    switch (sessionUpdate) {
      case "tool_call":
      case "tool_call_update":
        return applyToolCallPatch(sessionUpdate, update);
      case "tool_call_content_chunk":
        return applyToolCallContentChunk(sessionUpdate, update);
      case "plan":
        return applyPlan(
          sessionUpdate,
          DEFAULT_PLAN_ID,
          update["entries"],
          update,
        );
      case "plan_update": {
        const plan = update["plan"];
        if (!isJsonObject(plan) || readString(plan, "type") !== "items") {
          return unhandled("unknown-variant", sessionUpdate, update);
        }
        return applyPlan(
          sessionUpdate,
          readString(plan, "planId") ?? DEFAULT_PLAN_ID,
          plan["entries"],
          update,
        );
      }
      case "available_commands_update": {
        const decoded = decodeAvailableCommands(update["availableCommands"]);
        if (!decoded) {
          return unhandled("malformed", sessionUpdate, update);
        }
        commands = decoded;
        return [{ type: "commands", replay: replaying, commands }];
      }
      case "config_option_update":
        return applyConfigOptions(update["configOptions"]);
      case "current_mode_update": {
        const currentModeId = readString(update, "currentModeId");
        if (currentModeId === undefined) {
          return unhandled("malformed", sessionUpdate, update);
        }
        if (!legacyMode || legacyMode.type !== "select") {
          return [];
        }
        legacyMode = { ...legacyMode, currentValue: currentModeId };
        return [configOptionsEvent()];
      }
      case "session_info_update": {
        const next = { ...info };
        for (const field of ["title", "updatedAt"] as const) {
          if (!(field in update)) {
            continue;
          }
          const value = update[field];
          if (typeof value === "string" || value === null) {
            next[field] = value;
          }
        }
        info = next;
        return [{ type: "info", replay: replaying, info }];
      }
      case "usage_update": {
        const counts = decodeUsageCounts(update);
        if (!counts) {
          return unhandled("malformed", sessionUpdate, update);
        }
        usage = {
          ...counts,
          cost: decodeUsageCost(update["cost"]) ?? usage?.cost ?? null,
        };
        return [{ type: "usage", replay: replaying, usage }];
      }
      case "state_update":
        return agentReportsState
          ? applyStateUpdate(sessionUpdate, update)
          : unhandled("unknown-variant", sessionUpdate, update);
      default:
        return unhandled("unknown-variant", sessionUpdate, update);
    }
  }

  function applyConfigOptions(configOptions: unknown): AcpSessionEvent[] {
    const decoded = decodeConfigOptions(configOptions);
    if (!decoded) {
      return [];
    }
    agentConfigOptions = decoded;
    noteLegacyModeOverlap();
    return [configOptionsEvent()];
  }

  function pruneSettledEntities(): void {
    for (const [toolCallId, toolCall] of toolCalls) {
      if (isTerminalToolCallStatus(toolCall.status)) {
        toolCalls.delete(toolCallId);
      }
    }
    messages.clear();
    currentMessage = null;
  }

  return {
    snapshot() {
      return {
        work,
        messages: [...messages.values()].map((message) => ({
          ...message,
          content: [...message.content],
        })),
        toolCalls: [...toolCalls.values()].map((toolCall) => ({
          ...toolCall,
          content: [...toolCall.content],
          locations: [...toolCall.locations],
        })),
        plans: [...plans.values()],
        configOptions: effectiveConfigOptions(),
        commands,
        info,
        usage,
      };
    },

    applySessionUpdate,

    applySessionSetup(setup) {
      agentConfigOptions = decodeConfigOptions(setup.configOptions) ?? [];
      legacyMode = decodeLegacyModes(setup.modes);
      legacyModel = decodeLegacyModels(setup.models);
      legacyModeRepeatsThoughtLevels = false;
      noteLegacyModeOverlap();
      return [configOptionsEvent()];
    },

    applyConfigOptions,

    applyConfigOptionValue(optionId, value) {
      const withValue = (option: AcpConfigOption): AcpConfigOption | null => {
        if (option.id !== optionId) {
          return null;
        }
        if (option.type === "select" && typeof value === "string") {
          return { ...option, currentValue: value };
        }
        if (option.type === "boolean" && typeof value === "boolean") {
          return { ...option, currentValue: value };
        }
        return null;
      };
      const agentIndex = agentConfigOptions.findIndex(
        (option) => withValue(option) !== null,
      );
      if (agentIndex !== -1) {
        agentConfigOptions = agentConfigOptions.map(
          (option, index) =>
            (index === agentIndex ? withValue(option) : null) ?? option,
        );
        return [configOptionsEvent()];
      }
      const nextLegacyMode = legacyMode ? withValue(legacyMode) : null;
      if (nextLegacyMode) {
        legacyMode = nextLegacyMode;
        return [configOptionsEvent()];
      }
      const nextLegacyModel = legacyModel ? withValue(legacyModel) : null;
      if (nextLegacyModel) {
        legacyModel = nextLegacyModel;
        return [configOptionsEvent()];
      }
      return [];
    },

    beginReplay() {
      replaying = true;
      currentMessage = null;
    },

    endReplay() {
      replaying = false;
      pruneSettledEntities();
    },

    promptSubmitted() {
      pruneSettledEntities();
      promptsInFlight += 1;
      return agentReportsState ? [] : deriveWork(null);
    },

    promptSettled(outcome) {
      promptsInFlight = Math.max(0, promptsInFlight - 1);
      if (agentReportsState) {
        return [];
      }
      if (promptsInFlight === 0) {
        agentWorking = false;
        pendingActions.clear();
      }
      return deriveWork(
        "error" in outcome
          ? { stopReason: "error", error: outcome.error }
          : { stopReason: outcome.stopReason, error: null },
      );
    },

    actionRequested(key) {
      pendingActions.add(key);
      if (agentReportsState) {
        return [];
      }
      if (promptsInFlight === 0) {
        agentWorking = true;
      }
      return deriveWork(null);
    },

    actionResolved(key) {
      pendingActions.delete(key);
      return agentReportsState ? [] : deriveWork(null);
    },

    agentWorkSettled(stopReason) {
      if (agentReportsState || !agentWorking) {
        return [];
      }
      agentWorking = false;
      if (promptsInFlight === 0) {
        pendingActions.clear();
      }
      return deriveWork({ stopReason, error: null });
    },

    hasUnfinishedToolCalls() {
      for (const toolCall of toolCalls.values()) {
        if (!isTerminalToolCallStatus(toolCall.status)) {
          return true;
        }
      }
      return false;
    },

    closeUnfinishedToolCalls(status) {
      const events: AcpSessionEvent[] = [];
      for (const toolCall of toolCalls.values()) {
        if (isTerminalToolCallStatus(toolCall.status)) {
          continue;
        }
        toolCall.status = status;
        events.push(toolCallEvent(toolCall, false, ["status"]));
      }
      return events;
    },
  };
}
