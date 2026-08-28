import { randomUUID } from "node:crypto";
import type {
  ClientTurnRequestId,
  ThreadEvent,
  ThreadEventItem,
  ThreadEventItemPresentation,
  ThreadEventItemStatus,
} from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import type { BridgeGrammarVersions } from "../handshake.js";
import type {
  DeltaFileChange,
  DeltaItemKey,
  DeltaNoTurnFallback,
  DeltaTextChannel,
  ThreadDelta,
} from "../thread-delta.js";
import { THREAD_DELTA_KEY_SEPARATOR } from "../thread-delta.js";
import { THREAD_DELTA_GRAMMAR_V3 } from "../version.js";

type DeltaItemData = Extract<ThreadDelta, { kind: "item.open" }>["item"];

export const ASSEMBLER_GRAMMAR_VERSIONS: BridgeGrammarVersions = [
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_GRAMMAR_V3,
];
import {
  buildEditDiff,
  toOptionalRecord,
  withParentToolCallId,
} from "../bridge-kit/adapter-utils.js";

declare const unstampedThreadIdBrand: unique symbol;

type UnstampedThreadId = string & {
  readonly [unstampedThreadIdBrand]: "runtime-stamped-thread-id";
};

// SAFETY: This branded placeholder carries no runtime value and receives the real thread ID before emission.
const UNSTAMPED_THREAD_ID = "" as UnstampedThreadId;

export interface DiffCumulativeTextArgs {
  nextText: string;
  previousText?: string;
}

export interface DiffCumulativeTextResult {
  delta: string;
  nextText: string;
  reset: boolean;
}

export function diffCumulativeText(
  args: DiffCumulativeTextArgs,
): DiffCumulativeTextResult | null {
  const previousText = args.previousText ?? "";
  if (args.nextText.length === 0 || args.nextText === previousText) {
    return null;
  }
  if (previousText.length === 0) {
    return { delta: args.nextText, nextText: args.nextText, reset: false };
  }
  if (args.nextText.startsWith(previousText)) {
    const delta = args.nextText.slice(previousText.length);
    return delta.length > 0
      ? { delta, nextText: args.nextText, reset: false }
      : null;
  }
  return { delta: args.nextText, nextText: args.nextText, reset: true };
}

const MAX_THREAD_STATES = 256;
const MAX_ID_MAP_ENTRIES = 1024;
const MAX_SETTLED_ITEM_KEYS = 512;

interface OpenItemState {
  bbItemId: string;
  key: DeltaItemKey;
  item: ThreadEventItem;
  threadAttached: boolean;
  text: string;
  summaryText: string;
}

interface PendingProgressState {
  event: ThreadEvent;
  turnScoped: boolean;
}

type TextDeltaThreadEvent = Extract<
  ThreadEvent,
  {
    type:
      | "item/agentMessage/delta"
      | "item/reasoning/textDelta"
      | "item/reasoning/summaryTextDelta"
      | "item/plan/delta"
      | "item/commandExecution/outputDelta"
      | "item/fileChange/outputDelta";
  }
>;

function asTextDeltaEvent(
  event: ThreadEvent,
): TextDeltaThreadEvent | undefined {
  switch (event.type) {
    case "item/agentMessage/delta":
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/plan/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
      return event;
    default:
      return undefined;
  }
}

interface PendingTextState {
  event: TextDeltaThreadEvent;
  text: string;
}

interface EventSink {
  push(...newEvents: ThreadEvent[]): void;
}

interface ThreadAssemblyState {
  currentTurnId: string | undefined;
  lastTurnId: string | undefined;
  pendingAccepted: ClientTurnRequestId[];
  openItemsByKey: Map<string, OpenItemState>;
  commandSnapshotsByKey: Map<string, string>;
  bbItemIdByProviderItemId: Map<string, string>;
  providerItemIdByBbItemId: Map<string, string>;
  bbTurnIdByProviderTurnId: Map<string, string>;
  providerTurnIdByBbTurnId: Map<string, string>;
  settledItemKeys: Set<string>;
  progressLastEmitByKey: Map<string, number>;
  pendingProgressByKey: Map<string, PendingProgressState>;
  textLastEmitByStream: Map<string, number>;
  pendingTextByStream: Map<string, PendingTextState>;
}

export interface CreateDeltaAssemblerOptions {
  providerId: string;
  entropyPrefix?: string;
  progressThrottleMs?: number;
  textDeltaFlushMs?: number;
  now?: () => number;
}

export interface AssembleDeltasArgs {
  threadId: string;
  deltas: readonly ThreadDelta[];
}

export interface DeltaAssembler {
  assemble(args: AssembleDeltasArgs): ThreadEvent[];
  getBbItemId(threadId: string, providerItemId: string): string | undefined;
  getProviderItemId(threadId: string, bbItemId: string): string | undefined;
  getBbTurnId(threadId: string, providerTurnId: string): string | undefined;
  getProviderTurnId(threadId: string, bbTurnId: string): string | undefined;
  getOpenTurnId(threadId: string): string | undefined;
}

const SEP = THREAD_DELTA_KEY_SEPARATOR;

function itemKeyString(key: DeltaItemKey): string {
  return [
    key.providerItemId ?? "",
    key.channel ?? "",
    key.parentRef ?? "",
  ].join(SEP);
}

function withPresentation<TItem extends ThreadEventItem>(
  item: TItem,
  presentation: ThreadEventItemPresentation | undefined,
): TItem {
  if (presentation === undefined || item.type === "userMessage") {
    return item;
  }
  return { ...item, presentation };
}

function presentationOf(
  item: ThreadEventItem | undefined,
): ThreadEventItemPresentation | undefined {
  return item !== undefined && "presentation" in item
    ? item.presentation
    : undefined;
}

function trimOldestEntries<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done === true) {
      return;
    }
    map.delete(oldest.value);
  }
}

export function createDeltaAssembler(
  options: CreateDeltaAssemblerOptions,
): DeltaAssembler {
  const entropyPrefix =
    options.entropyPrefix ?? `da${randomUUID().slice(0, 8)}`;
  const progressThrottleMs = options.progressThrottleMs ?? 500;
  const textDeltaFlushMs = options.textDeltaFlushMs ?? 100;
  const now = options.now ?? Date.now;
  let turnCounter = 0;
  let itemCounter = 0;
  const states = new Map<string, ThreadAssemblyState>();

  function mintTurnId(): string {
    turnCounter += 1;
    return `${entropyPrefix}-t${turnCounter}`;
  }

  function mintItemId(): string {
    itemCounter += 1;
    return `${entropyPrefix}-i${itemCounter}`;
  }

  function stateFor(threadId: string): ThreadAssemblyState {
    const existing = states.get(threadId);
    if (existing) {
      states.delete(threadId);
      states.set(threadId, existing);
      return existing;
    }
    const created: ThreadAssemblyState = {
      currentTurnId: undefined,
      lastTurnId: undefined,
      pendingAccepted: [],
      openItemsByKey: new Map(),
      commandSnapshotsByKey: new Map(),
      bbItemIdByProviderItemId: new Map(),
      providerItemIdByBbItemId: new Map(),
      bbTurnIdByProviderTurnId: new Map(),
      providerTurnIdByBbTurnId: new Map(),
      settledItemKeys: new Set(),
      progressLastEmitByKey: new Map(),
      pendingProgressByKey: new Map(),
      textLastEmitByStream: new Map(),
      pendingTextByStream: new Map(),
    };
    states.set(threadId, created);
    pruneIdleStates();
    return created;
  }

  function pruneIdleStates(): void {
    while (states.size > MAX_THREAD_STATES) {
      let removed = false;
      for (const [threadId, state] of states) {
        if (
          state.currentTurnId !== undefined ||
          state.openItemsByKey.size > 0 ||
          state.pendingAccepted.length > 0 ||
          state.pendingTextByStream.size > 0
        ) {
          continue;
        }
        states.delete(threadId);
        removed = true;
        break;
      }
      if (!removed) {
        return;
      }
    }
  }

  function registerItemId(
    state: ThreadAssemblyState,
    providerItemId: string,
    bbItemId: string,
  ): void {
    state.bbItemIdByProviderItemId.set(providerItemId, bbItemId);
    state.providerItemIdByBbItemId.set(bbItemId, providerItemId);
    trimOldestEntries(state.bbItemIdByProviderItemId, MAX_ID_MAP_ENTRIES);
    trimOldestEntries(state.providerItemIdByBbItemId, MAX_ID_MAP_ENTRIES);
  }

  function resolveVouchedTurnId(
    state: ThreadAssemblyState,
    providerTurnId: string,
  ): string {
    const existing = state.bbTurnIdByProviderTurnId.get(providerTurnId);
    if (existing !== undefined) {
      return existing;
    }
    const bbTurnId = mintTurnId();
    state.bbTurnIdByProviderTurnId.set(providerTurnId, bbTurnId);
    state.providerTurnIdByBbTurnId.set(bbTurnId, providerTurnId);
    trimOldestEntries(state.bbTurnIdByProviderTurnId, MAX_ID_MAP_ENTRIES);
    trimOldestEntries(state.providerTurnIdByBbTurnId, MAX_ID_MAP_ENTRIES);
    return bbTurnId;
  }

  function rememberProgressEmit(state: ThreadAssemblyState, key: string): void {
    state.progressLastEmitByKey.set(key, now());
    trimOldestEntries(state.progressLastEmitByKey, MAX_ID_MAP_ENTRIES);
  }

  function flushElapsedPendingProgress(
    state: ThreadAssemblyState,
    events: EventSink,
    skipKeys: ReadonlySet<string>,
  ): void {
    if (state.pendingProgressByKey.size === 0) {
      return;
    }
    const nowMs = now();
    for (const [key, pending] of [...state.pendingProgressByKey]) {
      if (skipKeys.has(key)) {
        continue;
      }
      const last = state.progressLastEmitByKey.get(key);
      if (last !== undefined && nowMs - last < progressThrottleMs) {
        continue;
      }
      state.pendingProgressByKey.delete(key);
      state.progressLastEmitByKey.set(key, nowMs);
      events.push(pending.event);
    }
  }

  function flushPendingText(
    state: ThreadAssemblyState,
    out: ThreadEvent[],
  ): void {
    if (state.pendingTextByStream.size === 0) {
      return;
    }
    const nowMs = now();
    for (const [streamKey, pending] of state.pendingTextByStream) {
      out.push({ ...pending.event, delta: pending.text });
      state.textLastEmitByStream.set(streamKey, nowMs);
    }
    state.pendingTextByStream.clear();
    trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
  }

  function flushElapsedPendingText(
    state: ThreadAssemblyState,
    out: ThreadEvent[],
  ): void {
    const nowMs = now();
    for (const streamKey of state.pendingTextByStream.keys()) {
      const last = state.textLastEmitByStream.get(streamKey);
      if (last === undefined || nowMs - last >= textDeltaFlushMs) {
        flushPendingText(state, out);
        return;
      }
    }
  }

  function bufferTextDelta(
    state: ThreadAssemblyState,
    event: TextDeltaThreadEvent,
    out: ThreadEvent[],
  ): void {
    const streamKey = `${event.type}${SEP}${event.itemId}`;
    if (
      event.type === "item/commandExecution/outputDelta" &&
      event.reset === true
    ) {
      flushPendingText(state, out);
      out.push(event);
      state.textLastEmitByStream.set(streamKey, now());
      trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
      return;
    }
    const last = state.textLastEmitByStream.get(streamKey);
    if (last === undefined) {
      flushPendingText(state, out);
      out.push(event);
      state.textLastEmitByStream.set(streamKey, now());
      trimOldestEntries(state.textLastEmitByStream, MAX_ID_MAP_ENTRIES);
      return;
    }
    const pending = state.pendingTextByStream.get(streamKey);
    if (now() - last >= textDeltaFlushMs) {
      if (pending === undefined) {
        state.pendingTextByStream.set(streamKey, { event, text: event.delta });
      } else {
        pending.text += event.delta;
      }
      flushPendingText(state, out);
      return;
    }
    if (pending === undefined) {
      state.pendingTextByStream.set(streamKey, { event, text: event.delta });
      return;
    }
    pending.text += event.delta;
  }

  function rememberSettledKey(state: ThreadAssemblyState, key: string): void {
    state.settledItemKeys.add(key);
    while (state.settledItemKeys.size > MAX_SETTLED_ITEM_KEYS) {
      const oldest = state.settledItemKeys.values().next();
      if (oldest.done === true) {
        return;
      }
      state.settledItemKeys.delete(oldest.value);
    }
  }

  function mapParentRef(
    state: ThreadAssemblyState,
    parentRef: string | undefined,
  ): string | undefined {
    if (parentRef === undefined) {
      return undefined;
    }
    const existing = state.bbItemIdByProviderItemId.get(parentRef);
    if (existing !== undefined) {
      return existing;
    }
    const bbItemId = mintItemId();
    registerItemId(state, parentRef, bbItemId);
    return bbItemId;
  }

  function ensureTurnOpen(
    state: ThreadAssemblyState,
    events: EventSink,
  ): string {
    if (state.currentTurnId !== undefined) {
      return state.currentTurnId;
    }
    const turnId = mintTurnId();
    state.currentTurnId = turnId;
    events.push({
      type: "turn/started",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      scope: turnScope(turnId),
    });
    while (state.pendingAccepted.length > 0) {
      const clientRequestId = state.pendingAccepted.shift();
      if (clientRequestId === undefined) {
        break;
      }
      events.push({
        type: "turn/input/accepted",
        threadId: UNSTAMPED_THREAD_ID,
        providerThreadId: "",
        scope: turnScope(turnId),
        clientRequestId,
      });
    }
    return turnId;
  }

  function finishTurn(state: ThreadAssemblyState): void {
    state.lastTurnId = state.currentTurnId ?? state.lastTurnId;
    state.currentTurnId = undefined;
    for (const [key, open] of [...state.openItemsByKey]) {
      if (!open.threadAttached) {
        state.openItemsByKey.delete(key);
      }
    }
    for (const [key, pending] of [...state.pendingProgressByKey]) {
      if (pending.turnScoped) {
        state.pendingProgressByKey.delete(key);
      }
    }
    state.commandSnapshotsByKey.clear();
  }

  function currentOrLastTurnId(state: ThreadAssemblyState): string | undefined {
    return state.currentTurnId ?? state.lastTurnId;
  }

  function buildFileChanges(
    itemData: Extract<DeltaItemData, { type: "fileChange" }>,
  ): Extract<ThreadEventItem, { type: "fileChange" }>["changes"] {
    return itemData.changes.map((change: DeltaFileChange) => {
      const diff =
        change.diff ??
        (change.newText === undefined
          ? undefined
          : buildEditDiff(change.path, change.oldText, change.newText));
      const result: Extract<
        ThreadEventItem,
        { type: "fileChange" }
      >["changes"][number] = {
        path: change.path,
        kind: change.kind,
      };
      if (change.movePath !== undefined) {
        result.movePath = change.movePath;
      }
      if (diff !== undefined) {
        result.diff = diff;
      }
      return result;
    });
  }

  function itemDataMatchesItem(
    itemData: DeltaItemData,
    item: ThreadEventItem,
  ): boolean {
    switch (itemData.type) {
      case "command":
        return item.type === "commandExecution";
      case "fileChange":
        return item.type === "fileChange";
      case "tool":
        return item.type === "toolCall";
      case "compaction":
        return item.type === "contextCompaction";
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "webSearch":
      case "webFetch":
      case "imageView":
      case "backgroundTask":
      case "fileRead":
      case "search":
      case "delegation":
      case "planSteps":
        return item.type === itemData.type;
      case "extension":
        return item.type === "extension" && item.kind === itemData.kind;
    }
  }

  function buildBackgroundTaskItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "backgroundTask" }>,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "backgroundTask" }> {
    const item: Extract<ThreadEventItem, { type: "backgroundTask" }> = {
      type: "backgroundTask",
      id: bbItemId,
      familyId: itemData.familyId,
      taskType: itemData.taskType,
      description: itemData.description,
      status: itemData.status,
      taskStatus: itemData.taskStatus,
      skipTranscript: itemData.skipTranscript,
    };
    if (itemData.workflowName !== undefined) {
      item.workflowName = itemData.workflowName;
    }
    if (itemData.workflow !== undefined) {
      item.workflow = itemData.workflow;
    }
    if (itemData.usage !== undefined) {
      item.usage = itemData.usage;
    }
    if (itemData.summary !== undefined) {
      item.summary = itemData.summary;
    }
    if (itemData.error !== undefined) {
      item.error = itemData.error;
    }
    if (itemData.outputFile !== undefined) {
      item.outputFile = itemData.outputFile;
    }
    return withParentToolCallId(item, parentToolCallId);
  }

  function buildFileReadItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "fileRead" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "fileRead" }> {
    const item: Extract<ThreadEventItem, { type: "fileRead" }> = {
      type: "fileRead",
      id: bbItemId,
      path: itemData.path,
      status,
    };
    if (itemData.cmd !== undefined) {
      item.cmd = itemData.cmd;
    }
    return withParentToolCallId(item, parentToolCallId);
  }

  function buildSearchItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "search" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "search" }> {
    const item: Extract<ThreadEventItem, { type: "search" }> = {
      type: "search",
      id: bbItemId,
      mode: itemData.mode,
      query: itemData.query,
      status,
    };
    if (itemData.path !== undefined) {
      item.path = itemData.path;
    }
    if (itemData.cmd !== undefined) {
      item.cmd = itemData.cmd;
    }
    return withParentToolCallId(item, parentToolCallId);
  }

  function buildDelegationItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "delegation" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
    fallbackSummary?: string,
  ): Extract<ThreadEventItem, { type: "delegation" }> {
    const summary = itemData.summary ?? fallbackSummary;
    const item: Extract<ThreadEventItem, { type: "delegation" }> = {
      type: "delegation",
      id: bbItemId,
      childRef: itemData.childRef,
      label: itemData.label,
      status,
      background: itemData.background,
    };
    if (summary !== undefined) {
      item.summary = summary;
    }
    return withParentToolCallId(item, parentToolCallId);
  }

  function buildExtensionItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "extension" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): Extract<ThreadEventItem, { type: "extension" }> {
    if (presentation === undefined) {
      throw new Error(
        `extension item "${itemData.kind}" reached the assembler without a presentation`,
      );
    }
    return withParentToolCallId(
      {
        type: "extension",
        id: bbItemId,
        kind: itemData.kind,
        payload: itemData.payload,
        status,
        presentation,
      },
      parentToolCallId,
    );
  }

  function buildPlanStepsItem(
    bbItemId: string,
    itemData: Extract<DeltaItemData, { type: "planSteps" }>,
    status: ThreadEventItemStatus,
    parentToolCallId: string | undefined,
  ): Extract<ThreadEventItem, { type: "planSteps" }> {
    const item: Extract<ThreadEventItem, { type: "planSteps" }> = {
      type: "planSteps",
      id: bbItemId,
      steps: itemData.steps,
      status,
    };
    if (itemData.explanation !== undefined) {
      item.explanation = itemData.explanation;
    }
    return withParentToolCallId(item, parentToolCallId);
  }

  function isThreadAttachedItemData(itemData: DeltaItemData): boolean {
    switch (itemData.type) {
      case "backgroundTask":
        return true;
      case "delegation":
        return itemData.background;
      case "command":
      case "fileChange":
      case "tool":
      case "compaction":
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "webSearch":
      case "webFetch":
      case "imageView":
      case "fileRead":
      case "search":
      case "planSteps":
      case "extension":
        return false;
    }
  }

  function buildOpenedItem(
    bbItemId: string,
    itemData: DeltaItemData,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    return withPresentation(
      buildOpenedItemData(bbItemId, itemData, parentToolCallId, presentation),
      presentation,
    );
  }

  function buildOpenedItemData(
    bbItemId: string,
    itemData: DeltaItemData,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    switch (itemData.type) {
      case "command": {
        const item: Extract<ThreadEventItem, { type: "commandExecution" }> = {
          type: "commandExecution",
          id: bbItemId,
          command: itemData.command,
          cwd: itemData.cwd,
          status: "pending",
          approvalStatus: null,
        };
        if (itemData.aggregatedOutput !== undefined) {
          item.aggregatedOutput = itemData.aggregatedOutput;
        }
        if (itemData.exitCode !== undefined) {
          item.exitCode = itemData.exitCode;
        }
        if (itemData.durationMs !== undefined) {
          item.durationMs = itemData.durationMs;
        }
        return withParentToolCallId(item, parentToolCallId);
      }
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: bbItemId,
            changes: buildFileChanges(itemData),
            status: "pending",
            approvalStatus: null,
          },
          parentToolCallId,
        );
      case "tool": {
        const toolArguments = toOptionalRecord(itemData.args);
        const item: Extract<ThreadEventItem, { type: "toolCall" }> = {
          type: "toolCall",
          id: bbItemId,
          tool: itemData.tool,
          status: "pending",
        };
        if (itemData.server !== undefined) {
          item.server = itemData.server;
        }
        if (toolArguments !== undefined) {
          item.arguments = toolArguments;
        }
        if (itemData.result !== undefined) {
          item.result = itemData.result;
        }
        if (itemData.error !== undefined) {
          item.error = itemData.error;
        }
        if (itemData.durationMs !== undefined) {
          item.durationMs = itemData.durationMs;
        }
        return withParentToolCallId(item, parentToolCallId);
      }
      case "compaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: bbItemId },
          parentToolCallId,
        );
      case "agentMessage":
        return withParentToolCallId(
          { type: "agentMessage", id: bbItemId, text: itemData.text },
          parentToolCallId,
        );
      case "reasoning":
        return withParentToolCallId(
          {
            type: "reasoning",
            id: bbItemId,
            summary: itemData.summary,
            content: itemData.content,
          },
          parentToolCallId,
        );
      case "plan":
        return withParentToolCallId(
          { type: "plan", id: bbItemId, text: itemData.text },
          parentToolCallId,
        );
      case "webSearch":
        return withParentToolCallId(
          {
            type: "webSearch",
            id: bbItemId,
            queries: itemData.queries,
            resultText: null,
          },
          parentToolCallId,
        );
      case "webFetch":
        return withParentToolCallId(
          {
            type: "webFetch",
            id: bbItemId,
            url: itemData.url,
            prompt: itemData.prompt ?? null,
            pattern: itemData.pattern,
            resultText: null,
          },
          parentToolCallId,
        );
      case "imageView":
        return withParentToolCallId(
          { type: "imageView", id: bbItemId, path: itemData.path },
          parentToolCallId,
        );
      case "backgroundTask":
        return buildBackgroundTaskItem(bbItemId, itemData, parentToolCallId);
      case "fileRead":
        return buildFileReadItem(
          bbItemId,
          itemData,
          "pending",
          parentToolCallId,
        );
      case "search":
        return buildSearchItem(bbItemId, itemData, "pending", parentToolCallId);
      case "delegation":
        return buildDelegationItem(
          bbItemId,
          itemData,
          "pending",
          parentToolCallId,
        );
      case "planSteps":
        return buildPlanStepsItem(
          bbItemId,
          itemData,
          "pending",
          parentToolCallId,
        );
      case "extension":
        return buildExtensionItem(
          bbItemId,
          itemData,
          "pending",
          parentToolCallId,
          presentation,
        );
    }
  }

  interface CloseFields {
    aggregatedOutput?: string;
    exitCode?: number;
    resultText?: string;
    approvalStatus?: "denied";
    status: ThreadEventItemStatus;
    delegationSummary?: string;
  }

  function completeStartedItem(
    started: ThreadEventItem,
    close: CloseFields,
    parentToolCallId: string | undefined,
  ): ThreadEventItem {
    const parent = parentToolCallId ?? started.parentToolCallId;
    switch (started.type) {
      case "commandExecution": {
        const item: Extract<ThreadEventItem, { type: "commandExecution" }> = {
          type: "commandExecution",
          id: started.id,
          command: started.command,
          cwd: started.cwd,
          status: close.status,
          approvalStatus: started.approvalStatus,
        };
        if (close.aggregatedOutput !== undefined) {
          item.aggregatedOutput = close.aggregatedOutput;
        }
        if (close.exitCode !== undefined) {
          item.exitCode = close.exitCode;
        }
        return withParentToolCallId(item, parent);
      }
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: started.id,
            changes: started.changes,
            status: close.status,
            approvalStatus: started.approvalStatus,
          },
          parent,
        );
      case "toolCall": {
        const item: Extract<ThreadEventItem, { type: "toolCall" }> = {
          type: "toolCall",
          id: started.id,
          tool: started.tool,
          status: close.status,
        };
        if (started.arguments !== undefined) {
          item.arguments = started.arguments;
        }
        if (close.resultText !== undefined) {
          item.result = close.resultText;
        }
        return withParentToolCallId(item, parent);
      }
      case "contextCompaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: started.id },
          parent,
        );
      case "fileRead":
        return buildFileReadItem(started.id, started, close.status, parent);
      case "search":
        return buildSearchItem(started.id, started, close.status, parent);
      case "delegation":
        return buildDelegationItem(started.id, started, close.status, parent);
      case "planSteps":
        return buildPlanStepsItem(started.id, started, close.status, parent);
      case "extension":
        return buildExtensionItem(
          started.id,
          started,
          close.status,
          parent,
          started.presentation,
        );
      default:
        return started;
    }
  }

  function buildClosedItemFromItemData(
    bbItemId: string,
    itemData: DeltaItemData,
    close: CloseFields,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    return withPresentation(
      buildClosedItemData(
        bbItemId,
        itemData,
        close,
        parentToolCallId,
        presentation,
      ),
      presentation,
    );
  }

  function buildClosedItemData(
    bbItemId: string,
    itemData: DeltaItemData,
    close: CloseFields,
    parentToolCallId: string | undefined,
    presentation: ThreadEventItemPresentation | undefined,
  ): ThreadEventItem {
    switch (itemData.type) {
      case "command": {
        const aggregatedOutput =
          close.aggregatedOutput ?? itemData.aggregatedOutput;
        const exitCode = close.exitCode ?? itemData.exitCode;
        const item: Extract<ThreadEventItem, { type: "commandExecution" }> = {
          type: "commandExecution",
          id: bbItemId,
          command: itemData.command,
          cwd: itemData.cwd,
          status: close.status,
          approvalStatus: close.approvalStatus ?? null,
        };
        if (aggregatedOutput !== undefined) {
          item.aggregatedOutput = aggregatedOutput;
        }
        if (exitCode !== undefined) {
          item.exitCode = exitCode;
        }
        if (itemData.durationMs !== undefined) {
          item.durationMs = itemData.durationMs;
        }
        return withParentToolCallId(item, parentToolCallId);
      }
      case "fileChange":
        return withParentToolCallId(
          {
            type: "fileChange",
            id: bbItemId,
            changes: buildFileChanges(itemData),
            status: close.status,
            approvalStatus: close.approvalStatus ?? null,
          },
          parentToolCallId,
        );
      case "tool": {
        const toolArguments = toOptionalRecord(itemData.args);
        const result = itemData.result ?? close.resultText;
        const item: Extract<ThreadEventItem, { type: "toolCall" }> = {
          type: "toolCall",
          id: bbItemId,
          tool: itemData.tool,
          status: close.status,
        };
        if (itemData.server !== undefined) {
          item.server = itemData.server;
        }
        if (toolArguments !== undefined) {
          item.arguments = toolArguments;
        }
        if (result !== undefined) {
          item.result = result;
        }
        if (itemData.error !== undefined) {
          item.error = itemData.error;
        }
        if (itemData.durationMs !== undefined) {
          item.durationMs = itemData.durationMs;
        }
        return withParentToolCallId(item, parentToolCallId);
      }
      case "compaction":
        return withParentToolCallId(
          { type: "contextCompaction", id: bbItemId },
          parentToolCallId,
        );
      case "webSearch":
        return withParentToolCallId(
          {
            type: "webSearch",
            id: bbItemId,
            queries: itemData.queries,
            resultText: close.resultText ?? null,
          },
          parentToolCallId,
        );
      case "webFetch":
        return withParentToolCallId(
          {
            type: "webFetch",
            id: bbItemId,
            url: itemData.url,
            prompt: itemData.prompt ?? null,
            pattern: itemData.pattern,
            resultText: close.resultText ?? null,
          },
          parentToolCallId,
        );
      case "backgroundTask":
        return buildBackgroundTaskItem(bbItemId, itemData, parentToolCallId);
      case "fileRead":
        return buildFileReadItem(
          bbItemId,
          itemData,
          close.status,
          parentToolCallId,
        );
      case "search":
        return buildSearchItem(
          bbItemId,
          itemData,
          close.status,
          parentToolCallId,
        );
      case "delegation":
        return buildDelegationItem(
          bbItemId,
          itemData,
          close.status,
          parentToolCallId,
          close.delegationSummary,
        );
      case "planSteps":
        return buildPlanStepsItem(
          bbItemId,
          itemData,
          close.status,
          parentToolCallId,
        );
      case "extension":
        return buildExtensionItem(
          bbItemId,
          itemData,
          close.status,
          parentToolCallId,
          presentation,
        );
      case "agentMessage":
      case "reasoning":
      case "plan":
      case "imageView":
        return buildOpenedItemData(
          bbItemId,
          itemData,
          parentToolCallId,
          presentation,
        );
    }
  }

  function pushNoTurnFallback(
    state: ThreadAssemblyState,
    fallback: DeltaNoTurnFallback | undefined,
    parentRef: string | undefined,
    events: EventSink,
  ): void {
    if (fallback === undefined) {
      return;
    }
    const parentToolCallId = mapParentRef(state, parentRef);
    const event: Extract<ThreadEvent, { type: "provider/unhandled" }> = {
      type: "provider/unhandled",
      threadId: UNSTAMPED_THREAD_ID,
      providerThreadId: "",
      providerId: options.providerId,
      rawType: fallback.rawType,
      rawEvent: fallback.raw,
      scope: threadScope(),
    };
    if (parentToolCallId !== undefined) {
      event.parentToolCallId = parentToolCallId;
    }
    events.push(event);
  }

  function detachAssistantStreams(
    state: ThreadAssemblyState,
    parentRef: string | undefined,
  ): void {
    for (const [keyStr, open] of [...state.openItemsByKey]) {
      if (
        open.key.providerItemId === undefined &&
        open.item.type === "agentMessage" &&
        open.key.parentRef === parentRef
      ) {
        state.openItemsByKey.delete(keyStr);
      }
    }
  }

  function settleTextItem(
    open: OpenItemState,
    finalText: string | undefined,
    channel: DeltaTextChannel | undefined,
  ): ThreadEventItem | undefined {
    const text =
      channel === "reasoningSummary" ? open.text : (finalText ?? open.text);
    const summaryText =
      channel === "reasoningSummary"
        ? (finalText ?? open.summaryText)
        : open.summaryText;
    switch (open.item.type) {
      case "agentMessage":
        return withPresentation(
          withParentToolCallId(
            { type: "agentMessage", id: open.bbItemId, text },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      case "plan":
        return withPresentation(
          withParentToolCallId(
            { type: "plan", id: open.bbItemId, text },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      case "reasoning":
        return withPresentation(
          withParentToolCallId(
            {
              type: "reasoning",
              id: open.bbItemId,
              summary: summaryText.length === 0 ? [] : [summaryText],
              content: text.length === 0 ? [] : [text],
            },
            open.item.parentToolCallId,
          ),
          open.item.presentation,
        );
      default:
        return undefined;
    }
  }

  function buildTextItemForChannel(
    bbItemId: string,
    channel: DeltaTextChannel,
    text: string,
    parentToolCallId: string | undefined,
  ): ThreadEventItem {
    switch (channel) {
      case "agentMessage":
        return withParentToolCallId(
          { type: "agentMessage", id: bbItemId, text },
          parentToolCallId,
        );
      case "plan":
        return withParentToolCallId(
          { type: "plan", id: bbItemId, text },
          parentToolCallId,
        );
      case "reasoningText":
        return withParentToolCallId(
          { type: "reasoning", id: bbItemId, summary: [], content: [text] },
          parentToolCallId,
        );
      case "reasoningSummary":
        return withParentToolCallId(
          { type: "reasoning", id: bbItemId, summary: [text], content: [] },
          parentToolCallId,
        );
    }
  }

  function handleDelta(
    state: ThreadAssemblyState,
    delta: ThreadDelta,
    events: EventSink,
  ): void {
    switch (delta.kind) {
      case "input.accepted": {
        if (delta.providerTurnId !== undefined) {
          events.push({
            type: "turn/input/accepted",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
            clientRequestId: delta.clientRequestId,
          });
          return;
        }
        if (state.currentTurnId !== undefined) {
          events.push({
            type: "turn/input/accepted",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(state.currentTurnId),
            clientRequestId: delta.clientRequestId,
          });
          return;
        }
        state.pendingAccepted.push(delta.clientRequestId);
        return;
      }

      case "input.provider": {
        if (state.currentTurnId === undefined) {
          return;
        }
        const parentToolCallId = mapParentRef(state, delta.parentRef);
        const event: Extract<ThreadEvent, { type: "item/completed" }> = {
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          item: {
            type: "userMessage",
            id: mintItemId(),
            content: [{ type: "text", text: delta.text }],
          },
        };
        if (parentToolCallId !== undefined) {
          event.item.parentToolCallId = parentToolCallId;
        }
        events.push(event);
        return;
      }

      case "turn.open": {
        if (delta.providerTurnId !== undefined) {
          const parentToolCallId = mapParentRef(state, delta.parentRef);
          const event: Extract<ThreadEvent, { type: "turn/started" }> = {
            type: "turn/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
          return;
        }
        ensureTurnOpen(state, events);
        return;
      }

      case "turn.boundary": {
        if (delta.providerTurnId !== undefined) {
          const event: Extract<ThreadEvent, { type: "turn/completed" }> = {
            type: "turn/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(resolveVouchedTurnId(state, delta.providerTurnId)),
            status: delta.status,
          };
          if (delta.error !== undefined) {
            event.error = delta.error;
          }
          if (delta.providerCheckpointId !== undefined) {
            event.providerCheckpointId = delta.providerCheckpointId;
          }
          events.push(event);
          return;
        }
        const turnId =
          state.currentTurnId ??
          (delta.claimIfIdle === true && state.pendingAccepted.length > 0
            ? ensureTurnOpen(state, events)
            : undefined);
        if (turnId === undefined) {
          return;
        }
        const event: Extract<ThreadEvent, { type: "turn/completed" }> = {
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: delta.status,
        };
        if (delta.error !== undefined) {
          event.error = delta.error;
        }
        if (delta.providerCheckpointId !== undefined) {
          event.providerCheckpointId = delta.providerCheckpointId;
        }
        events.push(event);
        finishTurn(state);
        return;
      }

      case "item.open": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.attach === "currentOrLast"
              ? currentOrLastTurnId(state)
              : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        state.settledItemKeys.delete(keyStr);
        if (delta.item.type !== "compaction") {
          detachAssistantStreams(state, delta.key.parentRef);
        }
        const bbItemId =
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ?? mintItemId();
        if (delta.key.providerItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        const item = buildOpenedItem(
          bbItemId,
          delta.item,
          parentToolCallId,
          delta.presentation,
        );
        state.openItemsByKey.set(keyStr, {
          bbItemId,
          key: delta.key,
          item,
          threadAttached: isThreadAttachedItemData(delta.item),
          text: "",
          summaryText: "",
        });
        rememberProgressEmit(state, keyStr);
        events.push({
          type: "item/started",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item,
        });
        return;
      }

      case "item.close": {
        const threadScoped = isThreadAttachedItemData(delta.item);
        const turnId = threadScoped
          ? undefined
          : delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (!threadScoped && turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        if (
          delta.key.providerItemId !== undefined &&
          state.settledItemKeys.has(keyStr)
        ) {
          return;
        }
        const open = state.openItemsByKey.get(keyStr);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        const openDelegationSummary =
          open?.item.type === "delegation" ? open.item.summary : undefined;
        const closeFields: CloseFields = { status: delta.status };
        if (delta.resultText !== undefined) {
          closeFields.resultText = delta.resultText;
        }
        if (delta.exitCode !== undefined) {
          closeFields.exitCode = delta.exitCode;
        }
        if (delta.aggregatedOutput !== undefined) {
          closeFields.aggregatedOutput = delta.aggregatedOutput;
        }
        if (delta.approvalStatus !== undefined) {
          closeFields.approvalStatus = delta.approvalStatus;
        }
        if (openDelegationSummary !== undefined) {
          closeFields.delegationSummary = openDelegationSummary;
        }
        if (
          open !== undefined &&
          turnId !== undefined &&
          !itemDataMatchesItem(delta.item, open.item)
        ) {
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item: withPresentation(
              completeStartedItem(open.item, closeFields, parentToolCallId),
              presentationOf(open.item),
            ),
          });
        }
        const bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ??
          mintItemId();
        if (delta.key.providerItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
        }
        const presentation = delta.presentation ?? presentationOf(open?.item);
        const item = buildClosedItemFromItemData(
          bbItemId,
          delta.item,
          closeFields,
          parentToolCallId ?? open?.item.parentToolCallId,
          presentation,
        );
        state.openItemsByKey.delete(keyStr);
        state.commandSnapshotsByKey.delete(keyStr);
        state.pendingProgressByKey.delete(keyStr);
        state.progressLastEmitByKey.delete(keyStr);
        if (delta.key.providerItemId !== undefined) {
          rememberSettledKey(state, keyStr);
        }
        if (item.type === "backgroundTask") {
          events.push({
            type: "item/backgroundTask/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item,
          });
          return;
        }
        if (item.type === "delegation" && item.background) {
          events.push({
            type: "item/delegation/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item,
          });
          return;
        }
        if (turnId !== undefined) {
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        return;
      }

      case "item.progress": {
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        const bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined) ??
          delta.key.providerItemId ??
          mintItemId();
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let event: ThreadEvent;
        if (delta.snapshot?.type === "delegation") {
          event = {
            type: "item/delegation/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item: withPresentation(
              buildDelegationItem(
                bbItemId,
                delta.snapshot,
                "pending",
                parentToolCallId ?? open?.item.parentToolCallId,
                open?.item.type === "delegation"
                  ? open.item.summary
                  : undefined,
              ),
              presentationOf(open?.item),
            ),
          };
        } else if (delta.snapshot !== undefined) {
          event = {
            type: "item/backgroundTask/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: threadScope(),
            item: buildBackgroundTaskItem(
              bbItemId,
              delta.snapshot,
              parentToolCallId,
            ),
          };
        } else {
          const turnId =
            delta.providerTurnId !== undefined
              ? resolveVouchedTurnId(state, delta.providerTurnId)
              : state.currentTurnId;
          if (turnId === undefined) {
            pushNoTurnFallback(
              state,
              delta.noTurnFallback,
              delta.key.parentRef,
              events,
            );
            return;
          }
          const progressEvent: Extract<
            ThreadEvent,
            { type: "item/toolCall/progress" }
          > = {
            type: "item/toolCall/progress",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
          };
          if (delta.message !== undefined) {
            progressEvent.message = delta.message;
          }
          if (parentToolCallId !== undefined) {
            progressEvent.parentToolCallId = parentToolCallId;
          }
          event = progressEvent;
        }
        const lastEmit = state.progressLastEmitByKey.get(keyStr);
        if (
          delta.flush !== true &&
          lastEmit !== undefined &&
          now() - lastEmit < progressThrottleMs
        ) {
          state.pendingProgressByKey.set(keyStr, {
            event,
            turnScoped: delta.snapshot === undefined,
          });
          return;
        }
        state.pendingProgressByKey.delete(keyStr);
        rememberProgressEmit(state, keyStr);
        events.push(event);
        return;
      }

      case "item.textDelta": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined);
        if (bbItemId === undefined) {
          bbItemId = mintItemId();
          if (delta.key.providerItemId !== undefined) {
            registerItemId(state, delta.key.providerItemId, bbItemId);
          }
          const itemData: DeltaItemData =
            delta.channel === "agentMessage"
              ? { type: "agentMessage", text: "" }
              : delta.channel === "plan"
                ? { type: "plan", text: "" }
                : { type: "reasoning", summary: [], content: [] };
          const item = buildOpenedItem(
            bbItemId,
            itemData,
            parentToolCallId,
            undefined,
          );
          state.openItemsByKey.set(keyStr, {
            bbItemId,
            key: delta.key,
            item,
            threadAttached: false,
            text: "",
            summaryText: "",
          });
          events.push({
            type: "item/started",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        const openText = state.openItemsByKey.get(keyStr);
        if (openText !== undefined) {
          if (delta.channel === "reasoningSummary") {
            openText.summaryText += delta.text;
          } else {
            openText.text += delta.text;
          }
        }
        const type =
          delta.channel === "agentMessage"
            ? ("item/agentMessage/delta" as const)
            : delta.channel === "reasoningSummary"
              ? ("item/reasoning/summaryTextDelta" as const)
              : delta.channel === "reasoningText"
                ? ("item/reasoning/textDelta" as const)
                : ("item/plan/delta" as const);
        if (type === "item/agentMessage/delta") {
          const event: Extract<
            ThreadEvent,
            { type: "item/agentMessage/delta" }
          > = {
            type,
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        } else if (type === "item/reasoning/summaryTextDelta") {
          const event: Extract<
            ThreadEvent,
            { type: "item/reasoning/summaryTextDelta" }
          > = {
            type,
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        } else if (type === "item/reasoning/textDelta") {
          const event: Extract<
            ThreadEvent,
            { type: "item/reasoning/textDelta" }
          > = {
            type,
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        } else {
          const event: Extract<ThreadEvent, { type: "item/plan/delta" }> = {
            type,
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        }
        return;
      }

      case "item.textClose": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        if (
          delta.key.providerItemId !== undefined &&
          state.settledItemKeys.has(keyStr)
        ) {
          return;
        }
        const open = state.openItemsByKey.get(keyStr);
        state.openItemsByKey.delete(keyStr);
        const accumulated =
          open === undefined
            ? undefined
            : delta.channel === "reasoningSummary"
              ? open.summaryText
              : open.text;
        const finalText = delta.text ?? accumulated;
        if (finalText === undefined || finalText.length === 0) {
          return;
        }
        if (delta.text === undefined && finalText.trim().length === 0) {
          return;
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        let item: ThreadEventItem | undefined =
          open === undefined
            ? undefined
            : settleTextItem(open, delta.text, delta.channel);
        let bbItemId = open?.bbItemId;
        if (item === undefined) {
          bbItemId =
            bbItemId ??
            (delta.key.providerItemId !== undefined
              ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
              : undefined) ??
            mintItemId();
          item = buildTextItemForChannel(
            bbItemId,
            delta.channel,
            finalText,
            parentToolCallId ?? open?.item.parentToolCallId,
          );
        }
        if (delta.key.providerItemId !== undefined && bbItemId !== undefined) {
          registerItemId(state, delta.key.providerItemId, bbItemId);
          rememberSettledKey(state, keyStr);
        }
        events.push({
          type: "item/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          item,
        });
        return;
      }

      case "item.outputDelta": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const open = state.openItemsByKey.get(itemKeyString(delta.key));
        let bbItemId =
          open?.bbItemId ??
          (delta.key.providerItemId !== undefined
            ? state.bbItemIdByProviderItemId.get(delta.key.providerItemId)
            : undefined);
        if (bbItemId === undefined) {
          bbItemId = mintItemId();
          if (delta.key.providerItemId !== undefined) {
            registerItemId(state, delta.key.providerItemId, bbItemId);
          }
        }
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        if (delta.channel === "command") {
          const event: Extract<
            ThreadEvent,
            { type: "item/commandExecution/outputDelta" }
          > = {
            type: "item/commandExecution/outputDelta",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        } else {
          const event: Extract<
            ThreadEvent,
            { type: "item/fileChange/outputDelta" }
          > = {
            type: "item/fileChange/outputDelta",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            itemId: bbItemId,
            delta: delta.text,
          };
          if (parentToolCallId !== undefined) {
            event.parentToolCallId = parentToolCallId;
          }
          events.push(event);
        }
        return;
      }

      case "command.outputSnapshot": {
        if (state.currentTurnId === undefined) {
          pushNoTurnFallback(
            state,
            delta.noTurnFallback,
            delta.key.parentRef,
            events,
          );
          return;
        }
        const keyStr = itemKeyString(delta.key);
        const open = state.openItemsByKey.get(keyStr);
        if (open === undefined) {
          return;
        }
        const diffed = diffCumulativeText({
          previousText: state.commandSnapshotsByKey.get(keyStr),
          nextText: delta.text,
        });
        if (diffed === null) {
          return;
        }
        state.commandSnapshotsByKey.set(keyStr, diffed.nextText);
        const parentToolCallId = mapParentRef(state, delta.key.parentRef);
        const event: Extract<
          ThreadEvent,
          { type: "item/commandExecution/outputDelta" }
        > = {
          type: "item/commandExecution/outputDelta",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(state.currentTurnId),
          itemId: open.bbItemId,
          delta: diffed.delta,
        };
        if (diffed.reset) {
          event.reset = true;
        }
        if (parentToolCallId !== undefined) {
          event.parentToolCallId = parentToolCallId;
        }
        events.push(event);
        return;
      }

      case "usage": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : currentOrLastTurnId(state);
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "thread/tokenUsage/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          tokenUsage: {
            total: { ...delta.total },
            last: { ...delta.last },
            modelContextWindow: delta.modelContextWindow,
          },
        });
        return;
      }

      case "contextWindow": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.attach === "open"
              ? state.currentTurnId
              : currentOrLastTurnId(state);
        events.push({
          type: "thread/contextWindowUsage/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          contextWindowUsage: {
            usedTokens: delta.used,
            modelContextWindow: delta.size ?? null,
            estimated: delta.estimated,
          },
        });
        return;
      }

      case "context.compacted": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : currentOrLastTurnId(state);
        if (turnId === undefined) {
          pushNoTurnFallback(state, delta.noTurnFallback, undefined, events);
          return;
        }
        events.push({
          type: "thread/compacted",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
        });
        return;
      }

      case "context.cleared": {
        const turnId = currentOrLastTurnId(state);
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "thread/context/cleared",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
        });
        return;
      }

      case "provider.error": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.threadScoped === true
              ? undefined
              : (state.currentTurnId ??
                (state.pendingAccepted.length > 0
                  ? ensureTurnOpen(state, events)
                  : undefined));
        const event: Extract<ThreadEvent, { type: "provider/error" }> = {
          type: "provider/error",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          message: delta.message,
        };
        if (delta.detail !== undefined) {
          event.detail = delta.detail;
        }
        if (delta.willRetry !== undefined) {
          event.willRetry = delta.willRetry;
        }
        if (delta.errorInfo !== undefined) {
          event.errorInfo = delta.errorInfo;
        }
        events.push(event);
        if (delta.settlesTurn === true && turnId !== undefined) {
          events.push({
            type: "turn/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            status: "failed",
          });
          finishTurn(state);
        }
        return;
      }

      case "provider.modelFallback": {
        const turnId = currentOrLastTurnId(state);
        events.push({
          type: "provider/modelFallback",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          originalModel: delta.originalModel,
          fallbackModel: delta.fallbackModel,
          reason: delta.reason,
          message: delta.message,
        });
        return;
      }

      case "provider.warning": {
        const turnId =
          delta.vouchedTurn === true ? state.currentTurnId : undefined;
        const event: Extract<ThreadEvent, { type: "provider/warning" }> = {
          type: "provider/warning",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
          category: delta.category ?? "general",
        };
        if (delta.summary !== undefined) {
          event.summary = delta.summary;
        }
        if (delta.details !== undefined) {
          event.details = delta.details;
        }
        events.push(event);
        return;
      }

      case "unhandled": {
        if (delta.onlyIfNoTurn === true && state.currentTurnId !== undefined) {
          return;
        }
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : delta.vouchedTurn === true
              ? state.currentTurnId
              : undefined;
        const parentToolCallId = mapParentRef(state, delta.parentRef);
        const event: Extract<ThreadEvent, { type: "provider/unhandled" }> = {
          type: "provider/unhandled",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          providerId: options.providerId,
          rawType: delta.rawType,
          rawEvent: delta.raw,
          scope: turnId === undefined ? threadScope() : turnScope(turnId),
        };
        if (parentToolCallId !== undefined) {
          event.parentToolCallId = parentToolCallId;
        }
        events.push(event);
        return;
      }

      case "turn.diff": {
        const turnId =
          delta.providerTurnId !== undefined
            ? resolveVouchedTurnId(state, delta.providerTurnId)
            : state.currentTurnId;
        if (turnId === undefined) {
          return;
        }
        events.push({
          type: "turn/diff/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          diff: delta.diff,
        });
        return;
      }

      case "thread.started": {
        events.push({
          type: "thread/started",
          threadId: UNSTAMPED_THREAD_ID,
          scope: threadScope(),
        });
        return;
      }

      case "thread.identity": {
        events.push({
          type: "thread/identity",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: delta.providerThreadId,
          scope: threadScope(),
        });
        return;
      }

      case "thread.name": {
        events.push({
          type: "thread/name/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          threadName: delta.name,
        });
        return;
      }

      case "provider.rateLimits": {
        events.push({
          type: "provider/rateLimits/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          rateLimits: delta.rateLimits,
        });
        return;
      }

      case "extension.state": {
        events.push({
          type: "thread/extensionState/updated",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: threadScope(),
          kind: delta.extensionKind,
          payload: delta.payload,
        });
        return;
      }

      case "session.reset": {
        return;
      }

      case "session.ended": {
        const turnId =
          state.currentTurnId ??
          (state.pendingAccepted.length > 0
            ? ensureTurnOpen(state, events)
            : undefined);
        if (turnId === undefined) {
          return;
        }
        for (const open of state.openItemsByKey.values()) {
          if (open.threadAttached) {
            continue;
          }
          const streamed = open.text.length > 0 || open.summaryText.length > 0;
          const item =
            (streamed
              ? settleTextItem(open, undefined, undefined)
              : undefined) ??
            completeStartedItem(
              open.item,
              { status: "interrupted" },
              undefined,
            );
          events.push({
            type: "item/completed",
            threadId: UNSTAMPED_THREAD_ID,
            providerThreadId: "",
            scope: turnScope(turnId),
            item,
          });
        }
        events.push({
          type: "turn/completed",
          threadId: UNSTAMPED_THREAD_ID,
          providerThreadId: "",
          scope: turnScope(turnId),
          status: "interrupted",
        });
        finishTurn(state);
        return;
      }
    }
  }

  return {
    assemble(args: AssembleDeltasArgs): ThreadEvent[] {
      const events: ThreadEvent[] = [];
      const sink: EventSink = {
        push: (...newEvents: ThreadEvent[]): void => {
          for (const event of newEvents) {
            const textDelta =
              textDeltaFlushMs > 0 ? asTextDeltaEvent(event) : undefined;
            const state = states.get(args.threadId);
            if (textDelta !== undefined && state !== undefined) {
              bufferTextDelta(state, textDelta, events);
              continue;
            }
            if (state !== undefined) {
              flushPendingText(state, events);
            }
            events.push(event);
          }
        },
      };
      const existing =
        args.deltas[0]?.kind === "session.reset"
          ? undefined
          : states.get(args.threadId);
      if (existing !== undefined) {
        flushElapsedPendingText(existing, events);
        const progressKeysInBatch = new Set<string>();
        for (const delta of args.deltas) {
          if (delta.kind === "item.progress") {
            progressKeysInBatch.add(itemKeyString(delta.key));
          }
        }
        flushElapsedPendingProgress(existing, sink, progressKeysInBatch);
      }
      for (const delta of args.deltas) {
        if (delta.kind === "session.reset") {
          const state = states.get(args.threadId);
          if (state !== undefined) {
            flushPendingText(state, events);
          }
          states.delete(args.threadId);
          continue;
        }
        if (
          delta.kind === "item.textClose" ||
          delta.kind === "item.close" ||
          delta.kind === "session.ended"
        ) {
          const state = states.get(args.threadId);
          if (state !== undefined) {
            flushPendingText(state, events);
          }
        }
        handleDelta(stateFor(args.threadId), delta, sink);
      }
      return events;
    },

    getBbItemId(threadId, providerItemId) {
      return states.get(threadId)?.bbItemIdByProviderItemId.get(providerItemId);
    },

    getProviderItemId(threadId, bbItemId) {
      return states.get(threadId)?.providerItemIdByBbItemId.get(bbItemId);
    },

    getBbTurnId(threadId, providerTurnId) {
      return states.get(threadId)?.bbTurnIdByProviderTurnId.get(providerTurnId);
    },

    getProviderTurnId(threadId, bbTurnId) {
      return states.get(threadId)?.providerTurnIdByBbTurnId.get(bbTurnId);
    },

    getOpenTurnId(threadId) {
      return states.get(threadId)?.currentTurnId;
    },
  };
}
